'use strict';

// Shared 4-point agreement scale for every scored survey question in src/surveys/.
// Lives on its own so the individual survey definitions only describe *what* they measure
// and never restate the response scale — a scale change has to happen in exactly one place
// or previously collected answers stop being comparable across surveys.
const AGREE_OPTIONS = [
  { value: 'strongly_agree', label: 'とてもそう思う' },
  { value: 'agree', label: 'ややそう思う' },
  { value: 'disagree', label: 'あまりそう思わない' },
  { value: 'strongly_disagree', label: '全くそう思わない' },
];

const AGREE_SCORING = {
  strongly_agree: 0.9,
  agree: 0.3,
  disagree: -0.3,
  strongly_disagree: -0.9,
};

// `dimension` targets the 12-dimension Gamer/Mechanics/Story engine (services/analysisEngine.js),
// `axis` targets the 15-axis style engine shared with Discutere (services/preferenceAxes.js),
// `subtype` targets the 20 gamer subtypes (services/subtypeScoring.js). A question may carry
// any combination; omitted keys are simply not scored by that engine.
function agreeQuestion({ id, text, dimension, axis, subtype }) {
  return {
    id,
    type: 'choice',
    text,
    ...(dimension ? { dimension } : {}),
    ...(axis ? { axis } : {}),
    ...(subtype ? { subtype } : {}),
    options: AGREE_OPTIONS,
    scoring: AGREE_SCORING,
  };
}

module.exports = {
  AGREE_OPTIONS,
  AGREE_SCORING,
  agreeQuestion,
};
