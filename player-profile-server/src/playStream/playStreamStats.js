// 統計 (SPEC-VO-PLAY-STREAM-STATS)。保存済みのセッション集計をゲームごとにまとめる。
// Ludellus の管理画面 (/debug/stats/) が読む。生の記録は返さず、集計値だけを返す。

const { median } = require('./playSessionSummary');

const RECENT_LIMIT = 20;

/**
 * @param {Array<{ id: string, game_id: string, started_at: Date | string, ended_at: Date | string, summary: object }>} rows 新しい順
 * @implements SPEC-VO-PLAY-STREAM-STATS
 */
function buildPlayStreamStats(rows) {
  const byGame = new Map();
  for (const row of rows) {
    if (!byGame.has(row.game_id)) byGame.set(row.game_id, []);
    byGame.get(row.game_id).push(row);
  }
  const games = [...byGame.entries()].map(([gameId, sessions]) => summarizeGame(gameId, sessions))
    .sort((a, b) => (a.last_played_at < b.last_played_at ? 1 : -1));
  return {
    games,
    recent: rows.slice(0, RECENT_LIMIT).map((row) => ({
      session_id: row.id,
      game_id: row.game_id,
      player_id: row.ludellus_player_id ?? null,
      started_at: toIso(row.started_at),
      ended_at: toIso(row.ended_at),
      ...pickSummary(row.summary),
    })),
  };
}

function summarizeGame(gameId, sessions) {
  const summaries = sessions.map((session) => session.summary || {});
  const items = sum(summaries.map((summary) => summary.items));
  const firstTryCorrect = sum(summaries.map((summary) => summary.first_try_correct));
  return {
    game_id: gameId,
    sessions: sessions.length,
    completed: summaries.filter((summary) => summary.reason === 'completed').length,
    total_duration_ms: sum(summaries.map((summary) => summary.duration_ms)),
    answers: sum(summaries.map((summary) => summary.answers)),
    correct: sum(summaries.map((summary) => summary.correct)),
    wrong: sum(summaries.map((summary) => summary.wrong)),
    timeouts: sum(summaries.map((summary) => summary.timeouts)),
    items,
    // 問題数で重み付けした初回正答率 (セッションごとの率の平均ではない)。
    first_try_accuracy: items === 0 ? null : firstTryCorrect / items,
    response_ms_median: median(summaries.map((summary) => summary.response_ms_median)),
    since_wrong_ms_median: median(summaries.map((summary) => summary.since_wrong_ms_median)),
    metrics: mergeMetrics(summaries.map((summary) => summary.metrics)),
    last_played_at: toIso(sessions[0].ended_at),
  };
}

function mergeMetrics(list) {
  const merged = {};
  for (const metrics of list) {
    for (const [name, metric] of Object.entries(metrics || {})) {
      const current = merged[name];
      merged[name] = current
        ? {
          count: current.count + metric.count,
          sum: current.sum + metric.sum,
          min: Math.min(current.min, metric.min),
          max: Math.max(current.max, metric.max),
        }
        : { count: metric.count, sum: metric.sum, min: metric.min, max: metric.max };
    }
  }
  return merged;
}

function pickSummary(summary = {}) {
  return {
    reason: summary.reason ?? null,
    duration_ms: summary.duration_ms ?? null,
    answers: summary.answers ?? 0,
    items: summary.items ?? 0,
    first_try_accuracy: summary.first_try_accuracy ?? null,
    response_ms_median: summary.response_ms_median ?? null,
    since_wrong_ms_median: summary.since_wrong_ms_median ?? null,
  };
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

module.exports = { buildPlayStreamStats };
