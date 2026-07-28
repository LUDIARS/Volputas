class CernereIntegrationError extends Error {
  constructor(message, { code = 'CERNERE_UPSTREAM_ERROR', statusCode = 502 } = {}) {
    super(message);
    this.name = 'CernereIntegrationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class CernereConfigurationError extends CernereIntegrationError {
  constructor(message) {
    super(message, {
      code: 'CORPUS_INTEGRATION_UNAVAILABLE',
      statusCode: 503,
    });
    this.name = 'CernereConfigurationError';
  }
}

class InvalidCernereTokenError extends Error {
  constructor() {
    super('Invalid Cernere project token');
    this.name = 'InvalidCernereTokenError';
    this.code = 'CERNERE_UNAUTHORIZED';
    this.statusCode = 401;
  }
}

module.exports = {
  CernereConfigurationError,
  CernereIntegrationError,
  InvalidCernereTokenError,
};
