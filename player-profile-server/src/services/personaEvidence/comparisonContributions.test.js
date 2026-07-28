const test = require('node:test');
const assert = require('node:assert/strict');
const { bradleyTerryStrengths, comparisonContributions } = require('./comparisonContributions');
const { EXPERIENCE_CARDS } = require('./experienceCards');
const { validateComparisonInput } = require('../profileEvidenceSchemas');
const { PREFERENCE_AXES } = require('../preferenceAxisDefinitions');

test('experience deck stays inside the canonical axis vocabulary', () => {
  const axisSet = new Set(PREFERENCE_AXES);
  for (const card of EXPERIENCE_CARDS) {
    for (const [axis, share] of card.axes) {
      assert.ok(axisSet.has(axis), `${card.id} references unknown axis ${axis}`);
      assert.ok(share > 0 && share <= 1);
    }
  }
  assert.equal(new Set(EXPERIENCE_CARDS.map((card) => card.id)).size, EXPERIENCE_CARDS.length);
});

test('comparison input validation enforces winner and distinct items', () => {
  const record = validateComparisonInput({ itemA: 'x', itemB: 'y', winner: 'a' });
  assert.deepEqual(record, { kind: 'experience', itemA: 'x', itemB: 'y', winner: 'a' });
  assert.throws(() => validateComparisonInput({ itemA: 'x', itemB: 'x', winner: 'a' }));
  assert.throws(() => validateComparisonInput({ itemA: 'x', itemB: 'y', winner: 'c' }));
});

test('bradley-terry is deterministic and ranks consistent winners highest', () => {
  const matches = [
    { itemA: 'a', itemB: 'b', winner: 'a' },
    { itemA: 'a', itemB: 'c', winner: 'a' },
    { itemA: 'b', itemB: 'c', winner: 'a' },
    { itemA: 'a', itemB: 'b', winner: 'a' },
  ];
  const first = bradleyTerryStrengths(matches);
  const second = bradleyTerryStrengths([...matches]);
  assert.deepEqual(first, second);
  assert.equal(first.a, 1);
  assert.ok(first.a > first.b);
  assert.ok(first.b > first.c);
});

test('comparison contributions project card strengths onto their axes', () => {
  const records = [
    { kind: 'experience', itemA: 'exp-story-ending', itemB: 'exp-compete-rank', winner: 'a' },
    { kind: 'experience', itemA: 'exp-story-ending', itemB: 'exp-relax-heal', winner: 'a' },
    // Unknown ids and game comparisons are ignored.
    { kind: 'experience', itemA: 'nope', itemB: 'exp-relax-heal', winner: 'a' },
    { kind: 'game', itemA: 'Zelda', itemB: 'Elden Ring', winner: 'b' },
  ];
  const { contributions } = comparisonContributions(records);
  const narrative = contributions.find((item) => item.axis === 'style.narrative');
  assert.ok(narrative);
  assert.equal(narrative.value, 1);
  assert.equal(narrative.weight, 1.5);
  assert.equal(narrative.source.kind, 'comparison');
  // The consistently losing cards still appear, below the winner.
  const competitor = contributions.find((item) => item.axis === 'style.competitor');
  assert.ok(competitor.value < 1);
});
