// 1 セッションの集計 (SPEC-VO-PLAY-STREAM-SUMMARY)。ludellus.session_summary として保存する。
// 初回正答率 = 最初の解答 (attempt = 1) が正解だった問題 / 解答のあった問題。

const { extractTrial, isMetricType, isTrialResultType } = require('../services/trialResult');

const SUMMARY_VERSION = 1;

/**
 * @param {{ startedAt: string | Date, endedAt: string | Date, reason: string, events: Array<{ event_type: string, event_data: object }>, closedBy?: 'idle' }} input
 *   closedBy: クライアントの終了ではなくサーバが締めたとき (SPEC-VO-PLAY-STREAM-IDLE-CLOSE) の理由
 * @implements SPEC-VO-PLAY-STREAM-SUMMARY
 */
function summarizePlaySession({ startedAt, endedAt, reason, events, closedBy }) {
  // response_ms は timeout で null になる。extractTrial は null を 0 に読むので、ここでは元の値を見る。
  const trials = events.filter((event) => isTrialResultType(event.event_type)).map((event) => ({
    ...extractTrial(event.event_data),
    responseMs: Number.isFinite(event.event_data?.response_ms) ? event.event_data.response_ms : null,
  }));
  const answered = trials.filter((trial) => trial.itemId !== null);
  const items = new Set(answered.map((trial) => trial.itemId));
  const firstTries = answered.filter((trial) => trial.attempt === 1);
  const firstTryCorrect = new Set(firstTries.filter((trial) => trial.correct).map((trial) => trial.itemId)).size;
  return {
    v: SUMMARY_VERSION,
    reason,
    ...(closedBy ? { closed_by: closedBy } : {}),
    duration_ms: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
    answers: answered.length,
    correct: answered.filter((trial) => trial.outcome === 'correct').length,
    wrong: answered.filter((trial) => trial.outcome === 'wrong').length,
    timeouts: answered.filter((trial) => trial.outcome === 'timeout').length,
    items: items.size,
    first_try_correct: firstTryCorrect,
    first_try_accuracy: items.size === 0 ? null : firstTryCorrect / items.size,
    response_ms_median: median(firstTries.map((trial) => trial.responseMs)),
    since_wrong_ms_median: median(answered.map((trial) => trial.sinceWrongMs)),
    metrics: summarizeMetrics(events),
  };
}

function summarizeMetrics(events) {
  const metrics = {};
  for (const event of events) {
    if (!isMetricType(event.event_type)) continue;
    const { name, value } = event.event_data;
    if (typeof name !== 'string' || !Number.isFinite(value)) continue;
    const current = metrics[name];
    metrics[name] = current
      ? {
        count: current.count + 1,
        sum: current.sum + value,
        min: Math.min(current.min, value),
        max: Math.max(current.max, value),
        last: value,
      }
      : { count: 1, sum: value, min: value, max: value, last: value };
  }
  return metrics;
}

/** 中央値。null・NaN は除く。空なら null。偶数個は中央 2 つの平均。 */
function median(values) {
  const numbers = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 1 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

module.exports = { summarizePlaySession, median, SUMMARY_VERSION };
