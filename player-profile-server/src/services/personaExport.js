const { pseudoId } = require('./pseudoId');

const AFFECT_DIMENSIONS = 20;
const VECTOR_SPEC_VERSION = 1;
const MAX_TRAITS = 32;
const MAX_TRAIT_LENGTH = 80;

function normalizeTraits(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    .slice(0, MAX_TRAITS)
    .map((item) => item.slice(0, MAX_TRAIT_LENGTH));
}

function normalizeVector(value) {
  if (!Array.isArray(value) || value.length !== AFFECT_DIMENSIONS) return null;
  if (value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return null;
  return value;
}

function buildPersonaExports(rows, secret) {
  const personas = [];
  for (const row of rows) {
    const vector = normalizeVector(row.affect_vector);
    if (!vector || row.vector_spec_version !== VECTOR_SPEC_VERSION) continue;
    personas.push({
      user_id: pseudoId(row.user_id, secret),
      affect_vector: vector,
      vector_spec_version: VECTOR_SPEC_VERSION,
      traits: normalizeTraits(row.playstyle_tags),
    });
  }
  return { personas };
}

module.exports = { buildPersonaExports };
