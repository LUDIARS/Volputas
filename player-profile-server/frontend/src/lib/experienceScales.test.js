import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { SCALE_FAMILIES, scoreScales } from './experienceScales.js';

// `src/services/gameExperienceScales/scaleDefinitions.js` is the正本 and this
// module is its UI copy (spec/feature/game-experience-scales.md §尺度). Drift in
// ids, ranges or item order silently produces answers the server rejects with
// INVALID_PROFILE_INPUT, so compare the two shapes instead of trusting the
// 「同期必須」 comment.
const require = createRequire(import.meta.url);
const {
  SCALE_FAMILIES: SERVER_FAMILIES,
} = require('../../../src/services/gameExperienceScales/scaleDefinitions.js');

function shape(families) {
  return families.map((family) => ({
    id: family.id,
    label: family.label,
    range: { min: family.range.min, max: family.range.max },
    subscales: family.subscales.map((subscale) => ({
      id: subscale.id,
      label: subscale.label,
      items: subscale.items.map((item) => ({ id: item.id, text: item.text })),
    })),
  }));
}

describe('experience scales catalog', () => {
  it('mirrors the server definitions (ids, labels, ranges, item order)', () => {
    assert.deepEqual(shape(SCALE_FAMILIES), shape(Object.values(SERVER_FAMILIES)));
  });

  it('carries one anchor per step of every family range', () => {
    for (const family of SCALE_FAMILIES) {
      assert.equal(family.anchors.length, family.range.max - family.range.min + 1, family.id);
    }
  });

  it('averages the answered items of a subscale and drops empty families', () => {
    assert.deepEqual(
      scoreScales({ geq: { competence_1: 3, competence_2: 4, tension_1: 1 }, pens: {} }),
      { geq: { competence: 3.5, tension: 1 } }
    );
    assert.equal(scoreScales(null), null);
    assert.equal(scoreScales({ geq: {} }), null);
  });
});
