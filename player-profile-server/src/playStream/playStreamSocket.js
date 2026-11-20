// /api/v1/play-stream の WebSocket 受け口 (SPEC-VO-PLAY-STREAM-SOCKET)。
// 到達判定は playStreamReach、検証は playStreamFrames、保存と返事は playStreamRecorder が持つ。

const { WebSocketServer } = require('ws');
const { checkPlayStreamReach } = require('./playStreamReach');
const { parsePlayStreamFrame } = require('./playStreamFrames');

const PLAY_STREAM_SOCKET_PATH = '/api/v1/play-stream';
/** 1 フレームの上限。 */
const MAX_FRAME_BYTES = 16 * 1024;
/** 1 接続で処理待ちにしてよいメッセージ数。超えたら送りすぎとして閉じる。 */
const MAX_PENDING = 256;
const CLOSE_UNSUPPORTED = 1003;
const CLOSE_POLICY = 1008;
const CLOSE_UNAVAILABLE = 1013;

const STATUS_TEXT = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' };

function rejectUpgrade(socket, status) {
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function pathOf(url) {
  const value = url || '/';
  const query = value.indexOf('?');
  return query === -1 ? value : value.slice(0, query);
}

/**
 * HTTP サーバの upgrade に付ける。自分のパスでなければ何もしない (false を返す)。
 * @param {{ config: { allowedOrigins: string[], maxConnections: number }, recorder: { handle: Function }, resolveUserId: () => Promise<string> }} options
 * @implements SPEC-VO-PLAY-STREAM-SOCKET
 */
function createPlayStreamSocket({ config, recorder, resolveUserId }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  let open = 0;

  function serve(ws) {
    open += 1;
    let pending = 0;
    let chain = Promise.resolve();
    ws.on('close', () => { open -= 1; });
    ws.on('error', () => {});
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(CLOSE_UNSUPPORTED);
      if (pending >= MAX_PENDING) return ws.close(CLOSE_POLICY);
      pending += 1;
      const text = data.toString('utf8');
      // 同じ接続のメッセージは届いた順に処理する (session_start より先に記録を書かない)。
      chain = chain
        .then(() => handleText(text))
        .then((reply) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(reply)); })
        .catch(() => ws.close(CLOSE_UNAVAILABLE))
        .finally(() => { pending -= 1; });
    });
  }

  async function handleText(text) {
    const parsed = parsePlayStreamFrame(text);
    if (!parsed.ok) return { type: 'error', code: 'invalid_frame', sessionId: parsed.sessionId, seq: parsed.seq, detail: parsed.detail };
    const userId = await resolveUserId();
    return recorder.handle(userId, parsed.frame);
  }

  function handleUpgrade(request, socket, head) {
    if (pathOf(request.url) !== PLAY_STREAM_SOCKET_PATH) return false;
    const denied = checkPlayStreamReach({ remoteAddress: socket.remoteAddress, headers: request.headers }, config);
    if (denied) {
      rejectUpgrade(socket, denied.status);
      return true;
    }
    if (open >= config.maxConnections) {
      rejectUpgrade(socket, 503);
      return true;
    }
    wss.handleUpgrade(request, socket, head, serve);
    return true;
  }

  function close() {
    for (const client of wss.clients) client.terminate();
    wss.close();
  }

  return { handleUpgrade, close };
}

module.exports = { createPlayStreamSocket, PLAY_STREAM_SOCKET_PATH, MAX_FRAME_BYTES };
