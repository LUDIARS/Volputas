const test = require('node:test');
const assert = require('node:assert/strict');
const { MediaProcessor } = require('./mediaProcessor');

function processor() {
  return new MediaProcessor({ storage: {}, commandRunner: {} });
}

test('requires exactly one decodable visual stream', () => {
  assert.throws(
    () => processor().requireSingleVideoStream({ streams: [] }),
    /exactly one/
  );
  assert.throws(
    () => processor().requireSingleVideoStream({ streams: [
      { codec_type: 'video', width: 1920, height: 1080 },
      { codec_type: 'video', width: 320, height: 180 },
    ] }),
    /exactly one/
  );
});

test('rejects decompression-bomb dimensions before conversion', () => {
  assert.throws(
    () => processor().validateDimensions({ width: 16_384, height: 16_384 }, 67_108_864),
    /safety limit/
  );
  assert.doesNotThrow(
    () => processor().validateDimensions({ width: 3840, height: 2160 }, 33_554_432)
  );
});

test('selects the long-video limit only for Volputas web reviews', () => {
  assert.equal(
    processor().maximumVideoDurationMs({ client: { source: 'volputas_web_review' } }),
    2 * 60 * 60 * 1000
  );
  assert.equal(processor().maximumVideoDurationMs({ client: { source: 'spectator' } }), 30_000);
  assert.equal(processor().maximumVideoDurationMs({}), 30_000);
});
