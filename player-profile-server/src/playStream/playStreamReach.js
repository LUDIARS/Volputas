// プレイ記録の口 (WebSocket と統計 API) に届いてよい相手と、その本人の判定
// (SPEC-VO-PLAY-STREAM-REACH / SPEC-VO-PLAY-STREAM-IDENTITY)。
// 受けるのは同じ PC の Ludellus Web の中継だけ: 相手アドレスが loopback で、ブラウザの Origin と
// 中継の印 (X-Forwarded-For など) が無く、共有の合言葉が一致すること。本人は中継が渡す Cernere の user id。

const { createHash, timingSafeEqual } = require('node:crypto');

const RELAY_TOKEN_HEADER = 'x-ludellus-play-relay-token';
const CERNERE_SUB_HEADER = 'x-ludellus-cernere-sub';
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip'];
const CERNERE_SUB = /^[A-Za-z0-9_-]{1,64}$/;

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false;
  const bare = address.replace(/^::ffff:/i, '').replace(/%.*$/, '');
  return bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare);
}

function headerOf(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function tokenMatches(token, digest) {
  if (typeof token !== 'string' || token === '') return false;
  return timingSafeEqual(createHash('sha256').update(token).digest(), digest);
}

/**
 * 通すなら { cernereSub }、断るなら { status, code }。
 * @param {{ remoteAddress?: string, headers: Record<string, string | string[] | undefined> }} request
 * @param {{ relayTokenDigest: Buffer }} config
 * @implements SPEC-VO-PLAY-STREAM-REACH
 */
function checkPlayStreamRelay(request, config) {
  const header = (name) => headerOf(request.headers, name);
  if (FORWARDING_HEADERS.some((name) => header(name) !== undefined)) return { status: 403, code: 'FORWARDED' };
  if (!isLoopbackAddress(request.remoteAddress)) return { status: 403, code: 'NOT_LOOPBACK' };
  // ブラウザから直接は受けない (Origin が付くのはブラウザだけ)。中継は Origin を渡さない。
  if (header('origin') !== undefined) return { status: 403, code: 'BROWSER_NOT_ALLOWED' };
  if (!tokenMatches(header(RELAY_TOKEN_HEADER), config.relayTokenDigest)) return { status: 403, code: 'RELAY_TOKEN_MISMATCH' };
  const cernereSub = header(CERNERE_SUB_HEADER);
  if (typeof cernereSub !== 'string' || !CERNERE_SUB.test(cernereSub)) return { status: 401, code: 'CERNERE_SUB_REQUIRED' };
  return { cernereSub };
}

module.exports = { checkPlayStreamRelay, isLoopbackAddress, RELAY_TOKEN_HEADER, CERNERE_SUB_HEADER };
