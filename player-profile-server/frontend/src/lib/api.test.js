import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.js';

test('treats a successful 204 response as an empty API result', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    assert.deepEqual(await api('/api/v1/resource', { method: 'DELETE' }), { ok: true, data: null });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});
