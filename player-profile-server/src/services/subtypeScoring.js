const { GAMER_SUBTYPE_KEYS, GAMER_TYPES } = require('./hobbyPatternDefinitions');

const SUBTYPE_KEY_SET = new Set(GAMER_SUBTYPE_KEYS);

// Subtype scores are reported on 0..1 because they are stored as-is in
// player_profiles.subtype_data and shown to the respondent. That is deliberately *not* the
// 0..10 domain analysisEngine uses for its preference vector, nor the -1..1 domain
// preferenceAxes uses; each of the three has its own consumer and mixing them would silently
// skew averages. The conversion happens here, once.
function normalizeAgreementScore(score) {
  const clamped = Math.max(-1, Math.min(1, score));
  return (clamped + 1) / 2;
}

// Only the shared `scoring` map ({ answerValue: -1..1 }, see src/surveys/agreementScale.js) is
// honoured. An unscored or unrecognised answer contributes nothing rather than a neutral
// midpoint: a fabricated 0.5 would look identical to a genuine "neither agree nor disagree"
// and is exactly how the previous positional heuristic produced confident nonsense.
function readSubtypeScore(question, answer) {
  const configured = Number(question.scoring?.[String(answer)]);
  if (!Number.isFinite(configured)) return null;
  return normalizeAgreementScore(configured);
}

/**
 * Aggregate `subtype`-tagged survey answers into per-subtype averages.
 *
 * @param {Array<{questions: unknown, answers: unknown}>} records survey_responses joined to surveys
 * @returns {Record<string, {score: number, samples: number}>} keyed by `<mainType>.<subtype>`
 */
function scoreGamerSubtypes(records) {
  const totals = new Map();

  for (const record of records) {
    if (!Array.isArray(record?.questions)) continue;
    if (!record.answers || typeof record.answers !== 'object') continue;

    for (const question of record.questions) {
      if (!question || !SUBTYPE_KEY_SET.has(question.subtype)) continue;

      const answer = record.answers[question.id];
      if (answer === undefined || answer === null) continue;

      const score = readSubtypeScore(question, answer);
      if (score === null) continue;

      const current = totals.get(question.subtype) || { total: 0, samples: 0 };
      current.total += score;
      current.samples += 1;
      totals.set(question.subtype, current);
    }
  }

  return Object.fromEntries(
    [...totals.entries()].map(([subtype, value]) => [subtype, {
      score: Number((value.total / value.samples).toFixed(4)),
      samples: value.samples,
    }])
  );
}

/**
 * Narrow an already-determined primary gamer type to one of its four subtypes using measured
 * scores. Returns null when the respondent answered no subtype question for that type, which
 * is the caller's signal to fall back instead of reporting an unmeasured subtype as fact.
 *
 * @param {string} gamerPrimary primary gamer type key (e.g. 'timmy')
 * @param {Record<string, {score: number, samples: number}>} measured from scoreGamerSubtypes
 */
function selectPrimarySubtype(gamerPrimary, measured) {
  const gamerType = GAMER_TYPES[gamerPrimary];
  if (!gamerType) return null;

  const scored = gamerType.subtypes
    .map((subtype) => ({ subtype, measured: measured[`${gamerPrimary}.${subtype}`] }))
    .filter((entry) => entry.measured !== undefined);
  if (scored.length === 0) return null;

  // Stable ordering: highest score first, then the declaration order in GAMER_TYPES so equal
  // scores do not shuffle between recomputations of the same answers.
  const ranked = [...scored].sort((a, b) => (
    b.measured.score - a.measured.score
    || gamerType.subtypes.indexOf(a.subtype) - gamerType.subtypes.indexOf(b.subtype)
  ));

  return {
    primarySubtype: ranked[0].subtype,
    subtypeScores: Object.fromEntries(ranked.map((entry) => [entry.subtype, entry.measured.score])),
    subtypeSamples: Object.fromEntries(ranked.map((entry) => [entry.subtype, entry.measured.samples])),
  };
}

module.exports = {
  scoreGamerSubtypes,
  selectPrimarySubtype,
};
