// Turns one follow-up answer (or skip) into a patch for the stored voice.
// Structured answers also fill their field; every answer is kept verbatim in
// followUps so the original comment stays untouched.
const { QUESTION_BY_ID, isAskable, settledQuestionIds } = require('./followUpQuestions');

const ANSWER_TEXT_MAXIMUM = 2000;

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_PROFILE_INPUT' });
}

function choiceValue(question, answer) {
  const value = String(answer ?? '');
  if (!question.options.some((option) => option.value === value)) {
    throw invalid(`Unknown answer for ${question.id}: ${value}`);
  }
  return value;
}

function textValue(answer) {
  const value = typeof answer === 'string' ? answer.trim() : '';
  if (!value) throw invalid('Answer text is required (use skip to pass)');
  if (value.length > ANSWER_TEXT_MAXIMUM) throw invalid('Answer text is too long');
  return value;
}

function fieldPatch(questionId, value) {
  if (questionId === 'playProgress') return { playProgress: value };
  if (questionId === 'sentiment') return { sentiment: Number(value) };
  if (questionId === 'polarity' && value !== 'neither') return { polarity: value };
  return {};
}

/**
 * @param {object} record stored voice
 * @param {{ questionId: string, answer?: unknown, skip?: boolean }} body
 * @param {Date} now
 * @returns {object} patch to merge into the stored record
 */
function applyFollowUpAnswer(record, body = {}, now = new Date()) {
  const question = QUESTION_BY_ID.get(String(body.questionId || ''));
  if (!question) throw invalid(`Unknown follow-up question: ${body.questionId}`);
  if (!isAskable(question, record, settledQuestionIds(record))) {
    throw Object.assign(new Error(`Follow-up question is not open: ${question.id}`), {
      code: 'FOLLOW_UP_NOT_OPEN',
      statusCode: 409,
    });
  }
  if (body.skip === true) {
    return { skippedFollowUps: [...(record.skippedFollowUps || []), question.id] };
  }
  const value = question.answerType === 'choice'
    ? choiceValue(question, body.answer)
    : textValue(body.answer);
  return {
    ...fieldPatch(question.id, value),
    followUps: [
      ...(record.followUps || []),
      { questionId: question.id, answer: value, answeredAt: now.toISOString() },
    ],
  };
}

module.exports = { ANSWER_TEXT_MAXIMUM, applyFollowUpAnswer };
