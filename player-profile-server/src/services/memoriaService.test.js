const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoriaServiceError, normalizeBaseUrl, fetchPersonalityFeatures } = require('./memoriaService');

function withFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = handler;
  return fn().finally(() => {
    global.fetch = original;
  });
}

test('normalizeBaseUrl requires an http(s) URL and strips trailing slashes', () => {
  assert.equal(normalizeBaseUrl('http://localhost:5180/'), 'http://localhost:5180');
  assert.throws(() => normalizeBaseUrl('localhost:5180'), MemoriaServiceError);
  assert.throws(() => normalizeBaseUrl(''), MemoriaServiceError);
});

test('fetchPersonalityFeatures sends a Bearer token and returns the parsed axes', async () => {
  let capturedUrl;
  let capturedAuth;
  await withFetch(
    async (url, opts) => {
      capturedUrl = url;
      capturedAuth = opts.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ axes: [{ id: 'structuring', score: 0.5 }], sampleWindowDays: 90 }) };
    },
    async () => {
      const result = await fetchPersonalityFeatures('http://localhost:5180', 'secret-token');
      assert.equal(capturedUrl, 'http://localhost:5180/api/external/personality-features');
      assert.equal(capturedAuth, 'Bearer secret-token');
      assert.equal(result.axes.length, 1);
    }
  );
});

test('fetchPersonalityFeatures maps 404 to MEMORIA_NOT_AVAILABLE', async () => {
  await withFetch(
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    async () => {
      await assert.rejects(
        () => fetchPersonalityFeatures('http://localhost:5180', 'bad-token'),
        (err) => err instanceof MemoriaServiceError && err.code === 'MEMORIA_NOT_AVAILABLE'
      );
    }
  );
});

test('fetchPersonalityFeatures rejects when Memoria is unreachable', async () => {
  await withFetch(
    async () => { throw new Error('ECONNREFUSED'); },
    async () => {
      await assert.rejects(
        () => fetchPersonalityFeatures('http://localhost:5180', 'token'),
        (err) => err instanceof MemoriaServiceError && err.code === 'MEMORIA_UNREACHABLE'
      );
    }
  );
});

test('fetchPersonalityFeatures rejects a malformed response body', async () => {
  await withFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ notAxes: true }) }),
    async () => {
      await assert.rejects(
        () => fetchPersonalityFeatures('http://localhost:5180', 'token'),
        (err) => err instanceof MemoriaServiceError && err.code === 'MEMORIA_INVALID_RESPONSE'
      );
    }
  );
});
