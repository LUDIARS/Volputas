class ProcessingError extends Error {
  constructor(message, permanent) {
    super(message);
    this.permanent = permanent;
  }
}

module.exports = { ProcessingError };
