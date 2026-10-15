// AI プレイテスト感想 (Ingenium `ingenium playtest` の ai-playtest-review/1) の受け口の入力検査。
// 送られた本文は許可した項目だけで組み直す。決めていない項目が 1 つでもあれば受け付けない
// (操作した人・端末・セッションなど書き手を識別できる値を紛れ込ませない)。
// 良い点 (good) と悪い点 (bad) はどちらも 1 件以上必須。
const { AppError } = require('../../middleware/errorHandler');

const REVIEW_FORMAT = 'ai-playtest-review/1';
const REVIEW_SOURCE = 'ai-autoplayer';
const ASPECTS = new Set(['ux', 'control', 'game']);
const SCREENS = new Set(['image', 'text']);
const POINT_TEXT_MAX = 300;
const POINTS_MAX = 8;
const SUMMARY_MAX = 400;
const ID_TEXT_MAX = 200;

const ALLOWED_FIELDS = new Set([
  'format', 'source', 'game_id', 'game_title', 'run_id', 'persona', 'engine_version', 'adapter',
  'screen', 'ticks', 'turns', 'outcome', 'summary', 'good', 'bad', 'confusions', 'reflection', 'created_at',
]);
const POINT_FIELDS = new Set(['aspect', 'text', 'evidence']);
const EVIDENCE_FIELDS = new Set(['ticks', 'shots']);

function invalid(message) {
  return new AppError(400, 'INVALID_AI_PLAYTEST_REVIEW', message);
}

function onlyFields(value, allowed, at) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${at} must be an object`);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw invalid(`${at} has fields that are not accepted: ${extra.join(', ')}`);
  return value;
}

function text(value, at, max) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${at} must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(`${at} is longer than ${max}`);
  return trimmed;
}

function count(value, at) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${at} must be a non-negative integer`);
  return value;
}

function numbers(value, at) {
  if (!Array.isArray(value) || value.length > 100) throw invalid(`${at} must be an array of at most 100 numbers`);
  return value.map((item, index) => count(item, `${at}[${index}]`));
}

function points(value, at, required) {
  if (!Array.isArray(value)) throw invalid(`${at} must be an array`);
  if (required && value.length === 0) throw invalid(`${at} needs at least one point`);
  if (value.length > POINTS_MAX) throw invalid(`${at} has more than ${POINTS_MAX} points`);
  return value.map((item, index) => {
    const pointAt = `${at}[${index}]`;
    const point = onlyFields(item, POINT_FIELDS, pointAt);
    if (!ASPECTS.has(point.aspect)) throw invalid(`${pointAt}.aspect must be ux, control or game`);
    const evidence = onlyFields(point.evidence, EVIDENCE_FIELDS, `${pointAt}.evidence`);
    return {
      aspect: point.aspect,
      text: text(point.text, `${pointAt}.text`, POINT_TEXT_MAX),
      evidence: { ticks: numbers(evidence.ticks, `${pointAt}.evidence.ticks`), shots: numbers(evidence.shots, `${pointAt}.evidence.shots`) },
    };
  });
}

function timestamp(value) {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw invalid('created_at must be an ISO timestamp');
  return parsed.toISOString();
}

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
function normalizeAiPlaytestReview(body) {
  const input = onlyFields(body, ALLOWED_FIELDS, 'body');
  if (input.format !== REVIEW_FORMAT) throw invalid(`format must be ${REVIEW_FORMAT}`);
  if (input.source !== REVIEW_SOURCE) throw invalid(`source must be ${REVIEW_SOURCE}`);
  if (!SCREENS.has(input.screen)) throw invalid('screen must be image or text');
  if (!Array.isArray(input.reflection) || input.reflection.length === 0 || input.reflection.length > POINTS_MAX) {
    throw invalid(`reflection must hold 1-${POINTS_MAX} lines`);
  }
  return {
    format: REVIEW_FORMAT,
    source: REVIEW_SOURCE,
    gameId: text(input.game_id, 'game_id', ID_TEXT_MAX),
    gameTitle: text(input.game_title, 'game_title', ID_TEXT_MAX),
    runId: text(input.run_id, 'run_id', ID_TEXT_MAX),
    persona: text(input.persona, 'persona', ID_TEXT_MAX),
    engineVersion: text(input.engine_version, 'engine_version', ID_TEXT_MAX),
    adapter: text(input.adapter, 'adapter', ID_TEXT_MAX),
    screen: input.screen,
    ticks: count(input.ticks, 'ticks'),
    turns: count(input.turns, 'turns'),
    outcome: text(input.outcome, 'outcome', ID_TEXT_MAX),
    summary: text(input.summary, 'summary', SUMMARY_MAX),
    good: points(input.good, 'good', true),
    bad: points(input.bad, 'bad', true),
    confusions: points(input.confusions, 'confusions', false),
    reflection: input.reflection.map((line, index) => text(line, `reflection[${index}]`, POINT_TEXT_MAX)),
    playedAt: timestamp(input.created_at),
  };
}

module.exports = { REVIEW_FORMAT, REVIEW_SOURCE, normalizeAiPlaytestReview };
