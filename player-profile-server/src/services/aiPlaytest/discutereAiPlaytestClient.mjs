import { normalizeBridgeBaseUrl } from '../discussionBridgeClient.js';

const AI_PLAYTEST_PATH = 'api/persona-bridge/ai-playtest-reviews';

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
export function toAiPlaytestMaterial(review) {
  return {
    origin: 'ai',
    source: 'ai-autoplayer',
    run_id: review.runId,
    game_id: review.gameId,
    game_title: review.gameTitle,
    summary: review.summary,
    good: review.good,
    bad: review.bad,
    confusions: review.confusions,
    reflection: review.reflection,
    played_at: review.playedAt,
  };
}

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
export function aiPlaytestBridgeUrl(baseUrl) {
  return new URL(AI_PLAYTEST_PATH, normalizeBridgeBaseUrl(baseUrl));
}

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
export async function pushAiPlaytestReview({
  url, bearer, review, fetchImpl = fetch, timeoutMs = 15_000, signal,
}) {
  if (!url || !bearer) return { delivered: false, reason: 'bridge_not_configured' };
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': review.runId,
      },
      body: JSON.stringify(toAiPlaytestMaterial(review)),
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { delivered: false, reason: 'unreachable' };
  }
  if (!response.ok) return { delivered: false, reason: `status_${response.status}` };

  let receipt;
  try {
    receipt = await response.json();
  } catch {
    return { delivered: false, reason: 'invalid_json' };
  }
  if (receipt?.ok !== true || receipt.run_id !== review.runId) {
    return { delivered: false, reason: 'invalid_acknowledgment' };
  }
  return { delivered: true, receipt: { ok: true, run_id: receipt.run_id } };
}
