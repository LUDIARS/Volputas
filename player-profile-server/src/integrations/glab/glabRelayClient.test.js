const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGlabRelayClient } = require('./glabRelayClient');

const RELAY_PATH = '/api/x/volputas/external/review-relay';

function fakeFetch(response) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  return { fetchImpl, calls };
}

function ok(status = 200, body = { ok: true }) {
  return { status, async json() { return body; } };
}

test('missing configuration degrades to no client instead of throwing', () => {
  assert.equal(createGlabRelayClient({ baseUrl: '', serviceToken: 'token' }), null);
  assert.equal(createGlabRelayClient({ baseUrl: 'https://glab.example', serviceToken: '' }), null);
  assert.equal(createGlabRelayClient({ baseUrl: '  ', serviceToken: '  ' }), null);
});

test('a non-HTTP(S) base URL is rejected loudly', () => {
  assert.throws(
    () => createGlabRelayClient({ baseUrl: 'ftp://glab.example', serviceToken: 'token' }),
    /absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () => createGlabRelayClient({ baseUrl: 'not a url', serviceToken: 'token' }),
    /absolute HTTP\(S\) URL/,
  );
});

test('the review is posted to the relay endpoint with the service token', async () => {
  const { fetchImpl, calls } = fakeFetch(ok());
  const client = createGlabRelayClient({
    // A trailing slash must not produce a doubled path separator.
    baseUrl: 'https://glab.example/',
    serviceToken: ' token ',
    fetchImpl,
  });
  await client.relayReview({ reviewId: 'r1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://glab.example${RELAY_PATH}`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-Glab-Service-Token'], 'token');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { reviewId: 'r1' });
});

test('the request carries an abort signal so a stalled GLAB cannot hold the post open', async () => {
  const { fetchImpl, calls } = fakeFetch(ok());
  const client = createGlabRelayClient({
    baseUrl: 'https://glab.example',
    serviceToken: 'token',
    fetchImpl,
    timeoutMs: 50,
  });
  await client.relayReview({ reviewId: 'r1' });
  assert.ok(calls[0].options.signal, 'expected an AbortSignal on the relay request');
});

test('both 200 and 201 acknowledge a relay', async () => {
  for (const status of [200, 201]) {
    const { fetchImpl } = fakeFetch(ok(status, { received: status }));
    const client = createGlabRelayClient({
      baseUrl: 'https://glab.example',
      serviceToken: 'token',
      fetchImpl,
    });
    assert.deepEqual(await client.relayReview({ reviewId: 'r1' }), { received: status });
  }
});

test('an acknowledgement without a JSON body still resolves', async () => {
  const { fetchImpl } = fakeFetch({
    status: 201,
    async json() { throw new SyntaxError('Unexpected end of JSON input'); },
  });
  const client = createGlabRelayClient({
    baseUrl: 'https://glab.example',
    serviceToken: 'token',
    fetchImpl,
  });
  assert.deepEqual(await client.relayReview({ reviewId: 'r1' }), {});
});

test('a rejected relay throws with the status and never leaks the token', async () => {
  const { fetchImpl } = fakeFetch(ok(403, { error: 'forbidden' }));
  const client = createGlabRelayClient({
    baseUrl: 'https://glab.example',
    serviceToken: 'super-secret-token',
    fetchImpl,
  });
  await assert.rejects(
    () => client.relayReview({ reviewId: 'r1' }),
    (error) => {
      assert.match(error.message, /status 403/);
      assert.ok(!error.message.includes('super-secret-token'));
      return true;
    },
  );
});
