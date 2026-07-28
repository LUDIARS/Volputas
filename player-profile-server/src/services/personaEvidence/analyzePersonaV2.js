// persona.json schemaVersion 2 (design §2): 15 canonical preference axes with
// confidence + provenance, engagement (expression traits) kept separate, and a
// v1-compatible view (axes/leadingAxes) retained until the 15-axis UI (T6).
const { PREFERENCE_AXES } = require('../preferenceAxisDefinitions');
const { analyzePersona } = require('../personaEvidenceAnalysis');
const { classifyFromSurveyRecords } = require('../classificationEngine');
const { collectFreeTextSamples, computeAffectProfile } = require('../affectProfile');
const { aggregateContributions } = require('./aggregateContributions');
const { collectSourceContributions } = require('./sourceContributions');
const { surveyAxisContributions } = require('./surveyAxisContributions');
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

// Pairs each survey response with its question definition so metadata-aware
// consumers (axis scoring, freetext affect) see {questions, answers} records.
function joinResponsesWithDefinitions(responses, definitions) {
  const byId = new Map((definitions || [])
    .filter((definition) => definition && definition.id)
    .map((definition) => [definition.id, definition]));
  return (responses || []).flatMap((response) => {
    const surveyId = response.survey?.id || response.surveyId || null;
    const definition = surveyId ? byId.get(surveyId) : null;
    if (!definition) return [];
    return [{ questions: definition.questions, answers: response.answers }];
  });
}

function collectAversions(aversionEvidence) {
  const byTarget = new Map();
  for (const item of aversionEvidence) {
    if (!byTarget.has(item.target)) {
      byTarget.set(item.target, { target: item.target, strength: 0, sources: [] });
    }
    const bucket = byTarget.get(item.target);
    bucket.strength = Math.max(bucket.strength, item.strength);
    const label = `${item.source.kind}:${item.source.id}#${item.source.field}`;
    if (!bucket.sources.includes(label)) bucket.sources.push(label);
  }
  return [...byTarget.values()].sort((left, right) => right.strength - left.strength);
}

function analyzePersonaV2(sources, analyzedAt) {
  const definitions = sources.surveyDefinitions || [];
  const survey = surveyAxisContributions(sources.surveys, definitions);
  const contributions = [
    ...collectSourceContributions(sources).flatMap(mapV1Contribution),
    ...survey.contributions,
  ];
  const aggregated = aggregateContributions(contributions);

  const preferenceAxes = Object.fromEntries(PREFERENCE_AXES.map((axis) => [
    axis,
    aggregated[axis] || emptyAxis(),
  ]));
  const engagement = Object.fromEntries(ENGAGEMENT_AXES.map((axis) => [
    axis,
    aggregated[`engagement.${axis}`] || emptyAxis(),
  ]));

  const joinedRecords = joinResponsesWithDefinitions(sources.surveys, definitions);

  // Freetext answers feed the shared 20D affect vector (design §3.1 merges the
  // former standalone affect recompute into this pipeline).
  const affect = computeAffectProfile(collectFreeTextSamples(joinedRecords));

  // 12-classification (MTG psychographics + Caillois + story dynamics) via the
  // shared pure engine (design §3.6). Null when no dimension-tagged question
  // was answered — distinct from an all-zero profile.
  const surveyClassification = classifyFromSurveyRecords(joinedRecords);
  const classification = surveyClassification && {
    ...surveyClassification.classification,
    tags: surveyClassification.tags,
    subtypes: surveyClassification.subtypes,
    dimensionVector: surveyClassification.vector,
  };

  // v1-compatible compartment: the current UI and exports still read the
  // 8-axis shape. T6 removes it together with the old radar.
  const legacy = analyzePersona(sources, analyzedAt);

  return {
    schemaVersion: 2,
    modelVersion: 'evidence-persona-v2',
    analyzedAt,
    preferenceAxes,
    engagement,
    aversions: collectAversions(survey.aversionEvidence),
    affect,
    classification,
    mechanicReactions: [],
    population: null,
    evidence: { ...legacy.evidence, surveyDefinitions: definitions.length },
    axes: legacy.axes,
    leadingAxes: legacy.leadingAxes,
    note: legacy.note,
  };
}

module.exports = { ENGAGEMENT_AXES, analyzePersonaV2 };
