const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateContributions, confidenceFor } = require('./aggregateContributions');
const { mapV1Contribution } = require('./v1AxisMapping');
const { analyzePersonaV2 } = require('./analyzePersonaV2');
const { PREFERENCE_AXES } = require('../preferenceAxisDefinitions');

const SOURCES = {
  surveys: [],
  gameplay: [{
    id: 'gp-1',
    dedication: { score: 90 },
    selfRatedMastery: 5,
    completionPercent: 80,
    achievementsUnlocked: 8,
    achievementsTotal: 10,
    userInfo: 'x'.repeat(200),
    screenshotFileName: 'shot.png',
  }],
  voices: [{
    id: 'vc-1',
    sentiment: 2,
    comment: '物語の結末が最高だった',
    tags: ['story'],
    scopeType: 'content',
  }],
  emotionCurves: [{
    id: 'ec-1',
    narrativeArc: '転換点',
    journeyStage: '習熟',
    entries: [{ timeSeconds: 10, valence: 2, arousal: 5, comment: 'よい' }],
  }],
};

test('confidence separates missing data from weak and corroborated signals', () => {
  assert.equal(confidenceFor(0, 0), 'insufficient');
  assert.equal(confidenceFor(1.5, 1), 'low');
  assert.equal(confidenceFor(2.5, 1), 'medium');
  assert.equal(confidenceFor(4.5, 1), 'medium');
  assert.equal(confidenceFor(4.5, 2), 'high');
});

test('v1 axis mapping splits challenge and routes expression traits to engagement', () => {
  const split = mapV1Contribution({
    axis: 'challenge', value: 1, weight: 2, source: { kind: 'gameplay', id: 'a' },
  });
  assert.deepEqual(
    split.map((item) => [item.axis, item.weight]),
    [['style.competitor', 1], ['style.mastery', 1]]
  );
  const [reflection] = mapV1Contribution({
    axis: 'reflection', value: 0.5, weight: 1, source: { kind: 'voice', id: 'b' },
  });
  assert.equal(reflection.axis, 'engagement.reflection');
  assert.throws(() => mapV1Contribution({ axis: 'nope', value: 1, weight: 1, source: {} }));
});

test('aggregation keeps provenance and counts distinct source kinds', () => {
  const axes = aggregateContributions([
    { axis: 'style.narrative', value: 1, weight: 3, source: { kind: 'voice', id: 'v1' } },
    { axis: 'style.narrative', value: 0.5, weight: 1, source: { kind: 'emotionCurve', id: 'e1' } },
  ]);
  const narrative = axes['style.narrative'];
  assert.equal(narrative.evidenceWeight, 4);
  assert.equal(narrative.score, Number(((1 * 3 + 0.5 * 1) / 4).toFixed(4)));
  assert.equal(narrative.confidence, 'high');
  assert.deepEqual(narrative.sourceKinds, ['emotionCurve', 'voice']);
  assert.equal(narrative.contributions[0].source.id, 'v1');
});

test('analyzePersonaV2 emits all 15 axes, null-scores missing ones, and keeps the v1 view', () => {
  const analysis = analyzePersonaV2(SOURCES, '2026-07-28T12:00:00.000Z');

  assert.equal(analysis.schemaVersion, 2);
  assert.equal(analysis.modelVersion, 'evidence-persona-v2');
  assert.deepEqual(Object.keys(analysis.preferenceAxes).sort(), [...PREFERENCE_AXES].sort());

  // Evidence-backed axes score with provenance…
  const mastery = analysis.preferenceAxes['style.mastery'];
  assert.ok(mastery.score > 0);
  assert.ok(mastery.contributions.length > 0);
  // …axes nothing feeds yet stay null/insufficient instead of a false zero.
  assert.equal(analysis.preferenceAxes['mtg.timmy'].score, null);
  assert.equal(analysis.preferenceAxes['mtg.timmy'].confidence, 'insufficient');

  // Expression traits live outside the 15 preference axes.
  assert.ok(analysis.engagement.emotionalEngagement.score > 0);
  assert.ok(analysis.engagement.reflection.score > 0);
  // narrative: voice keyword (1.5) + narrativeArc (2) = weight 3.5 → medium.
  assert.equal(analysis.preferenceAxes['style.narrative'].confidence, 'medium');

  // v1-compatible view survives for the current UI (removed in T6).
  assert.equal(analysis.axes.mastery.score, 90);
  assert.ok(analysis.leadingAxes.length > 0);
  assert.deepEqual(analysis.aversions, []);
  assert.equal(analysis.population, null);
});
