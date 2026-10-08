// Follow-up hearing for a saved voice (ユーザの声). The first save keeps the
// title, the first impression and the play progress; afterwards the owner is
// asked only for what is still missing, one question at a time. The original
// comment is never rewritten — answers live beside it.

const PLAY_PROGRESS = Object.freeze({
  early: { label: '序盤', rank: 1 },
  middle: { label: '中盤', rank: 2 },
  late: { label: '終盤', rank: 3 },
  cleared: { label: 'クリア済み', rank: 4 },
  'post-clear': { label: 'クリア後もやり込み中', rank: 5 },
});

const SENTIMENT_LABELS = Object.freeze({
  '-2': '強い不満',
  '-1': 'やや不満',
  0: '中立',
  1: 'やや好意的',
  2: '強く好意的',
});

// A comment shorter than this rarely says why the player felt that way.
const REASON_WANTED_BELOW = 60;

const QUESTIONS = Object.freeze([
  {
    id: 'playProgress',
    prompt: 'どこまで遊びましたか？',
    answerType: 'choice',
    options: Object.entries(PLAY_PROGRESS).map(([value, { label }]) => ({ value, label })),
    isMissing: (record) => !PLAY_PROGRESS[record.playProgress],
  },
  {
    id: 'sentiment',
    prompt: '全体としてどう感じましたか？',
    answerType: 'choice',
    options: Object.entries(SENTIMENT_LABELS).map(([value, label]) => ({ value, label })),
    isMissing: (record) => record.sentiment === null || record.sentiment === undefined,
  },
  {
    id: 'polarity',
    prompt: 'このゲームはスキ寄りですか、嫌い寄りですか？',
    answerType: 'choice',
    options: [
      { value: 'like', label: '👍 スキ' },
      { value: 'dislike', label: '👎 嫌い' },
      { value: 'neither', label: 'どちらでもない' },
    ],
    isMissing: (record) => record.polarity !== 'like' && record.polarity !== 'dislike',
  },
  {
    id: 'reason',
    prompt: 'そう感じた一番の理由は何ですか？',
    answerType: 'text',
    isMissing: (record) => String(record.comment || '').trim().length < REASON_WANTED_BELOW,
  },
  {
    id: 'highlight',
    prompt: 'ここまでで一番印象に残った場面はどこですか？',
    answerType: 'text',
    isMissing: () => true,
  },
  {
    id: 'ending',
    prompt: '最後まで遊んでみて、結末やクリアまでの流れはどうでしたか？',
    answerType: 'text',
    // 未プレイ範囲は質問しない: only players who reached the end are asked.
    requiresProgressRank: PLAY_PROGRESS.cleared.rank,
    isMissing: () => true,
  },
]);

const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));

function progressRank(record) {
  return PLAY_PROGRESS[record.playProgress]?.rank ?? 0;
}

function settledQuestionIds(record) {
  const settled = new Set(record.skippedFollowUps || []);
  for (const answer of record.followUps || []) settled.add(answer.questionId);
  return settled;
}

function isAskable(question, record, settled) {
  if (settled.has(question.id)) return false;
  if (question.requiresProgressRank && progressRank(record) < question.requiresProgressRank) {
    return false;
  }
  return question.isMissing(record);
}

function publicQuestion(question) {
  const result = { id: question.id, prompt: question.prompt, answerType: question.answerType };
  if (question.options) result.options = question.options;
  return result;
}

/** Next question to ask about a saved voice, or null when the record is sufficient. */
function nextFollowUpQuestion(record) {
  const settled = settledQuestionIds(record);
  const question = QUESTIONS.find((candidate) => isAskable(candidate, record, settled));
  return question ? publicQuestion(question) : null;
}

module.exports = {
  PLAY_PROGRESS,
  QUESTION_BY_ID,
  REASON_WANTED_BELOW,
  isAskable,
  nextFollowUpQuestion,
  settledQuestionIds,
};
