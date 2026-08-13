// Startup wiring for the companion listener: env parsing, optional TLS, and
// LAN address discovery for the desktop UI. Fail-fast on partial configuration
// (§7.1/§9): a typo'd port or a missing key file must abort startup, not
// silently run without the companion.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');

// Returns null when the companion is not configured (a genuine opt-out), and
// throws when it is configured incorrectly.
function readCompanionConfig(env = process.env) {
  const rawPort = env.VOLPUTAS_COMPANION_PORT;
  if (rawPort === undefined || rawPort === '') return null;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('VOLPUTAS_COMPANION_PORT must be a valid TCP port');
  }
  const host = env.VOLPUTAS_COMPANION_HOST || '0.0.0.0';
  const certFile = env.VOLPUTAS_COMPANION_TLS_CERT_FILE || '';
  const keyFile = env.VOLPUTAS_COMPANION_TLS_KEY_FILE || '';
  if ((certFile === '') !== (keyFile === '')) {
    throw new Error(
      'VOLPUTAS_COMPANION_TLS_CERT_FILE and VOLPUTAS_COMPANION_TLS_KEY_FILE must be set together'
    );
  }
  if (certFile === '' && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Companion TLS certificate and key are required for a non-loopback listener');
  }
  return {
    port,
    host,
    tls: certFile === '' ? null : { certFile, keyFile },
  };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

function startCompanionListener(app, config) {
  let server;
  if (config.tls) {
    // Read synchronously at startup so a bad path fails before listen.
    server = https.createServer({
      cert: fs.readFileSync(config.tls.certFile),
      key: fs.readFileSync(config.tls.keyFile),
    }, app);
  } else {
    server = http.createServer(app);
  }
  server.listen(config.port, config.host);
  return server;
}

// Snapshot for GET /api/local/capture-sessions/companion/status: tells the
// desktop UI whether the listener runs and which URLs the phone can try.
function companionStatus(config) {
  if (!config) return { enabled: false };
  const scheme = config.tls ? 'https' : 'http';
  const addresses = ['127.0.0.1', '::1', 'localhost'].includes(config.host)
    ? [config.host]
    : lanAddresses();
  return {
    enabled: true,
    secure: Boolean(config.tls),
    port: config.port,
    urls: addresses.map((address) => {
      const urlHost = address.includes(':') ? `[${address}]` : address;
      return `${scheme}://${urlHost}:${config.port}/`;
    }),
  };
}

module.exports = { companionStatus, lanAddresses, readCompanionConfig, startCompanionListener };
