const path = require('node:path');
const { createLocalApp } = require('../src/localApp');

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('Volputas desktop server must run as an Electron utility process');
}

let server;

function closeServer() {
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
}

try {
  const frontendDirectory = path.resolve(__dirname, '../frontend/dist');
  server = createLocalApp({ frontendDirectory }).listen(0, '127.0.0.1', () => {
    const address = server.address();
    parentPort.postMessage({
      type: 'ready',
      url: `http://127.0.0.1:${address.port}`,
    });
  });
  server.on('error', (error) => {
    process.stderr.write(`Volputas desktop server failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  process.once('SIGTERM', closeServer);
  parentPort.once('message', (event) => {
    if (event.data?.type === 'shutdown') closeServer();
  });
} catch (error) {
  process.stderr.write(`Volputas desktop startup failed: ${error.message}\n`);
  process.exitCode = 1;
}
