const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AudioToWavConverter } = require('./audioToWav');

function fakeSpawn({ exitCode = 0, error = null, stderr = '' } = {}) {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', exitCode);
    });
    return child;
  };
  return { calls, spawnImpl };
}

test('converts with an explicit 16kHz mono argv and cleans up the temp wav', async () => {
  const { calls, spawnImpl } = fakeSpawn();
  const converter = new AudioToWavConverter({ ffmpegPath: 'ffmpeg', spawnImpl });
  let seenWavPath;
  const result = await converter.withWav('input.webm', async (wavPath) => {
    seenWavPath = wavPath;
    return 'used';
  });
  assert.equal(result, 'used');
  assert.equal(calls.length, 1);
  const { args } = calls[0];
  assert.ok(args.includes('input.webm'));
  for (const expected of [['-ac', '1'], ['-ar', '16000'], ['-f', 'wav']]) {
    const index = args.indexOf(expected[0]);
    assert.ok(index >= 0 && args[index + 1] === expected[1], expected.join(' '));
  }
  assert.equal(args[args.length - 1], seenWavPath);
});

test('a missing ffmpeg binary is a 503 with an actionable message', async () => {
  const { spawnImpl } = fakeSpawn({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) });
  const converter = new AudioToWavConverter({ ffmpegPath: 'ffmpeg-missing', spawnImpl });
  await assert.rejects(converter.withWav('input.webm', async () => {}), (error) => {
    assert.equal(error.code, 'FFMPEG_NOT_AVAILABLE');
    assert.equal(error.statusCode, 503);
    assert.match(error.message, /VOLPUTAS_FFMPEG/);
    return true;
  });
});

test('a failing conversion surfaces ffmpeg stderr, not a silent empty result', async () => {
  const { spawnImpl } = fakeSpawn({ exitCode: 1, stderr: 'Invalid data found when processing input' });
  const converter = new AudioToWavConverter({ spawnImpl });
  await assert.rejects(
    converter.withWav('input.webm', async () => {}),
    /Invalid data found/
  );
});
