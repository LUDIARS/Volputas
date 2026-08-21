// Validation and scoring of the GEQ / PENS answers attached to a game
// impression (spec/feature/game-experience-scales.md §入力 / §採点). Answers
// are optional per family and per item; a subscale scores only when at least
// one of its items was answered, and a family with no answers is dropped so
// records without scales stay exactly as before. Pure and deterministic.
const { SCALE_FAMILIES, SCALE_FAMILY_IDS } = require('./scaleDefinitions');

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_PROFILE_INPUT' });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function itemValue(raw, range, itemId, familyId) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw invalid(`${familyId}.${itemId} must be an integer between ${range.min} and ${range.max}`);
  }
  return value;
}

// `{ geq: { competence_1: 3, ... }, pens: { autonomy: 5, ... } }` →
// the same shape with only known items, integers in range, families with no
// answers removed. Returns null when nothing was answered. Unknown item or
// family keys are rejected (input boundary), not silently dropped.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function validateScales(body) {
  if (body === undefined || body === null) return null;
  if (!isPlainObject(body)) throw invalid('scales must be an object');
  const result = {};
  for (const familyId of Object.keys(body)) {
    if (!SCALE_FAMILY_IDS.includes(familyId)) throw invalid(`Unknown scale family: ${familyId}`);
    const family = SCALE_FAMILIES[familyId];
    const answers = body[familyId];
    if (answers === undefined || answers === null) continue;
    if (!isPlainObject(answers)) throw invalid(`scales.${familyId} must be an object`);
    const known = new Map(family.subscales.flatMap((subscale) => subscale.items.map((item) => [item.id, item])));
    const normalized = {};
    for (const itemId of Object.keys(answers)) {
      if (!known.has(itemId)) throw invalid(`Unknown ${familyId} item: ${itemId}`);
      const value = itemValue(answers[itemId], family.range, itemId, familyId);
      if (value !== null) normalized[itemId] = value;
    }
    if (Object.keys(normalized).length > 0) result[familyId] = normalized;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Subscale scores per family: `{ geq: { competence: { score, answered, of }, ... }, ... }`.
// `score` is the item mean on the family's own range (GEQ 0..4, PENS 1..7);
// subscales with no answered item are omitted.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function scoreScales(scales) {
  if (!scales) return null;
  const result = {};
  for (const familyId of SCALE_FAMILY_IDS) {
    const answers = scales[familyId];
    if (!answers) continue;
    const family = SCALE_FAMILIES[familyId];
    const subscales = {};
    for (const subscale of family.subscales) {
      const values = subscale.items.map((item) => answers[item.id]).filter(Number.isFinite);
      if (values.length === 0) continue;
      subscales[subscale.id] = {
        score: Number(mean(values).toFixed(4)),
        answered: values.length,
        of: subscale.items.length,
      };
    }
    if (Object.keys(subscales).length > 0) result[familyId] = subscales;
  }
  return Object.keys(result).length > 0 ? result : null;
}

// Score rescaled to 0..1 on the family's range, for callers (persona axes)
// that want a unit-less strength.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function unitScore(familyId, score) {
  const { min, max } = SCALE_FAMILIES[familyId].range;
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(1, (score - min) / (max - min)));
}

module.exports = { scoreScales, unitScore, validateScales };
