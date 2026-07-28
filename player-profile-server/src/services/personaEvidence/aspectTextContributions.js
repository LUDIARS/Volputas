// Aspect-based text evidence (design §3.3): free text runs through
// sentiment-core once; positively mentioned aspects contribute to their mapped
// axes, negatively mentioned aspects become aversion evidence instead
// (「ストーリーが薄い」は narrative 志向ではない). Aspect values sit on a
// 0..1 scale where 0.5 means "not mentioned / neutral".
const { VECTOR_DIMS, textToVector } = require('@ludiars/sentiment-core');
const { ASPECT_AXIS_MAP } = require('./axisMappings');

const ASPECT_INDEX = new Map(Object.keys(ASPECT_AXIS_MAP)
  .map((aspect) => [aspect, VECTOR_DIMS.indexOf(`asp.${aspect}`)])
  .filter(([, index]) => index >= 0));
const VALENCE_INDEX = VECTOR_DIMS.indexOf('emo.valence');
const NEUTRAL = 0.5;
// Mention detection tolerance: unmentioned aspects sit exactly at 0.5.
const EPSILON = 1e-6;

function aspectTextContributions(text, { weight, source }) {
  const contributions = [];
  const aversionEvidence = [];
  const trimmed = String(text || '').trim();
  if (!trimmed) return { contributions, aversionEvidence, valence: null };

  const vector = textToVector(trimmed);
  for (const [aspect, index] of ASPECT_INDEX) {
    const activation = vector[index];
    if (Math.abs(activation - NEUTRAL) <= EPSILON) continue;
    if (activation > NEUTRAL) {
      const value = (activation - NEUTRAL) * 2;
      for (const [axis, share] of ASPECT_AXIS_MAP[aspect]) {
        contributions.push({
          axis,
          value,
          weight: weight * share,
          source,
          note: `aspect:${aspect}`,
        });
      }
    } else {
      aversionEvidence.push({
        target: `aspect:${aspect}`,
        strength: Number(((NEUTRAL - activation) * 2).toFixed(4)),
        source,
      });
    }
  }
  return {
    contributions,
    aversionEvidence,
    valence: VALENCE_INDEX >= 0 ? vector[VALENCE_INDEX] : null,
  };
}

module.exports = { aspectTextContributions };
