// Per-source EvidenceContribution extraction (design §3.0/§3.3). Pure
// functions: record in → v2-axis contributions + aversion evidence out.
// Text is interpreted through sentiment-core aspects (negative mentions turn
// into aversions instead of positive axis signal); the only remaining keyword
// heuristic is the social one, polarity-gated, until sentiment-core grows a
// social aspect (Lapilli #14).
const {
  SOCIAL_TERMS,
  clamp,
  containsAny,
  textStrength,
} = require('./textSignals');
const { aspectTextContributions } = require('./aspectTextContributions');
const { mapV1Contribution } = require('./v1AxisMapping');

// 「文字数=内省」 heuristic: compressed per design §3.3 (fullAt 600) and kept
// inside the engagement compartment only (the v1→v2 mapping already routes
// reflection there).
const REFLECTION_FULL_AT = 600;

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
  contributions.push(entry(
    'reflection',
    textStrength(record.userInfo, REFLECTION_FULL_AT),
    0.5,
    source('userInfo')
  ));
  // v1's screenshot-presence→exploration signal is retired (§3.3); the
  // annotated gallery (T11) becomes the deliberate replacement.
  return { contributions: contributions.flatMap(mapV1Contribution), aversionEvidence: [] };
}

// Social keyword matching survives with a polarity gate: the respondent's own
// sentiment (slider, or analyzed valence for free text) decides whether a
// social mention is a preference or an aversion.
function socialSignal(text, sentiment, source) {
  if (!containsAny([text], SOCIAL_TERMS)) return { contributions: [], aversionEvidence: [] };
  if (sentiment >= 0) {
    return {
      contributions: [{
        axis: 'style.socializer', value: 0.8, weight: 1.5, source, note: 'keyword match',
      }],
      aversionEvidence: [],
    };
  }
  return {
    contributions: [],
    aversionEvidence: [{
      target: 'style.socializer',
      strength: Number(Math.min(1, Math.abs(sentiment) / 2).toFixed(4)),
      source,
    }],
  };
}

function voiceContributions(record, sourceKind = 'voice', commentField = 'comment') {
  const resolvedSourceKind = record.sourceKind === 'discussion' ? 'discussion' : sourceKind;
  const sourceId = resolvedSourceKind === 'discussion'
    ? record.sourceRef || record.id || null
    : record.id || null;
  const source = (field) => ({ kind: resolvedSourceKind, id: sourceId, field });
  const sentiment = Number(record.sentiment) || 0;
  const v1 = [
    entry('emotionalEngagement', Math.abs(sentiment) / 2, 1.5, source('sentiment')),
    entry('reflection', textStrength(record.comment, REFLECTION_FULL_AT), 1.5, source(commentField)),
  ];
  if (record.scopeType === 'content') {
    v1.push(entry('exploration', 0.6, 0.75, source('scopeType')));
  }

  const text = [record.comment, ...(record.tags || [])].filter(Boolean).join(' ');
  const aspects = aspectTextContributions(text, { weight: 1.5, source: source(commentField) });
  const social = socialSignal(text, sentiment, source(commentField));

  return {
    contributions: [
      ...v1.flatMap(mapV1Contribution),
      ...aspects.contributions,
      ...social.contributions,
    ],
    aversionEvidence: [...aspects.aversionEvidence, ...social.aversionEvidence],
  };
}

function voiceMemoContributions(record) {
  if (typeof record?.transcript !== 'string' || !record.transcript.trim()) {
    return { contributions: [], aversionEvidence: [] };
  }
  return voiceContributions({
    ...record,
    comment: record.transcript,
    scopeType: 'game',
  }, 'voicememo', 'transcript');
}

function emotionCurveContributions(record) {
  const source = (field) => ({ kind: 'emotionCurve', id: record.id || null, field });
  // Memory sketches (video-less recollection, design §3.4) are discounted for
  // recall bias; the scoring itself is mode-agnostic.
  const modeWeight = record.mode === 'memory' ? 0.75 : 1;
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
    contributions.push(entry(
      'emotionalEngagement',
      (averageEmotion + averageArousal) / 2,
      2 * modeWeight,
      source('entries')
    ));
    // Timed comments stay on the shorter 240 scale — they are per-moment notes,
    // not long-form reflection.
    contributions.push(entry(
      'reflection',
      entries.reduce((sum, item) => sum + textStrength(item.comment, 240), 0) / entries.length,
      1.5 * modeWeight,
      source('entries')
    ));
  }
  if (record.narrativeArc) contributions.push(entry('narrative', 0.9, 2 * modeWeight, source('narrativeArc')));
  if (record.journeyStage) contributions.push(entry('exploration', 0.6, 0.75 * modeWeight, source('journeyStage')));
  return { contributions: contributions.flatMap(mapV1Contribution), aversionEvidence: [] };
}

function surveyContributions(response) {
  const id = response.id || response.survey?.id || null;
  const source = (field) => ({ kind: 'survey', id, field });
  const values = Object.values(response.answers || {});
  if (values.length === 0) return { contributions: [], aversionEvidence: [] };
  const v1 = [];
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length > 0) {
    const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    v1.push(entry('mastery', clamp((average - 1) / 4), 0.5, source('answers')));
  }
  v1.push(entry('reflection', clamp(values.length / 12), 0.75, source('answers')));

  const text = values.filter((value) => typeof value === 'string').join(' ');
  const aspects = aspectTextContributions(text, { weight: 0.75, source: source('answers') });
  // Free text has no sentiment slider; the analyzed valence (0..1, 0.5
  // neutral) gates the social keyword the same way.
  const valence = aspects.valence === null ? 0.5 : aspects.valence;
  const social = socialSignal(text, valence >= 0.5 ? 1 : -1, source('answers'));

  return {
    contributions: [
      ...v1.flatMap(mapV1Contribution),
      ...aspects.contributions,
      // Survey text is weaker evidence than a dedicated voice entry.
      ...social.contributions.map((item) => ({ ...item, value: 0.75, weight: 0.75 })),
    ],
    aversionEvidence: [
      ...aspects.aversionEvidence,
      ...social.aversionEvidence.map((item) => ({ ...item, strength: 0.5 })),
    ],
  };
}

function collectSourceContributions(sources) {
  const results = [
    ...sources.gameplay.map(gameplayContributions),
    ...sources.voices.map(voiceContributions),
    ...(sources.voiceMemos || []).map(voiceMemoContributions),
    ...sources.emotionCurves.map(emotionCurveContributions),
    ...sources.surveys.map(surveyContributions),
  ];
  return {
    contributions: results.flatMap((result) => result.contributions),
    aversionEvidence: results.flatMap((result) => result.aversionEvidence),
  };
}

module.exports = {
  collectSourceContributions,
  emotionCurveContributions,
  gameplayContributions,
  surveyContributions,
  voiceContributions,
  voiceMemoContributions,
};
