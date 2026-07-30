const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DiscussionBridgeClient,
  normalizeBridgeBaseUrl,
  validateBridgeResponse,
} = require('./discussionBridgeClient');

test('discussion bridge client sends the secret only as a bearer header', async () => {
  let requested;
  const client = new DiscussionBridgeClient({
    baseUrl: 'http://127.0.0.1:9999/',
    token: 'bridge-secret',
    fetchImpl: async (url, options) => {
      requested = { url: String(url), options };
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            utterances: [{
              id: 'utterance-1',
              text: 'This mechanic felt rewarding.',
              createdAt: '2026-07-28T00:00:00.000Z',
            }],
          };
        },
      };
    },
  });

  const result = await client.listUtterances({
    authorId: '123456789012345678',
    since: 100,
  });
  assert.equal(result.length, 1);
  assert.match(requested.url, /authorId=123456789012345678/);
  assert.match(requested.url, /since=100/);
  assert.equal(requested.url.includes('bridge-secret'), false);
  assert.equal(requested.options.headers.Authorization, 'Bearer bridge-secret');
});

test('discussion bridge URL rejects non-loopback plaintext and credentials', () => {
  assert.throws(() => normalizeBridgeBaseUrl('http://example.test'), {
    code: 'DISCUTERE_BRIDGE_CONFIG_INVALID',
  });
  assert.throws(() => normalizeBridgeBaseUrl('https://user:pass@example.test'), {
    code: 'DISCUTERE_BRIDGE_CONFIG_INVALID',
  });
  assert.equal(normalizeBridgeBaseUrl('https://example.test').origin, 'https://example.test');
});

test('discussion bridge response rejects duplicate ids and oversized text', () => {
  const utterance = {
    id: 'same',
    text: 'valid',
    createdAt: '2026-07-28T00:00:00.000Z',
  };
  assert.throws(() => validateBridgeResponse({
    ok: true,
    utterances: [utterance, utterance],
  }), {
    code: 'DISCUTERE_BRIDGE_RESPONSE_INVALID',
  });
  assert.throws(() => validateBridgeResponse({
    ok: true,
    utterances: [{ ...utterance, text: 'x'.repeat(8_001) }],
  }), {
    code: 'DISCUTERE_BRIDGE_RESPONSE_INVALID',
  });
});
