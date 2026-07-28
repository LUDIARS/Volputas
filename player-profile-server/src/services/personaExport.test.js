const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPersonaExport,
  buildPersonaExports,
  toJsonLines,
} = require('./personaExport');

function analysis() {
  return {
    schemaVersion: 2,
    affect: {
      vector: Array(20).fill(0.25),
      vectorSpecVersion: 1,
    },
    preferenceAxes: {
      'style.explorer': { score: 0.72, confidence: 'high', contributions: [{ secret: true }] },
      'style.mastery': { score: 0.4, confidence: 'low' },
      'style.socializer': { score: null, confidence: 'insufficient' },
    },
    aversions: [{
      target: 'mechanic:gacha-pity',
      strength: 0.8,
      sources: ['voice:private-record'],
    }],
    mechanicReactions: [{
      mechanicId: 'action/dodge-roll',
      sentiment: 1.5,
      samples: 2,
      sources: ['voice:private-record'],
    }],
  };
}

test('consent defaults closed and excludes the entire persona', () => {
  assert.equal(buildPersonaExport({
    analysis: analysis(),
    consent: false,
    identity: 'private-user-id',
  }, 'test-secret'), null);
  assert.deepEqual(buildPersonaExports([{
    user_id: 'private-user-id',
    persona_analysis: analysis(),
    research_export_consent: false,
  }], 'test-secret'), []);
});

test('v2 export keeps derived values and strips identity and provenance', () => {
  const exported = buildPersonaExport({
    analysis: analysis(),
    attributes: { ageBand: '20s', spending: 'light', email: 'must-not-leak@example.com' },
    consent: true,
    identity: '6f1d0b9b-179a-4fc7-a643-d3228fe350b2',
    traits: ['探索型', '協力重視', '探索型'],
  }, 'test-secret');

  assert.match(exported.pseudoId, /^ext:voluptas:[0-9a-f]{16}$/);
  assert.deepEqual(exported.preferenceAxes, {
    'style.explorer': 0.72,
    'style.mastery': 0.4,
  });
  assert.deepEqual(exported.aversions, [{
    target: 'mechanic:gacha-pity',
    strength: 0.8,
  }]);
  assert.deepEqual(exported.mechanicReactions, [{
    mechanicId: 'action/dodge-roll',
    sentiment: 1.5,
  }]);
  assert.deepEqual(exported.attributes, { ageBand: '20s', spending: 'light' });
  assert.deepEqual(exported.traits, ['探索型', '協力重視']);
  assert.equal(exported.affectVector.length, 20);
  assert.equal(exported.vectorSpecVersion, 1);
  assert.equal(exported.exportSpecVersion, 2);

  const line = toJsonLines([exported]);
  assert.equal(line.trim().split('\n').length, 1);
  assert.doesNotMatch(line, /private-record|must-not-leak|display_name|email|sources/);
});

test('malformed optional derived compartments are omitted or empty', () => {
  const exported = buildPersonaExport({
    analysis: {
      ...analysis(),
      affect: { vector: [0], vectorSpecVersion: 1 },
      aversions: [{ target: '', strength: Number.NaN }],
      mechanicReactions: [{ mechanicId: 'x', sentiment: 'positive' }],
    },
    consent: true,
    identity: 'user',
  }, 'test-secret');
  assert.equal('affectVector' in exported, false);
  assert.equal('vectorSpecVersion' in exported, false);
  assert.deepEqual(exported.aversions, []);
  assert.deepEqual(exported.mechanicReactions, []);
});
