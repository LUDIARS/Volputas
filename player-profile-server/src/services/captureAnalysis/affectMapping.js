// Maps sentiment-core affect scores (valence ≈ -1..1, arousal 0..1) onto the
// emotion-curve entry scales (valence -2..2, arousal 1..5). Pure so the
// mapping — the analytical heart of the local pipeline — is unit-testable.
const { scoreText } = require('@ludiars/sentiment-core');

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function scoreUtterance(text) {
  const score = scoreText(text);
  return {
    valence: clamp(Math.round(score.valence * 2), -2, 2),
    arousal: clamp(1 + Math.round(score.arousal * 4), 1, 5),
    valenceRaw: score.valence,
    arousalRaw: score.arousal,
    emotions: score.emotions,
    hasSignal: score.valenceLabel !== 'neutral'
      || score.arousal > 0
      || score.emotions.length > 0,
  };
}

module.exports = { scoreUtterance };
