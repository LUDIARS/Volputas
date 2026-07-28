'use strict';

const { QUESTIONS } = require('../surveys/gamerPreferencesSurvey');
const {
  hasUnsafeUnicode,
  isPlainObject,
} = require('./surveyDefinition');

const MAX_FREETEXT_LENGTH = 2_000;
const QUESTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class SurveyAnswerValidationError extends Error {
  constructor(issues) {
    const summary = issues
      .map(({ code, questionId }) => (
        questionId === undefined ? code : `${code} (${JSON.stringify(questionId)})`
      ))
      .join(', ');
    super(`Invalid survey answers: ${summary}`);
    this.name = 'SurveyAnswerValidationError';
    this.issues = issues.map((issue) => Object.freeze({ ...issue }));
  }
}

function validateSurveyAnswers(answers, questions = QUESTIONS) {
  if (!isPlainObject(answers)) {
    throw new SurveyAnswerValidationError([{ code: 'answers_not_object' }]);
  }

  const indexedQuestions = indexQuestions(questions);
  const issues = [];
  const validatedAnswers = {};

  for (const { question, choiceValues } of indexedQuestions.values()) {
    if (!Object.prototype.hasOwnProperty.call(answers, question.id)) {
      issues.push({ code: 'missing_answer', questionId: question.id });
      continue;
    }

    const answer = answers[question.id];
    if (question.type === 'choice') {
      if (typeof answer !== 'string' || !choiceValues.has(answer)) {
        issues.push({ code: 'invalid_choice', questionId: question.id });
        continue;
      }
    } else if (typeof answer !== 'string') {
      issues.push({ code: 'freetext_not_string', questionId: question.id });
      continue;
    } else if (answer.trim().length === 0) {
      issues.push({ code: 'missing_answer', questionId: question.id });
      continue;
    } else if (Array.from(answer).length > MAX_FREETEXT_LENGTH) {
      issues.push({ code: 'freetext_too_long', questionId: question.id });
      continue;
    } else if (hasUnsafeUnicode(answer)) {
      issues.push({ code: 'unsafe_freetext', questionId: question.id });
      continue;
    }

    validatedAnswers[question.id] = answer;
  }

  const unknownAnswerCount = Reflect.ownKeys(answers)
    .filter((key) => typeof key !== 'string' || !indexedQuestions.has(key))
    .length;
  if (unknownAnswerCount > 0) {
    // Unknown keys are caller-controlled and might themselves contain answer text.
    issues.push({ code: 'unknown_answer', count: unknownAnswerCount });
  }

  if (issues.length > 0) {
    throw new SurveyAnswerValidationError(issues);
  }

  return validatedAnswers;
}

function indexQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new TypeError('Survey questions must be a non-empty array');
  }

  const indexedQuestions = new Map();
  for (const question of questions) {
    if (!isPlainObject(question)) {
      throw new TypeError('Each survey question must be a plain object');
    }
    if (typeof question.id !== 'string' || !QUESTION_ID_PATTERN.test(question.id)) {
      throw new TypeError('Each survey question must have a path-safe string id');
    }
    if (indexedQuestions.has(question.id)) {
      throw new TypeError(`Duplicate survey question id: ${question.id}`);
    }

    if (question.type === 'choice') {
      indexedQuestions.set(question.id, {
        question,
        choiceValues: indexChoiceValues(question),
      });
    } else if (question.type === 'freetext') {
      indexedQuestions.set(question.id, { question, choiceValues: null });
    } else {
      throw new TypeError(`Unsupported survey question type: ${question.type}`);
    }
  }

  return indexedQuestions;
}

function indexChoiceValues(question) {
  if (!Array.isArray(question.options) || question.options.length === 0) {
    throw new TypeError(`Choice question has no options: ${question.id}`);
  }

  const values = new Set();
  for (const option of question.options) {
    if (!isPlainObject(option) || typeof option.value !== 'string' || option.value.length === 0) {
      throw new TypeError(`Choice question has an invalid option: ${question.id}`);
    }
    if (values.has(option.value)) {
      throw new TypeError(`Choice question has a duplicate option: ${question.id}`);
    }
    values.add(option.value);
  }
  return values;
}

module.exports = {
  MAX_FREETEXT_LENGTH,
  SurveyAnswerValidationError,
  validateSurveyAnswers,
};
