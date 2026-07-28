import { api } from './api';
import { validateVideoFile } from './videoReviewFile';

function readDurationMs(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const cleanup = () => URL.revokeObjectURL(url);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const durationMs = Math.round(video.duration * 1000);
      cleanup();
      if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
        reject(new Error('動画の長さを取得できませんでした。'));
        return;
      }
      resolve(durationMs);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('この動画をブラウザで読み込めませんでした。MP4 または WebM をお試しください。'));
    };
    video.src = url;
  });
}

async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function prepareVideo(file) {
  const mimeType = validateVideoFile(file);
  const [durationMs, checksum] = await Promise.all([readDurationMs(file), sha256(file)]);
  if (durationMs > 2 * 60 * 60 * 1000) throw new Error('動画の長さは 2 時間以下にしてください。');
  return { mimeType, durationMs, checksum };
}

export async function uploadVideoReview({ file, gameId, text, onProgress = () => {} }) {
  onProgress('動画を確認しています…');
  const prepared = await prepareVideo(file);
  const capturedAt = new Date().toISOString();
  const submissionId = crypto.randomUUID();
  let sessionId = null;
  let primaryError = null;

  try {
    onProgress('レビューを作成しています…');
    const sessionResponse = await api('/api/v1/sessions', {
      method: 'POST',
      body: { game_id: gameId, metadata: { source: 'volputas_web_review' } },
    });
    sessionId = sessionResponse.data.id;

    const impressionResponse = await api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/impressions`, {
      method: 'POST',
      headers: { 'Idempotency-Key': submissionId },
      body: {
        client_submission_id: submissionId,
        capture_anchor_id: crypto.randomUUID(),
        text,
        captured_at: capturedAt,
        playtime: { elapsed_ms: prepared.durationMs, active_ms: prepared.durationMs },
        client: { name: 'volputas-web', version: '1', source: 'volputas_web_review' },
        assets: [{
          client_asset_id: crypto.randomUUID(),
          kind: 'video',
          mime_type: prepared.mimeType,
          size_bytes: file.size,
          sha256: prepared.checksum,
          duration_ms: prepared.durationMs,
          captured_at: capturedAt,
        }],
      },
    });
    const impression = impressionResponse.data;
    const asset = impression.assets[0];

    onProgress('動画をアップロードしています…');
    const uploadResponse = await fetch(asset.upload.url, {
      method: 'PUT',
      headers: asset.upload.headers,
      body: file,
    });
    if (!uploadResponse.ok) throw new Error(`動画アップロードに失敗しました (${uploadResponse.status})。`);

    onProgress('動画を処理しています…');
    await api(`/api/v1/impressions/${encodeURIComponent(impression.id)}/complete`, { method: 'POST' });
    return impression.id;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (sessionId) {
      try {
        await api(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH' });
      } catch (closeError) {
        if (!primaryError) throw closeError;
        primaryError.message = `${primaryError.message} セッション終了処理にも失敗しました: ${closeError.message}`;
      }
    }
  }
}
