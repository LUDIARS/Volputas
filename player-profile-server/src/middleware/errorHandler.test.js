const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  AppError,
  errorHandler,
  normalizeJsonBodyError,
} = require('./errorHandler');

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

function malformedJsonError(secretBody) {
  return Object.assign(new SyntaxError('Unexpected token in JSON'), {
    type: 'entity.parse.failed',
    status: 400,
    statusCode: 400,
    body: secretBody,
  });
}

test('normalizes JSON parser failures immediately after body parsing', () => {
  const appSource = readFileSync(resolve(__dirname, '..', 'app.js'), 'utf8');
  const parserIndex = appSource.indexOf("app.use(express.json({ limit: '1mb' }));");
  const normalizerIndex = appSource.indexOf('app.use(normalizeJsonBodyError);');
  const firstRouteIndex = appSource.indexOf(
    "app.use('/.well-known/corpus-service.json'",
  );

  assert.ok(parserIndex >= 0);
  assert.ok(normalizerIndex > parserIndex);
  assert.ok(firstRouteIndex > normalizerIndex);
});

test('normalizes malformed JSON without retaining its request body', () => {
  const secret = 'answer-canary-secret';
  let forwarded;
  normalizeJsonBodyError(
    malformedJsonError(secret),
    {},
    {},
    (error) => {
      forwarded = error;
    },
  );

  assert.ok(forwarded instanceof AppError);
  assert.equal(forwarded.statusCode, 400);
  assert.equal(forwarded.code, 'INVALID_JSON');
  assert.equal(forwarded.message, 'Malformed JSON request body');
  assert.equal(Object.hasOwn(forwarded, 'body'), false);
  assert.doesNotMatch(JSON.stringify(forwarded), /answer-canary-secret/);
});

test('returns a safe malformed JSON contract and logs only a redacted summary', () => {
  const secret = 'answer-canary-secret';
  const response = responseRecorder();
  const logCalls = [];
  const originalConsoleError = console.error;
  console.error = (...values) => {
    logCalls.push(values);
  };
  try {
    errorHandler(malformedJsonError(secret), {}, response, () => {});
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: 'INVALID_JSON',
      message: 'Malformed JSON request body',
    },
  });
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.doesNotMatch(JSON.stringify(logCalls), /answer-canary-secret/);
});

test('preserves existing AppError response behavior', () => {
  const response = responseRecorder();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    errorHandler(
      new AppError(409, 'EXISTING_CONTRACT', 'Existing contract message'),
      {},
      response,
      () => {},
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: 'EXISTING_CONTRACT',
      message: 'Existing contract message',
    },
  });
});

test('does not log an unexpected error message that may contain submitted values', () => {
  const response = responseRecorder();
  const logCalls = [];
  const originalConsoleError = console.error;
  console.error = (...values) => {
    logCalls.push(values);
  };
  try {
    errorHandler(
      new Error('upstream failed near answer-canary-secret'),
      {},
      response,
      () => {},
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error.message, 'Internal server error');
  assert.doesNotMatch(JSON.stringify(logCalls), /answer-canary-secret/);
});
