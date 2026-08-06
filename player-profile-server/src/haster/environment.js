const HASTER_ENVIRONMENT = 'HASTER';

// @implements SPEC-HASTER-ISOLATION
function isHasterEnvironment(env = process.env) {
  return env.VOLPUTAS_ENVIRONMENT === HASTER_ENVIRONMENT;
}

// @implements SPEC-HASTER-ISOLATION
function deriveHasterDatabaseUrl(connectionString) {
  const url = new URL(connectionString);
  const database = url.pathname.replace(/^\/+/, '');
  if (!database) throw new Error('HASTER requires a named PostgreSQL database');
  if (!database.endsWith('_haster')) url.pathname = `/${database}_haster`;
  return url.toString();
}

// @implements SPEC-HASTER-ISOLATION
function isLoopbackUrl(value) {
  const url = new URL(value);
  return url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
}

// @implements SPEC-HASTER-ISOLATION
function assertHasterConfiguration(config) {
  if (!config.haster.enabled) return;
  if (config.nodeEnv === 'production') {
    throw new Error('HASTER must never run with NODE_ENV=production');
  }
  if (!isLoopbackUrl(config.frontendUrl) || !isLoopbackUrl(config.jwt.issuer)) {
    throw new Error('HASTER must use loopback frontend and issuer URLs');
  }
  const database = new URL(config.db.connectionString).pathname.replace(/^\/+/, '');
  if (!database.endsWith('_haster')) {
    throw new Error('HASTER must use a database whose name ends with _haster');
  }
}

module.exports = {
  HASTER_ENVIRONMENT,
  assertHasterConfiguration,
  deriveHasterDatabaseUrl,
  isHasterEnvironment,
  isLoopbackUrl,
};
