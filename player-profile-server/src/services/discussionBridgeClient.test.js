const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, verify } = require('node:crypto');
const {
  DiscussionBridgeClient,
  PERSONA_ASSERTION_HEADER,
  normalizeBridgeBaseUrl,
  validateBridgeResponse,
} = require('./discussionBridgeClient');
const {
  ASSERTION_AUDIENCE,
  ASSERTION_TTL_SECONDS,
  DiscussionBridgeAssertionSigner,
} = require('./discussionBridgeAssertion');

test('discussion bridge client sends separate bearer and signed author assertion headers', async () => {
  let requested;
  const nowMs = Date.parse('2026-08-06T00:00:00.000Z');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const encodedPrivateKey = Buffer.from(privateKey.export({
    format: 'der',
    type: 'pkcs8',
  })).toString('base64url');
  const client = new DiscussionBridgeClient({
    baseUrl: 'http://127.0.0.1:9999/',
    token: 'bridge-secret',
    assertionSigner: new DiscussionBridgeAssertionSigner({
      privateKey: encodedPrivateKey,
      now: () => nowMs,
      createJti: () => 'assertion-request-0001',
    }),
    fetchImpl: async (url, options) => {
      requested = { url: String(url), options };
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            utterances: [{
              text: 'This mechanic felt rewarding.',
              createdAt: '2026-07-28T00:00:00.000Z',
            }],
            nextCursor: null,
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
  assert.equal(requested.url.includes(encodedPrivateKey), false);
  assert.equal(requested.options.headers.Authorization, 'Bearer bridge-secret');
  assert.equal(requested.options.redirect, 'error');
  assert.equal(PERSONA_ASSERTION_HEADER, 'x-discutere-persona-assertion');
  const compact = requested.options.headers[PERSONA_ASSERTION_HEADER];
  assert.equal(typeof compact, 'string');
  assert.equal(compact.includes(encodedPrivateKey), false);
  const [payloadSegment, signatureSegment] = compact.split('.');
  assert.equal(verify(
    null,
    Buffer.from(payloadSegment, 'utf8'),
    publicKey,
    Buffer.from(signatureSegment, 'base64url')
  ), true);
  assert.deepEqual(JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')), {
    authorId: '123456789012345678',
    aud: ASSERTION_AUDIENCE,
    exp: Math.floor(nowMs / 1_000) + ASSERTION_TTL_SECONDS,
    jti: 'assertion-request-0001',
  });
});

test('discussion bridge client requires an assertion signer', async () => {
  const client = new DiscussionBridgeClient({
    baseUrl: 'http://127.0.0.1:9999/',
    token: 'bridge-secret',
    fetchImpl: async () => {
      throw new Error('must not contact Di without the assertion signer');
    },
  });
  await assert.rejects(client.listUtterances({ authorId: '123456789012345678' }), {
    code: 'DISCUTERE_BRIDGE_UNAVAILABLE',
    statusCode: 503,
  });
});

test('discussion bridge client rejects a signing key reused as its bearer token', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const encodedPrivateKey = Buffer.from(privateKey.export({
    format: 'der',
    type: 'pkcs8',
  })).toString('base64url');

  assert.throws(() => new DiscussionBridgeClient({
    baseUrl: 'https://discutere.example/',
    token: encodedPrivateKey,
    assertionPrivateKey: encodedPrivateKey,
  }), {
    code: 'DISCUTERE_BRIDGE_CONFIG_INVALID',
    statusCode: 503,
  });
});

test('discussion bridge client rejects an invalid injected assertion signer', () => {
  assert.throws(() => new DiscussionBridgeClient({
    baseUrl: 'https://discutere.example/',
    token: 'bridge-secret',
    assertionSigner: {},
  }), {
    code: 'DISCUTERE_BRIDGE_CONFIG_INVALID',
    statusCode: 503,
  });
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

test('discussion bridge response preserves opaque cursors and rejects invalid values', () => {
  const utterance = {
    text: 'valid',
    createdAt: '2026-07-28T00:00:00.000Z',
  };
  assert.equal(validateBridgeResponse({
    ok: true,
    utterances: [utterance],
    nextCursor: 'opaque.cursor+page/2=',
  }).nextCursor, 'opaque.cursor+page/2=');
  assert.throws(() => validateBridgeResponse({
    ok: true,
    utterances: [utterance],
    nextCursor: '',
  }), {
    code: 'DISCUTERE_BRIDGE_RESPONSE_INVALID',
  });
  assert.throws(() => validateBridgeResponse({
    ok: true,
    utterances: [{ ...utterance, text: 'x'.repeat(8_001) }],
    nextCursor: null,
  }), {
    code: 'DISCUTERE_BRIDGE_RESPONSE_INVALID',
  });
});

test('discussion bridge client rejects a non-string Discord identity before signing', async () => {
  const client = new DiscussionBridgeClient({
    baseUrl: 'http://127.0.0.1:9999/',
    token: 'bridge-secret',
    assertionSigner: {
      signForAuthor() {
        throw new Error('must not sign an invalid identity');
      },
    },
    fetchImpl: async () => {
      throw new Error('must not contact Di with an invalid identity');
    },
  });
  await assert.rejects(client.listUtterances({ authorId: 12345 }), {
    code: 'DISCORD_IDENTITY_INVALID',
    statusCode: 409,
  });
});

test('discussion bridge follows opaque cursors with a fresh assertion per page', async () => {
  const requests = [];
  let assertionNumber = 0;
  const client = new DiscussionBridgeClient({
    baseUrl: 'http://127.0.0.1:9999/',
    token: 'bridge-secret',
    assertionSigner: {
      signForAuthor(authorId) {
        assertionNumber += 1;
        return `assertion-${authorId}-${assertionNumber}`;
      },
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return requests.length === 1
            ? {
              ok: true,
              utterances: [{ text: 'first', createdAt: '2026-07-28T00:00:00.000Z' }],
              nextCursor: 'opaque_cursor_0001',
            }
            : {
              ok: true,
              utterances: [{ text: 'second', createdAt: '2026-07-28T00:00:00.001Z' }],
              nextCursor: null,
            };
        },
      };
    },
  });

  assert.deepEqual(await client.listUtterances({
    authorId: '123456789012345678',
    since: 100,
  }), [
    { text: 'first', createdAt: '2026-07-28T00:00:00.000Z' },
    { text: 'second', createdAt: '2026-07-28T00:00:00.001Z' },
  ]);
  assert.match(requests[0].url, /since=100/);
  assert.equal(requests[0].url.includes('cursor='), false);
  assert.match(requests[1].url, /cursor=opaque_cursor_0001/);
  assert.equal(requests[1].url.includes('since='), false);
  assert.notEqual(
    requests[0].options.headers[PERSONA_ASSERTION_HEADER],
    requests[1].options.headers[PERSONA_ASSERTION_HEADER]
  );
});
