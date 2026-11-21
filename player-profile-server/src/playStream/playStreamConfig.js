// Ludellus のプレイ記録を WebSocket で集積する口 (spec/feature/ludellus-play-stream.md) の設定。
//
// 記録は Ludellus Web の中継 (ludellus-web scripts/play-stream-proxy.mjs) からだけ受ける。
// 中継はログイン中の Cernere の user id を渡し、本物の中継であることを共有の合言葉
// (VOLUPTAS_PLAY_STREAM_RELAY_TOKEN、Excubitor Vault) で示す (neco 指示 2026-11-21「Cr のログイン対応入れる」)。
// 合言葉が無ければ口そのものを開かない。HASTER (公開 fixture の検証環境) では常に閉じる。

const { createHash } = require('node:crypto');

const MIN_RELAY_TOKEN_LENGTH = 32;
const DEFAULT_MAX_CONNECTIONS = 16;

/**
 * @returns {null | { relayTokenDigest: Buffer, maxConnections: number }}
 * @implements SPEC-VO-PLAY-STREAM-IDENTITY
 */
function readPlayStreamConfig(env, { hasterEnabled = false } = {}) {
  if (hasterEnabled) return null;
  const token = env.VOLUPTAS_PLAY_STREAM_RELAY_TOKEN;
  if (token === undefined || token === '') return null;
  if (token.length < MIN_RELAY_TOKEN_LENGTH) {
    // 値そのものはログに出さない。
    throw new Error(`VOLUPTAS_PLAY_STREAM_RELAY_TOKEN は ${MIN_RELAY_TOKEN_LENGTH} 文字以上にしてください (現在 ${token.length} 文字)`);
  }
  return {
    relayTokenDigest: createHash('sha256').update(token).digest(),
    maxConnections: readMaxConnections(env.VOLUPTAS_PLAY_STREAM_WS_MAX),
  };
}

function readMaxConnections(raw) {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_CONNECTIONS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1024) {
    throw new Error('VOLUPTAS_PLAY_STREAM_WS_MAX は 1〜1024 の整数にしてください');
  }
  return value;
}

module.exports = { readPlayStreamConfig, MIN_RELAY_TOKEN_LENGTH };
