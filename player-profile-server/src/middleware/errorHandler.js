const MALFORMED_JSON_CODE = 'INVALID_JSON';
const MALFORMED_JSON_MESSAGE = 'Malformed JSON request body';

class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isMalformedJsonError(error) {
  return error?.type === 'entity.parse.failed'
    && (error?.statusCode === 400 || error?.status === 400);
}

function normalizeRequestError(error) {
  if (!isMalformedJsonError(error)) return error;
  return new AppError(400, MALFORMED_JSON_CODE, MALFORMED_JSON_MESSAGE);
}

function errorLogSummary(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR',
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
  };
}

function normalizeJsonBodyError(err, _req, _res, next) {
  return next(normalizeRequestError(err));
}

function errorHandler(rawError, _req, res, _next) {
  const err = normalizeRequestError(rawError);
  console.error('Unhandled error:', errorLogSummary(err));

  const status = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status === 500 ? 'Internal server error' : err.message;

  res.set('Cache-Control', 'private, no-store');
  res.status(status).json({
    ok: false,
    error: { code, message },
  });
}

module.exports = {
  AppError,
  errorHandler,
  normalizeJsonBodyError,
};
