const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateScales } = require('./scaleAggregate');

const voice = (playerKey, gameTitle, scales) => ({ playerKey, record: { gameTitle, scales } });

test('ordinal first: a player is scored against their own other games before players are averaged', () => {
  const items = [
    // "loud": rates everything high; Hot Quest is their usual.
    voice('loud', 'Hot Quest', { geq: { competence_1: 4, competence_2: 4 } }),
    voice('loud', 'Other', { geq: { competence_1: 4, competence_2: 4 } }),
    // "quiet": rates low everywhere except Hot Quest, which is their peak.
    voice('quiet', 'Hot Quest', { geq: { competence_1: 2, competence_2: 2 } }),
    voice('quiet', 'Other', { geq: { competence_1: 0, competence_2: 0 } }),
    voice('quiet', 'Another', { geq: { competence_1: 0, competence_2: 0 } }),
  ];
  const result = aggregateScales(items, 'Hot Quest');
  assert.equal(result.playerCount, 2);
  assert.equal(result.recordCount, 2);
  const competence = result.families.geq.subscales.competence;
  assert.equal(competence.playerCount, 2);
  assert.equal(competence.raw, 3);
  // loud: z 0 (flat), quiet: z = (2 - 2/3) / sd(0,0,2)=0.9428 → 1.4142; mean 0.7071
  assert.equal(competence.z, 0.7071);
  // loud: rank 0.5 (tie with self), quiet: 1 → mean 0.75
  assert.equal(competence.rank, 0.75);
  assert.equal(result.families.pens, undefined);
});

test('null when nobody rated the game on a scale, and unrated players do not count', () => {
  assert.equal(aggregateScales([voice('a', 'Other', { pens: { autonomy: 5 } })], 'Hot Quest'), null);
  assert.equal(aggregateScales([voice('a', 'Hot Quest', null), voice('b', 'Hot Quest', undefined)], 'Hot Quest'), null);
  const result = aggregateScales([
    voice('a', 'Hot Quest', { pens: { autonomy: 5 } }),
    voice('b', 'Hot Quest', { geq: { flow_1: 3 } }),
    voice('c', ' hot quest ', { pens: { autonomy: 7 } }),
  ], 'Hot Quest');
  assert.equal(result.playerCount, 2);
  assert.equal(result.families.pens.subscales.autonomy.playerCount, 1);
  assert.equal(result.families.pens.subscales.autonomy.z, 0);
  assert.equal(result.families.geq.subscales.flow.rank, 0.5);
});

test('output is deterministic for the same input', () => {
  const items = [voice('a', 'G', { geq: { flow_1: 1 } }), voice('b', 'G', { geq: { flow_1: 3 } })];
  assert.deepEqual(aggregateScales(items, 'G'), aggregateScales(items, 'G'));
});
