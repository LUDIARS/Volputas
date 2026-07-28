// v1 (8 behavioural axes) → v2 axis vocabulary mapping (design §2).
// emotionalEngagement / reflection stay out of the 15 preference axes and land
// in the expression-trait (engagement) compartment instead.
const V1_TO_V2 = Object.freeze({
  exploration: [['style.explorer', 1]],
  mastery: [['style.mastery', 1]],
  completion: [['style.achiever', 1]],
  challenge: [['style.competitor', 0.5], ['style.mastery', 0.5]],
  narrative: [['style.narrative', 1]],
  social: [['style.socializer', 1]],
  emotionalEngagement: [['engagement.emotionalEngagement', 1]],
  reflection: [['engagement.reflection', 1]],
});

function mapV1Contribution(entry) {
  const targets = V1_TO_V2[entry.axis];
  if (!targets) {
    throw new Error(`Unknown v1 evidence axis: ${entry.axis}`);
  }
  return targets.map(([axis, share]) => ({
    ...entry,
    axis,
    weight: entry.weight * share,
  }));
}

module.exports = { V1_TO_V2, mapV1Contribution };
