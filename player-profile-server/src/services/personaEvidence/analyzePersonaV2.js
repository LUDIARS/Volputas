// persona.json schemaVersion 2 (design §2): 15 canonical preference axes with
// confidence + provenance, engagement (expression traits) kept separate, and a
// v1-compatible view (axes/leadingAxes) retained until the 15-axis UI (T6).
const { PREFERENCE_AXES } = require('../preferenceAxisDefinitions');
const { analyzePersona } = require('../personaEvidenceAnalysis');
const { aggregateContributions } = require('./aggregateContributions');
const { collectSourceContributions } = require('./sourceContributions');
const { mapV1Contribution } = require('./v1AxisMapping');

const ENGAGEMENT_AXES = ['emotionalEngagement', 'reflection'];

function emptyAxis() {
  return {
    // null (not 0) marks "no data": design principle 4 separates absence from
    // a measured zero.
    score: null,
    evidenceWeight: 0,
    confidence: 'insufficient',
    sourceKinds: [],
    contributions: [],
  };
}

function analyzePersonaV2(sources, analyzedAt) {
  const contributions = collectSourceContributions(sources).flatMap(mapV1Contribution);
  const aggregated = aggregateContributions(contributions);

  const preferenceAxes = Object.fromEntries(PREFERENCE_AXES.map((axis) => [
    axis,
    aggregated[axis] || emptyAxis(),
  ]));
  const engagement = Object.fromEntries(ENGAGEMENT_AXES.map((axis) => [
    axis,
    aggregated[`engagement.${axis}`] || emptyAxis(),
  ]));

  // v1-compatible compartment: the current UI and exports still read the
  // 8-axis shape. T6 removes it together with the old radar.
  const legacy = analyzePersona(sources, analyzedAt);

  return {
    schemaVersion: 2,
    modelVersion: 'evidence-persona-v2',
    analyzedAt,
    preferenceAxes,
    engagement,
    aversions: [],
    mechanicReactions: [],
    population: null,
    evidence: legacy.evidence,
    axes: legacy.axes,
    leadingAxes: legacy.leadingAxes,
    note: legacy.note,
  };
}

module.exports = { ENGAGEMENT_AXES, analyzePersonaV2 };
