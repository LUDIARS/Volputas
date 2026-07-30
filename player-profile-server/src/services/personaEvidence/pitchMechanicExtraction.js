// Deterministic pitch vocabulary matching against the bundled Ludus lexicon.
// The frontend artifact is generated from Ludus and is the shipped dictionary
// already used by voice and card-sort inputs.
const lexicon = require('../../../frontend/src/data/ludus-lexicon.json');

// The current 43-feature Ludus bundle has procedural generation but no
// dedicated roguelike feature. Keep this product term explicit until Ludus
// publishes a stable roguelike mechanic id.
const PITCH_TERM_ALIASES = Object.freeze({
  roguelike: 'runner/procedural-track',
  ローグライク: 'runner/procedural-track',
});

function includesTerm(normalizedText, term) {
  const normalizedTerm = String(term || '').trim().toLocaleLowerCase('en');
  return normalizedTerm && normalizedText.includes(normalizedTerm);
}

function extractPitchMechanicIds(text) {
  const normalizedText = String(text || '').toLocaleLowerCase('en');
  const mechanicIds = new Set();

  for (const mechanic of lexicon.mechanics) {
    if ([mechanic.id, mechanic.nameJa, mechanic.nameEn]
      .some((term) => includesTerm(normalizedText, term))) {
      mechanicIds.add(mechanic.id);
    }
  }
  for (const [term, mechanicId] of Object.entries(PITCH_TERM_ALIASES)) {
    if (includesTerm(normalizedText, term)) mechanicIds.add(mechanicId);
  }

  return [...mechanicIds].sort();
}

module.exports = {
  PITCH_TERM_ALIASES,
  extractPitchMechanicIds,
};
