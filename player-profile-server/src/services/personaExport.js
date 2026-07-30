const { pseudoId } = require('./pseudoId');

const AFFECT_DIMENSIONS = 20;
const AFFECT_VECTOR_SPEC_VERSION = 1;
const EXPORT_SPEC_VERSION = 2;
const EXPORTABLE_CONFIDENCE = new Set(['low', 'medium', 'high']);
const MAX_TRAITS = 32;
const MAX_TRAIT_LENGTH = 80;
const ATTRIBUTE_KEYS = ['ageBand', 'spending'];

function normalizeTraits(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, MAX_TRAITS)
    .map((item) => item.slice(0, MAX_TRAIT_LENGTH));
}

function normalizeVector(value) {
  if (!Array.isArray(value) || value.length !== AFFECT_DIMENSIONS) return null;
  if (value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return null;
  return [...value];
}

function normalizePreferenceAxes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, axis]) =>
      EXPORTABLE_CONFIDENCE.has(axis?.confidence)
      && Number.isFinite(axis?.score))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([axisId, axis]) => [axisId, axis.score]));
}

function normalizeAversions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) =>
      typeof item?.target === 'string'
      && item.target.length > 0
      && Number.isFinite(item.strength))
    .map((item) => ({ target: item.target, strength: item.strength }));
}

function normalizeMechanicReactions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) =>
      typeof item?.mechanicId === 'string'
      && item.mechanicId.length > 0
      && Number.isFinite(item.sentiment))
    .map((item) => ({
      mechanicId: item.mechanicId,
      sentiment: item.sentiment,
    }));
}

function normalizeAttributes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(ATTRIBUTE_KEYS
    .filter((key) => typeof value[key] === 'string' && value[key].trim())
    .map((key) => [key, value[key].trim().slice(0, 80)]));
}

function buildPersonaExport({
  analysis,
  attributes,
  consent,
  identity,
  traits,
}, secret) {
  if (consent !== true || !analysis || analysis.schemaVersion !== 2) return null;
  const affectVector = normalizeVector(analysis.affect?.vector);
  const exported = {
    pseudoId: pseudoId(identity, secret),
    preferenceAxes: normalizePreferenceAxes(analysis.preferenceAxes),
    aversions: normalizeAversions(analysis.aversions),
    traits: normalizeTraits(traits),
    attributes: normalizeAttributes(attributes),
    mechanicReactions: normalizeMechanicReactions(analysis.mechanicReactions),
    exportSpecVersion: EXPORT_SPEC_VERSION,
  };
  if (affectVector && analysis.affect?.vectorSpecVersion === AFFECT_VECTOR_SPEC_VERSION) {
    exported.affectVector = affectVector;
    exported.vectorSpecVersion = AFFECT_VECTOR_SPEC_VERSION;
  }
  return exported;
}

function buildPersonaExports(rows, secret) {
  return (rows || [])
    .map((row) => buildPersonaExport({
      analysis: row.persona_analysis,
      attributes: row.attributes,
      consent: row.research_export_consent,
      identity: row.user_id,
      traits: row.playstyle_tags,
    }, secret))
    .filter(Boolean);
}

function toJsonLines(personas) {
  return personas.length === 0
    ? ''
    : `${personas.map((persona) => JSON.stringify(persona)).join('\n')}\n`;
}

module.exports = {
  AFFECT_VECTOR_SPEC_VERSION,
  EXPORT_SPEC_VERSION,
  buildPersonaExport,
  buildPersonaExports,
  normalizeAttributes,
  normalizeAversions,
  normalizeMechanicReactions,
  normalizePreferenceAxes,
  normalizeTraits,
  normalizeVector,
  toJsonLines,
};
