const { VECTOR_SPEC, computeDesignGap, cosine, weightedMean } = require('@ludiars/sentiment-core');
const { beatTargetVector, validateBeatScript } = require('./beatScript');

function computeTimelineGap(series, beats) {
  const validated = validateBeatScript(beats);
  const results = [];
  const unaligned = [];
  for (const beat of validated) {
    const hint = beat.markers.t_hint_ms;
    if (!hint) {
      unaligned.push(beat.beat);
      continue;
    }
    const bins = series.filter((bin) => (
      Number.isFinite(bin.t)
      && Array.isArray(bin.vector)
      && bin.t >= hint[0]
      && bin.t < hint[1]
    ));
    if (bins.length === 0) {
      results.push({ beat: beat.beat, matchScore: null, gapTop: [], bins: 0 });
      continue;
    }
    const observed = weightedMean(bins.map((bin) => bin.vector), bins.map((bin) => bin.n || 1));
    const target = beatTargetVector(beat);
    const gap = computeDesignGap(observed, target);
    const gapTop = gap
      .map((value, index) => ({ dim: VECTOR_SPEC[index], value: Number(value.toFixed(4)) }))
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
      .slice(0, 3);
    results.push({
      beat: beat.beat,
      matchScore: Number(cosine(observed, target).toFixed(4)),
      gapTop,
      bins: bins.length,
    });
  }
  return { beats: results, unaligned };
}

module.exports = { computeTimelineGap };
