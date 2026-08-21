// GEQ / PENS subscale → persona axis signals
// (spec/feature/game-experience-scales.md §ペルソナ寄与). One table feeds both
// the v1 evidence persona (personaEvidenceAnalysis.js axes) and the v2
// contribution model (personaEvidence/sourceContributions.js axes) so the two
// never drift. Values are the subscale's unit score (0..1 on its own range),
// optionally inverted where a high answer means the *absence* of the trait
// (intuitive controls → low onboarding need). Pure.
const { scoreScales, unitScore } = require('./scaleScores');

// [family, subscale] → { v1: [[axis, weight]], v2: [[axis, weight]], invert? }
const SCALE_AXIS_MAP = Object.freeze({
  'geq.competence': { v1: [['mastery', 1.5]], v2: [['style.mastery', 1.5]] },
  'geq.immersion': { v1: [['narrative', 1.25], ['emotionalEngagement', 1]], v2: [['style.narrative', 1.5]] },
  'geq.flow': { v1: [['emotionalEngagement', 1.5]], v2: [['mtg.timmy', 1]] },
  'geq.tension': { v1: [], v2: [['style.onboarding_need', 0.75]] },
  'geq.challenge': { v1: [['challenge', 1.5]], v2: [['style.competitor', 0.75], ['style.mastery', 0.75]] },
  'geq.negativeAffect': { v1: [], v2: [['style.routine_tolerance', 1]], invert: true },
  'geq.positiveAffect': { v1: [['emotionalEngagement', 1]], v2: [['mtg.timmy', 0.5], ['style.relaxation', 0.5]] },
  'pens.competence': { v1: [['mastery', 1.5]], v2: [['style.mastery', 1.5]] },
  'pens.autonomy': { v1: [['exploration', 1]], v2: [['style.autonomy', 1.5]] },
  'pens.relatedness': { v1: [['social', 1.5]], v2: [['style.socializer', 1.5]] },
  'pens.presence': { v1: [['narrative', 1], ['emotionalEngagement', 1]], v2: [['style.narrative', 1.25]] },
  'pens.intuitiveControls': { v1: [], v2: [['style.onboarding_need', 1]], invert: true },
});

// `[{ family, subscale, value, v1: [[axis, weight]], v2: [[axis, weight]] }]`
// for every scored subscale of the record's scales; empty when none.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function scaleAxisSignals(scales) {
  const scored = scoreScales(scales);
  if (!scored) return [];
  const signals = [];
  for (const [family, subscales] of Object.entries(scored)) {
    for (const [subscale, { score }] of Object.entries(subscales)) {
      const mapping = SCALE_AXIS_MAP[`${family}.${subscale}`];
      if (!mapping) continue;
      const unit = unitScore(family, score);
      // unitScore returns null for a non-finite score; inverting null would
      // yield 1 (a full-strength signal) out of a missing answer.
      if (unit === null) continue;
      const value = mapping.invert ? 1 - unit : unit;
      signals.push({ family, subscale, value, v1: mapping.v1, v2: mapping.v2 });
    }
  }
  return signals;
}

module.exports = { SCALE_AXIS_MAP, scaleAxisSignals };
