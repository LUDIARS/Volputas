const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CARD_SORT_AVERSION_STRENGTH,
  cardSortContributions,
  latestCardSortRecords,
} = require('./cardSortContributions');
const { combineMechanicReactions } = require('./combineMechanicReactions');
const { MECHANIC_CATEGORY_AXIS_MAP } = require('./axisMappings');
const { PREFERENCE_AXES } = require('../preferenceAxisDefinitions');
const { validateCardSortInput } = require('../profileEvidenceSchemas');
const lexicon = require('../../../frontend/src/data/ludus-lexicon.json');

test('mechanic category mappings use canonical axes and normalized shares', () => {
  const canonicalAxes = new Set(PREFERENCE_AXES);
  for (const [category, targets] of Object.entries(MECHANIC_CATEGORY_AXIS_MAP)) {
    assert.ok(targets.length > 0, `${category} has no targets`);
    assert.equal(
      Number(targets.reduce((sum, [, share]) => sum + share, 0).toFixed(4)),
      1
    );
    for (const [axis, share] of targets) {
      assert.ok(canonicalAxes.has(axis), `${category} references unknown axis ${axis}`);
      assert.ok(share > 0 && share <= 1);
    }
  }
  assert.equal(lexicon.mechanics.length, 43);
  for (const mechanic of lexicon.mechanics) {
    const category = mechanic.id.split('/')[0];
    assert.ok(
      MECHANIC_CATEGORY_AXIS_MAP[category],
      `${mechanic.id} has no category mapping`
    );
  }
});

test('card-sort validation accepts only a mechanic id and known bucket', () => {
  assert.deepEqual(
    validateCardSortInput({ mechanicId: 'Open-World/Fast-Travel', bucket: 'love' }),
    { mechanicId: 'open-world/fast-travel', bucket: 'love' }
  );
  assert.throws(() => validateCardSortInput({ mechanicId: '../escape', bucket: 'love' }));
  assert.throws(() => validateCardSortInput({ mechanicId: 'action/dodge-roll', bucket: 'later' }));
});

test('newest card-sort judgment is effective independent of input order', () => {
  const records = [
    {
      id: 'old',
      mechanicId: 'action/dodge-roll',
      bucket: 'love',
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
    {
      id: 'new',
      mechanicId: 'action/dodge-roll',
      bucket: 'avoid',
      updatedAt: '2026-07-28T01:00:00.000Z',
    },
  ];
  assert.deepEqual(latestCardSortRecords(records), [records[1]]);
  assert.deepEqual(latestCardSortRecords([...records].reverse()), [records[1]]);
});

test('card-sort love and avoid produce measured persona evidence', () => {
  const result = cardSortContributions([
    {
      id: 'liked',
      mechanicId: 'open-world/fast-travel',
      bucket: 'love',
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
    {
      id: 'avoided',
      mechanicId: 'action/dodge-roll',
      bucket: 'avoid',
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
    {
      id: 'neutral',
      mechanicId: 'rhythm/note-chart',
      bucket: 'neutral',
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
  ]);

  const explorer = result.contributions.find((item) => item.axis === 'style.explorer');
  assert.deepEqual(explorer, {
    axis: 'style.explorer',
    value: 1,
    weight: 0.6,
    source: { kind: 'cardsort', id: 'liked', field: 'bucket' },
  });
  assert.deepEqual(result.aversionEvidence, [{
    target: 'mechanic:action/dodge-roll',
    strength: CARD_SORT_AVERSION_STRENGTH,
    source: { kind: 'cardsort', id: 'avoided', field: 'bucket' },
  }]);
  assert.deepEqual(result.mechanicReactions.map((item) => [
    item.mechanicId,
    item.sentiment,
  ]), [
    ['action/dodge-roll', -1],
    ['open-world/fast-travel', 1],
  ]);
});

test('voice and card-sort reactions combine by sample count', () => {
  const combined = combineMechanicReactions(
    [{
      mechanicId: 'action/dodge-roll',
      sentiment: 2,
      samples: 2,
      sources: ['voice:a', 'voice:b'],
    }],
    [{
      mechanicId: 'action/dodge-roll',
      sentiment: -1,
      samples: 1,
      sources: ['cardsort:c'],
    }]
  );
  assert.deepEqual(combined, [{
    mechanicId: 'action/dodge-roll',
    sentiment: 1,
    samples: 3,
    sources: ['cardsort:c', 'voice:a', 'voice:b'],
  }]);
});
