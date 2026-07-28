const test = require('node:test');
const assert = require('node:assert/strict');
const { MediaCommandRunner } = require('./mediaCommandRunner');

test('transcodes the entire allowed web review instead of truncating at 30 seconds', async () => {
  const runner = new MediaCommandRunner({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', antivirusPath: 'scan' });
  let argumentsList;
  runner.runFfmpeg = async (input) => { argumentsList = input; };
  await runner.transcodeVideo('input.mp4', 'output.mp4', 2 * 60 * 60 * 1000);
  const durationIndex = argumentsList.indexOf('-t');
  assert.equal(argumentsList[durationIndex + 1], '7200');
});

test('rejects a missing transcode duration limit', async () => {
  const runner = new MediaCommandRunner({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', antivirusPath: 'scan' });
  await assert.rejects(runner.transcodeVideo('input.mp4', 'output.mp4'), /duration limit/);
});
