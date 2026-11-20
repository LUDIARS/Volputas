// Ludellus のプレイ記録を WebSocket で集積する口 (spec/feature/ludellus-play-stream.md) の設定。
//
// 本来は Cernere ログインの本人と結びつける。第1段は自宅運用のため、env で明示した
// Cernere の user id (subject) 1 人分だけを受ける固定モードしか持たない
// (neco 指示 2026-11-21「今自宅なので 1 で動かします」)。未設定なら口そのものを開かない。
// HASTER (公開 fixture の検証環境) では常に閉じる。

const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_MAX_CONNECTIONS = 16;

/**
 * @returns {null | { fixedCernereSubject: string, allowedOrigins: string[], maxConnections: number }}
 * @implements SPEC-VO-PLAY-STREAM-IDENTITY
 */
function readPlayStreamConfig(env, { hasterEnabled = false } = {}) {
  if (hasterEnabled) return null;
  const raw = env.VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT;
  if (raw === undefined || raw.trim() === '') return null;
  const fixedCernereSubject = raw.trim();
  if (!SUBJECT_PATTERN.test(fixedCernereSubject)) {
    throw new Error('VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT は 1〜64 文字の英数字・_・- にしてください');
  }
  return {
    fixedCernereSubject,
    allowedOrigins: readOrigins(env.VOLUPTAS_PLAY_STREAM_ALLOWED_ORIGINS),
    maxConnections: readMaxConnections(env.VOLUPTAS_PLAY_STREAM_WS_MAX),
  };
}

function readOrigins(raw) {
  if (!raw) return [];
  const origins = new Set();
  for (const entry of raw.split(',')) {
    const value = entry.trim();
    if (!value || value === '*') continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    } catch {
      throw new Error(`VOLUPTAS_PLAY_STREAM_ALLOWED_ORIGINS に URL でない値があります: ${value}`);
    }
  }
  return [...origins];
}

function readMaxConnections(raw) {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_CONNECTIONS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1024) {
    throw new Error('VOLUPTAS_PLAY_STREAM_WS_MAX は 1〜1024 の整数にしてください');
  }
  return value;
}

module.exports = { readPlayStreamConfig };
