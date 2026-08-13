const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WhisperSttClient } = require('./sttClient');

async function wavFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-stt-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const wavPath = path.join(directory, 'capture.wav');
  await fs.writeFile(wavPath, Buffer.from('RIFF-fake'));
  return wavPath;
}

test('an unset URL is a NOT_CONFIGURED error, never a silent no-op', async () => {
  const client = new WhisperSttClient({ baseUrl: '' });
  await assert.rejects(client.transcribeWavFile('x.wav'), (error) => {
    assert.equal(error.code, 'STT_NOT_CONFIGURED');
    assert.equal(error.statusCode, 503);
    return true;
  });
});

test('verbose segments become millisecond utterances; annotations are dropped', async (t) => {
  let requestedUrl;
  const client = new WhisperSttClient({
    baseUrl: 'http://127.0.0.1:1/',
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      assert.equal(options.method, 'POST');
      assert.ok(options.body instanceof FormData);
      assert.equal(options.redirect, 'error');
      return {
        ok: true,
        json: async () => ({
          segments: [
            { start: 1.25, end: 2.5, text: ' 楽しい！ ' },
            { start: 3, end: 4, text: ' [BGM] ' },
          ],
        }),
      };
    },
  });
  const segments = await client.transcribeWavFile(await wavFixture(t));
  assert.equal(requestedUrl, 'http://127.0.0.1:1/inference');
  assert.deepEqual(segments, [{ startMs: 1250, endMs: 2500, text: '楽しい！' }]);
});

test('plain-text responses fall back to a single whole-file segment', async (t) => {
  const client = new WhisperSttClient({
    baseUrl: 'http://127.0.0.1:1',
    fetchImpl: async () => ({ ok: true, json: async () => ({ text: 'まとめて一本' }) }),
  });
  assert.deepEqual(await client.transcribeWavFile(await wavFixture(t)), [
    { startMs: 0, endMs: 0, text: 'まとめて一本' },
  ]);
});

test('server errors and shapeless responses surface as 502', async (t) => {
  const failing = new WhisperSttClient({
    baseUrl: 'http://127.0.0.1:1',
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  await assert.rejects(failing.transcribeWavFile(await wavFixture(t)), /HTTP 500/);

  const shapeless = new WhisperSttClient({
    baseUrl: 'http://127.0.0.1:1',
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(shapeless.transcribeWavFile(await wavFixture(t)), /neither segments nor text/);
});

test('whisper.cpp t0/t1 ticks are converted from 10 ms units', async (t) => {
  const client = new WhisperSttClient({
    baseUrl: 'http://127.0.0.1:1',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ segments: [{ t0: 125, t1: 250, text: 'タイムスタンプ' }] }),
    }),
  });
  assert.deepEqual(await client.transcribeWavFile(await wavFixture(t)), [
    { startMs: 1250, endMs: 2500, text: 'タイムスタンプ' },
  ]);
});

test('only credential-free loopback STT URLs are accepted', async () => {
  for (const baseUrl of ['https://example.com', 'http://127.0.0.1:1@evil.example', 'not a URL']) {
    const client = new WhisperSttClient({ baseUrl });
    await assert.rejects(client.transcribeWavFile('x.wav'), (error) => {
      assert.equal(error.code, 'STT_URL_INVALID');
      assert.equal(error.statusCode, 503);
      return true;
    });
  }
});

test('invalid STT segment times are refused instead of being saved', async (t) => {
  const client = new WhisperSttClient({
    baseUrl: 'http://127.0.0.1:1',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ segments: [{ start: 3, end: 2, text: 'bad time' }] }),
    }),
  });
  await assert.rejects(client.transcribeWavFile(await wavFixture(t)), (error) => {
    assert.equal(error.code, 'STT_RESPONSE_INVALID');
    return true;
  });
});

test('malformed STT segments are refused', async (t) => {
  const client = new WhisperSttClient({
    baseUrl: 'http://127.0.0.1:1',
    fetchImpl: async () => ({ ok: true, json: async () => ({ segments: [null] }) }),
  });
  await assert.rejects(client.transcribeWavFile(await wavFixture(t)), (error) => {
    assert.equal(error.code, 'STT_RESPONSE_INVALID');
    return true;
  });
});
