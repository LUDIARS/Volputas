// 終わりが届かなかったプレイ記録を締める (SPEC-VO-PLAY-STREAM-IDLE-CLOSE)。
//
// スマホで画面が消える・アプリを切り替える・タブが破棄されると、クライアントの session_end は
// 届かないことがある。そのままだと集計 (ludellus.session_summary) が作られず、統計の回数にも
// 合計時間にも入らない。一定時間記録の無いセッションを、最後の記録の時刻で途中終了 (abandoned) として締める。
// Spectator の掃除 (sessionModel.closeStale) が集計なしで閉じてしまった古い行も、ここで集計を作って救う。

const { summarizePlaySession } = require('./playSessionSummary');

/** 最後の記録からこれだけ経ったら締める。クライアントは遊んでいる間 1 分ごとに記録を送る。 */
const IDLE_CLOSE_AFTER_MS = 15 * 60_000;
const IDLE_CLOSE_INTERVAL_MS = 5 * 60_000;
/** 1 回に締める上限 (溜まっていても少しずつ片付ける)。 */
const IDLE_CLOSE_BATCH = 100;

/**
 * @param {{ store: object, runPostSessionJobs?: (session: object) => Promise<unknown>, idleMs?: number, now?: () => number, limit?: number }} deps
 * @returns {Promise<number>} 締めた数
 * @implements SPEC-VO-PLAY-STREAM-IDLE-CLOSE
 */
async function closeIdlePlaySessions({
  store,
  runPostSessionJobs = async () => {},
  idleMs = IDLE_CLOSE_AFTER_MS,
  now = Date.now,
  limit = IDLE_CLOSE_BATCH,
}) {
  const candidates = await store.listUnsummarizedSessions({ idleBefore: new Date(now() - idleMs), limit });
  let closed = 0;
  for (const candidate of candidates) {
    const endedAt = lastActivity(candidate);
    const events = await store.listEvents(candidate.id);
    const summary = summarizePlaySession({
      startedAt: candidate.started_at, endedAt, reason: 'abandoned', events, closedBy: 'idle',
    });
    const ended = await store.closeIdleSession({ id: candidate.id, seenEndedAt: candidate.ended_at, endedAt, summary });
    if (!ended) continue;
    closed += 1;
    runPostSessionJobs(ended).catch(() => {});
  }
  return closed;
}

function lastActivity({ started_at: startedAt, last_event_at: lastEventAt }) {
  const start = new Date(startedAt).getTime();
  const last = lastEventAt ? new Date(lastEventAt).getTime() : start;
  return new Date(Math.max(start, last));
}

/** 定期的に締める。止める関数を返す。 */
function startPlayStreamIdleCloser(deps, { intervalMs = IDLE_CLOSE_INTERVAL_MS, logger = console } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await closeIdlePlaySessions(deps);
    } catch (error) {
      logger.error('Failed to close idle play-stream sessions:', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}

module.exports = { closeIdlePlaySessions, startPlayStreamIdleCloser, IDLE_CLOSE_AFTER_MS };
