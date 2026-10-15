// AI プレイテスト感想の保存と一覧。保存先 (store) はモードごとに差し替える:
// オンラインは Voluptas 自身の DB (aiPlaytestReviewRepository)、ローカルはデータリポジトリ
// (localAiPlaytestReviewStore)。AI の感想は人の書き手を持たないので Cernere の個人データ列には置かず、
// 人の感想 (voices / play_impressions) とも別に持つ。人の統計・ペルソナ分析・Discutere への送信には混ざらない。
// 同じ run_id の再送は同じ記録を返す (Idempotency-Key = run_id)。
const { createHash } = require('node:crypto');
const { AppError } = require('../../middleware/errorHandler');
const { normalizeAiPlaytestReview } = require('./aiPlaytestReviewInput');

const LIST_DEFAULT = 50;
const LIST_MAX = 200;

/** run_id から決まる記録 ID (再送しても同じ ID)。 */
function reviewIdFor(runId) {
  return `aipt_${createHash('sha256').update(runId).digest('hex').slice(0, 24)}`;
}

function normalizeTitle(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/\s+/g, '') : '';
}

/** 一覧で返す形 (保存した項目そのまま、書き手の情報は元から無い)。 */
function reviewView(record) {
  return {
    id: record.id,
    source: record.source,
    gameId: record.gameId,
    gameTitle: record.gameTitle,
    runId: record.runId,
    persona: record.persona,
    engineVersion: record.engineVersion,
    adapter: record.adapter,
    screen: record.screen,
    ticks: record.ticks,
    turns: record.turns,
    outcome: record.outcome,
    summary: record.summary,
    good: record.good,
    bad: record.bad,
    confusions: record.confusions,
    reflection: record.reflection,
    playedAt: record.playedAt,
    createdAt: record.createdAt,
  };
}

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
function createAiPlaytestReviewService({ store, now = () => new Date() }) {
  if (!store) throw new TypeError('store is required');
  return {
    async create({ idempotencyKey, body, context }) {
      const review = normalizeAiPlaytestReview(body);
      if (typeof idempotencyKey !== 'string' || idempotencyKey !== review.runId) {
        throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must equal run_id');
      }
      const record = { id: reviewIdFor(review.runId), ...review, createdAt: now().toISOString() };
      const saved = await store.save(record, context);
      return { review: reviewView(saved.record), created: saved.created };
    },

    async list({ game = null, limit = LIST_DEFAULT, context } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIST_MAX) {
        throw new AppError(400, 'INVALID_LIST_LIMIT', `limit must be 1-${LIST_MAX}`);
      }
      const needle = normalizeTitle(game);
      const records = await store.list({ limit: needle ? LIST_MAX : limit }, context);
      const matching = needle
        ? records.filter((record) => {
          const title = normalizeTitle(record.gameTitle);
          return record.gameId === game || (title.length > 0 && (title.includes(needle) || needle.includes(title)));
        })
        : records;
      return matching.slice(0, limit).map(reviewView);
    },
  };
}

module.exports = { createAiPlaytestReviewService, reviewIdFor, LIST_MAX };
