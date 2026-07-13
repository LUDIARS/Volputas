class DelegationError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'DelegationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = { DelegationError };
