// Per-source EvidenceContribution extraction (design §3.0). Pure functions:
// record in → v1-axis contributions with provenance out. The scoring rules are
// a faithful port of the v1 analyzer; quality upgrades land in T2–T5.
const {
  NARRATIVE_TERMS,
  SOCIAL_TERMS,
  SURVEY_NARRATIVE_TERMS,
  SURVEY_SOCIAL_TERMS,
  clamp,
  containsAny,
  textStrength,
} = require('./textSignals');

function entry(axis, value, weight, source, note) {
  return { axis, value: clamp(value), weight, source, ...(note ? { note } : {}) };
}

function gameplayContributions(record) {
  const source = (field) => ({ kind: 'gameplay', id: record.id || null, field });
  const contributions = [];
  const dedication = record.dedication?.score;
  if (Number.isFinite(dedication)) {
    contributions.push(entry('mastery', dedication / 100, 2, source('dedication')));
    contributions.push(entry('challenge', (record.selfRatedMastery || 1) / 5, 1.25, source('selfRatedMastery')));
  }
  if (Number.isFinite(record.completionPercent)) {
    contributions.push(entry('completion', record.completionPercent / 100, 2, source('completionPercent')));
  }
  if (Number.isFinite(record.achievementsTotal) && record.achievementsTotal > 0) {
    contributions.push(entry(
      'completion',
      (record.achievementsUnlocked || 0) / record.achievementsTotal,
      1.5,
      source('achievements')
    ));
  }
  contributions.push(entry('reflection', textStrength(record.userInfo), 0.75, source('userInfo')));
  if (record.screenshotFileName) {
    contributions.push(entry('exploration', 0.55, 0.5, source('screenshotFileName')));
  }
  return contributions;
}

function voiceContributions(record) {
  const source = (field) => ({ kind: 'voice', id: record.id || null, field });
  const contributions = [
    entry('emotionalEngagement', Math.abs(Number(record.sentiment) || 0) / 2, 1.5, source('sentiment')),
    entry('reflection', textStrength(record.comment), 1.5, source('comment')),
  ];
  if (record.scopeType === 'content') {
    contributions.push(entry('exploration', 0.6, 0.75, source('scopeType')));
  }
  const terms = [record.comment, ...(record.tags || [])];
  if (containsAny(terms, NARRATIVE_TERMS)) {
    contributions.push(entry('narrative', 0.85, 1.5, source('comment'), 'keyword match'));
  }
  if (containsAny(terms, SOCIAL_TERMS)) {
    contributions.push(entry('social', 0.8, 1.5, source('comment'), 'keyword match'));
  }
  return contributions;
}

function emotionCurveContributions(record) {
  const source = (field) => ({ kind: 'emotionCurve', id: record.id || null, field });
  const contributions = [];
  const entries = record.entries || [];
  if (entries.length > 0) {
    const averageEmotion = entries.reduce(
      (sum, item) => sum + Math.abs(Number(item.valence) || 0) / 2,
      0
    ) / entries.length;
    const averageArousal = entries.reduce(
      (sum, item) => sum + ((Number(item.arousal) || 1) - 1) / 4,
      0
    ) / entries.length;
    contributions.push(entry('emotionalEngagement', (averageEmotion + averageArousal) / 2, 2, source('entries')));
    contributions.push(entry(
      'reflection',
      entries.reduce((sum, item) => sum + textStrength(item.comment, 240), 0) / entries.length,
      1.5,
      source('entries')
    ));
  }
  if (record.narrativeArc) contributions.push(entry('narrative', 0.9, 2, source('narrativeArc')));
  if (record.journeyStage) contributions.push(entry('exploration', 0.6, 0.75, source('journeyStage')));
  return contributions;
}

function surveyContributions(response) {
  const id = response.id || response.survey?.id || null;
  const source = (field) => ({ kind: 'survey', id, field });
  const values = Object.values(response.answers || {});
  if (values.length === 0) return [];
  const contributions = [];
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length > 0) {
    const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    contributions.push(entry('mastery', clamp((average - 1) / 4), 0.5, source('answers')));
  }
  contributions.push(entry('reflection', clamp(values.length / 12), 0.75, source('answers')));
  const text = values.map(String);
  if (containsAny(text, SURVEY_NARRATIVE_TERMS)) {
    contributions.push(entry('narrative', 0.75, 0.75, source('answers'), 'keyword match'));
  }
  if (containsAny(text, SURVEY_SOCIAL_TERMS)) {
    contributions.push(entry('social', 0.75, 0.75, source('answers'), 'keyword match'));
  }
  return contributions;
}

function collectSourceContributions(sources) {
  return [
    ...sources.gameplay.flatMap(gameplayContributions),
    ...sources.voices.flatMap(voiceContributions),
    ...sources.emotionCurves.flatMap(emotionCurveContributions),
    ...sources.surveys.flatMap(surveyContributions),
  ];
}

module.exports = {
  collectSourceContributions,
  emotionCurveContributions,
  gameplayContributions,
  surveyContributions,
  voiceContributions,
};
