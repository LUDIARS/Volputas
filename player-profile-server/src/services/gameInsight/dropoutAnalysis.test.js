const test = require('node:test');
const assert = require('node:assert/strict');
const { binCenters } = require('../narrativeArc/arcSeries');
const { analyzeDropouts, exitValence } = require('./dropoutAnalysis');

function session(playerKey, recordId, endPosition, valence) {
  return { playerKey, recordId, endPosition, series: { valence } };
}

test('survival curve drops where sessions end and the last bin is completion', () => {
  const binCount = 10;
  const centers = binCenters(binCount);
  const flat = Array(binCount).fill(0);
  const result = analyzeDropouts([
    session('p1', 'a', 1, flat),
    session('p2', 'b', 0.32, flat.map((_, index) => (index <= 3 ? -1.5 : null))),
    session('p3', 'c', 0.35, flat.map((_, index) => (index <= 3 ? -0.5 : null))),
    session('p3', 'd', 0.75, flat),
    { playerKey: 'p4', recordId: 'm', endPosition: null, series: { valence: flat } },
  ], { binCount, centers });
  assert.equal(result.timedSessionCount, 4);
  assert.equal(result.survival[0], 1);
  assert.equal(result.survival[4], 0.5); // b, c ended around 0.3
  assert.equal(result.survival[9], 0.25); // only a reaches the end
  assert.equal(result.completion.sessionCount, 1);
  assert.equal(result.completion.share, 0.25);
  assert.equal(result.dropouts[0].bin, 3);
  assert.equal(result.dropouts[0].sessionCount, 2);
  assert.equal(result.dropouts[0].playerCount, 2);
  assert.equal(result.dropouts[0].exitValence, -1);
  assert.deepEqual(result.dropouts[0].recordIds, ['b', 'c']);
  assert.equal(result.dropouts[1].bin, 7);
});

test('no time-axis sessions yields a null survival curve and no dropouts', () => {
  const centers = binCenters(5);
  const result = analyzeDropouts([{ playerKey: 'p', recordId: 'm', endPosition: null, series: { valence: [] } }], { binCount: 5, centers });
  assert.deepEqual(result.survival, [null, null, null, null, null]);
  assert.deepEqual(result.dropouts, []);
  assert.equal(result.completion.share, null);
});

test('exit valence averages the trailing bins that have values', () => {
  assert.equal(exitValence({ series: { valence: [null, 1, -1, null] } }, 2), 0);
  assert.equal(exitValence({ series: { valence: [null, null] } }, 1), null);
});
