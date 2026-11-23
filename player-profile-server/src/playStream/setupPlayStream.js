// プレイ記録の口を組み立てる (spec/feature/ludellus-play-stream.md)。
// VOLUPTAS_PLAY_STREAM_RELAY_TOKEN が無ければ null を返し、WebSocket も統計 API も開かない。

const db = require('../config/database');
const { runPostSessionJobs } = require('../services/sessionJobs');
const { readPlayStreamConfig } = require('./playStreamConfig');
const { createCernereUserResolver } = require('./playStreamIdentity');
const { createPlayStreamRecorder } = require('./playStreamRecorder');
const { createPlayStreamRouter } = require('./playStreamRoutes');
const { createPlayStreamSocket } = require('./playStreamSocket');
const { createPlayStreamStore } = require('./playStreamStore');
const { startPlayStreamIdleCloser } = require('./playStreamIdleCloser');

function setupPlayStream(env, { hasterEnabled }) {
  const config = readPlayStreamConfig(env, { hasterEnabled });
  if (!config) return null;
  const store = createPlayStreamStore(db);
  const resolveUserId = createCernereUserResolver();
  const recorder = createPlayStreamRecorder({ store, runPostSessionJobs });
  return {
    router: createPlayStreamRouter({ config, store, resolveUserId }),
    socket: createPlayStreamSocket({ config, recorder, resolveUserId }),
    /** 終わりが届かなかったセッションを定期的に締める。止める関数を返す。 */
    startIdleCloser: () => startPlayStreamIdleCloser({ store, runPostSessionJobs }),
  };
}

module.exports = { setupPlayStream };
