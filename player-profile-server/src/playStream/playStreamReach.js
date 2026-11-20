// プレイ記録の口 (WebSocket と統計 API) に届いてよい相手の判定 (SPEC-VO-PLAY-STREAM-REACH)。
// 第1段は同じ PC の Ludellus だけ: 相手アドレスが loopback で、Origin が無いか許可リストにあること。
// 中継 (X-Forwarded-For など) を経た要求は受けない。

const RELAY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip'];

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false;
  const bare = address.replace(/^::ffff:/i, '').replace(/%.*$/, '');
  return bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare);
}

/**
 * @param {{ remoteAddress?: string, headers: Record<string, string | string[] | undefined> }} request
 * @param {{ allowedOrigins: string[] }} config
 * @returns {null | { status: number, code: string }} 通すなら null
 * @implements SPEC-VO-PLAY-STREAM-REACH
 */
function checkPlayStreamReach(request, config) {
  const header = (name) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  if (RELAY_HEADERS.some((name) => header(name) !== undefined)) return { status: 403, code: 'RELAYED' };
  if (!isLoopbackAddress(request.remoteAddress)) return { status: 403, code: 'NOT_LOOPBACK' };
  const origin = header('origin');
  if (origin !== undefined && !config.allowedOrigins.includes(origin.trim())) {
    return { status: 403, code: 'ORIGIN_NOT_ALLOWED' };
  }
  return null;
}

module.exports = { checkPlayStreamReach, isLoopbackAddress };
