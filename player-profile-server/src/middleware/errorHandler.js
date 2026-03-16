function errorHandler(err, req, res, _next) {
  console.error('Unhandled error:', err);

  const status = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status === 500 ? 'Internal server error' : err.message;

  res.status(status).json({
    ok: false,
    error: { code, message },
  });
}

class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = { errorHandler, AppError };
