import { api } from './api.js';

export const GAME_KINDS = Object.freeze(['developed', 'commercial']);

export function normalizeGameReviewInput({ gameName, gameKind, rating, text }) {
  const normalizedGameName = typeof gameName === 'string' ? gameName.trim() : '';
  if (!normalizedGameName || normalizedGameName.length > 100) {
    throw new Error('ゲーム名は1〜100文字で入力してください。');
  }
  if (!GAME_KINDS.includes(gameKind)) {
    throw new Error('ゲームの区分を選択してください。');
  }
  const normalizedRating = Number(rating);
  if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    throw new Error('評価は1〜5で選択してください。');
  }
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText || normalizedText.length > 2000) {
    throw new Error('レビュー本文は1〜2000文字で入力してください。');
  }
  return {
    gameName: normalizedGameName,
    gameKind,
    rating: normalizedRating,
    text: normalizedText,
  };
}

export async function submitGameReview(input, request = api) {
  const review = normalizeGameReviewInput(input);
  const submissionId = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  let sessionId = null;
  let primaryError = null;

  try {
    const sessionResponse = await request('/api/v1/sessions', {
      method: 'POST',
      body: {
        game_id: review.gameName,
        metadata: {
          source: 'volputas_web_game_review',
          game_kind: review.gameKind,
        },
      },
    });
    sessionId = sessionResponse.data.id;

    const impressionResponse = await request(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/impressions`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': submissionId },
        body: {
          client_submission_id: submissionId,
          capture_anchor_id: crypto.randomUUID(),
          text: review.text,
          captured_at: capturedAt,
          playtime: { elapsed_ms: 0, active_ms: 0 },
          client: {
            name: 'volputas-web',
            version: '1',
            source: 'volputas_web_game_review',
            game_kind: review.gameKind,
            rating: review.rating,
          },
          assets: [],
        },
      },
    );
    const impressionId = impressionResponse.data.id;
    await request(`/api/v1/impressions/${encodeURIComponent(impressionId)}/complete`, {
      method: 'POST',
    });
    return impressionId;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (sessionId) {
      try {
        await request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH' });
      } catch (closeError) {
        if (!primaryError) throw closeError;
        primaryError.message = `${primaryError.message} セッション終了処理にも失敗しました: ${closeError.message}`;
      }
    }
  }
}
