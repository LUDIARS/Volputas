const { normalizeBridgeBaseUrl } = require('./discussionBridgeClient');

// Discutere accepts at most 200 impressions per request and rejects any
// impression carrying a field outside these six (receiver-side anonymity check).
const MAX_IMPRESSIONS_PER_PUSH = 200;
const MIN_BEARER_LENGTH = 32;
const LOG_LABEL = '[discutere-impression-push]';

/**
 * Rebuilds one impression from the allowlisted fields only, so a writer
 * identifier (userId / pseudoId / displayName / Cernere subject) can never
 * leave Voluptas even if the source record carries one.
 * @implements SPEC-GLAB-IMPRESSION-EXPORT
 */
function toAnonymousImpression(record) {
  return {
    id: record.id,
    gameTitle: record.gameTitle,
    recommend: record.recommend,
    polarity: record.polarity ?? null,
    comment: record.comment,
    createdAt: record.createdAt,
  };
}

/** @implements SPEC-GLAB-IMPRESSION-EXPORT */
function skipped(outcome, reason) {
  return { outcome, reason, pushed: 0, ids: [] };
}

/** @implements SPEC-GLAB-IMPRESSION-EXPORT */
async function resolvePushBearer(resolveBearer) {
  if (typeof resolveBearer !== 'function') return null;
  try {
    const bearer = await resolveBearer();
    return typeof bearer === 'string' && bearer.length >= MIN_BEARER_LENGTH ? bearer : null;
  } catch {
    // ServiceTokenIssueError without a legacy fallback: treated as not configured.
    return null;
  }
}

/** @implements SPEC-GLAB-IMPRESSION-EXPORT */
async function postImpressions({ url, bearer, impressions, fetchImpl, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ impressions }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!response.ok) return { ok: false, reason: `status_${response.status}` };
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

/**
 * One push of community impressions not yet sent by this process. Never
 * throws: failures are logged in one line and retried on the next run.
 * Restart resends are absorbed by Discutere's id dedup.
 * @implements SPEC-GLAB-IMPRESSION-EXPORT
 */
async function pushPendingImpressions({
  baseUrl,
  listImpressions,
  resolveBearer,
  sentIds,
  fetchImpl = fetch,
  timeoutMs = 15_000,
  log = console.log,
  warn = console.warn,
}) {
  if (!baseUrl) return skipped('not_configured', 'base_url_missing');
  let endpoint;
  try {
    endpoint = new URL('api/persona-bridge/impressions', normalizeBridgeBaseUrl(baseUrl));
  } catch {
    warn(`${LOG_LABEL} skipped (reason=base_url_invalid)`);
    return skipped('not_configured', 'base_url_invalid');
  }
  const bearer = await resolvePushBearer(resolveBearer);
  if (!bearer) return skipped('bearer_unavailable', 'bearer_missing');

  let impressions;
  try {
    const records = await listImpressions({ limit: MAX_IMPRESSIONS_PER_PUSH });
    impressions = records
      .filter((record) => !sentIds.has(record.id))
      .slice(0, MAX_IMPRESSIONS_PER_PUSH)
      .map(toAnonymousImpression);
  } catch {
    warn(`${LOG_LABEL} failed (reason=list_failed)`);
    return skipped('failed', 'list_failed');
  }
  if (impressions.length === 0) return skipped('nothing_to_push', 'no_new_impressions');

  const result = await postImpressions({ url: endpoint, bearer, impressions, fetchImpl, timeoutMs });
  if (!result.ok) {
    warn(`${LOG_LABEL} failed (reason=${result.reason}, count=${impressions.length})`);
    return skipped('failed', result.reason);
  }
  const ids = impressions.map((impression) => impression.id);
  for (const id of ids) sentIds.add(id);
  const body = result.body ?? {};
  log(
    `${LOG_LABEL} pushed ${ids.length} impressions`
    + ` (imported=${Number(body.imported) || 0}`
    + `, skipped_non_anonymous=${Number(body.skipped?.non_anonymous_field) || 0}`
    + `, skipped_invalid=${Number(body.skipped?.invalid) || 0})`
  );
  return { outcome: 'pushed', reason: null, pushed: ids.length, ids };
}

/**
 * Binds the dependencies and the per-process sent-id Set for repeated pushes.
 * @implements SPEC-GLAB-IMPRESSION-EXPORT
 */
function createDiscutereImpressionPusher(deps) {
  const sentIds = new Set();
  return {
    pushOnce: () => pushPendingImpressions({ ...deps, sentIds }),
  };
}

/**
 * Periodic push with the same shape as sessionMaintenance: no overlapping
 * runs, unref'd interval, one run right after start. Returns the stop function.
 * @implements SPEC-GLAB-IMPRESSION-EXPORT
 */
function startDiscutereImpressionPush({ intervalMinutes, pusher }) {
  let isRunning = false;
  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await pusher.pushOnce();
    } catch {
      console.warn(`${LOG_LABEL} failed (reason=unexpected)`);
    } finally {
      isRunning = false;
    }
  };
  const timer = setInterval(run, intervalMinutes * 60_000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

module.exports = {
  MAX_IMPRESSIONS_PER_PUSH,
  createDiscutereImpressionPusher,
  pushPendingImpressions,
  startDiscutereImpressionPush,
  toAnonymousImpression,
};
