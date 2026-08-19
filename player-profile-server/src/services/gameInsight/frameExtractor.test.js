const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { FrameExtractor } = require('./frameExtractor');

function fakeChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test('frame extractor invokes ffmpeg without a shell and resolves on exit zero', async () => {
  let call = null;
  const child = fakeChild();
  const extractor = new FrameExtractor({
    ffmpegPath: 'ffmpeg-test',
    spawnImpl: (command, args, options) => {
      call = { command, args, options };
      setImmediate(() => child.emit('close', 0));
      return child;
    },
  });

  await extractor.runFfmpeg(['-i', 'video.webm', 'frame.jpg']);
  assert.deepEqual(call, {
    command: 'ffmpeg-test',
    args: ['-i', 'video.webm', 'frame.jpg'],
    options: { stdio: ['ignore', 'ignore', 'pipe'] },
  });
});

test('frame extractor kills a hung ffmpeg process at its timeout', async () => {
  const child = fakeChild();
  const extractor = new FrameExtractor({ spawnImpl: () => child, timeoutMs: 1 });
  await assert.rejects(
    extractor.runFfmpeg([]),
    (error) => error.code === 'FRAME_EXTRACTION_TIMEOUT' && error.statusCode === 504
  );
  assert.equal(child.killed, true);
});
