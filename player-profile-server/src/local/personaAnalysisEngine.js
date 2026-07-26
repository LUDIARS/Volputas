const AXES = [
  ['exploration', '探索志向'],
  ['mastery', '習熟志向'],
  ['completion', '達成志向'],
  ['challenge', '挑戦志向'],
  ['narrative', '物語志向'],
  ['emotionalEngagement', '感情没入'],
  ['reflection', '内省・言語化'],
  ['social', '共有・交流志向'],
];

function clamp(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function createAccumulator() {
  return Object.fromEntries(AXES.map(([id]) => [id, { total: 0, weight: 0 }]));
}

function add(accumulator, axis, value, weight = 1) {
  accumulator[axis].total += clamp(value) * weight;
  accumulator[axis].weight += weight;
}

function textStrength(value, fullAt = 400) {
  return clamp(String(value || '').trim().length / fullAt);
}

function containsAny(values, terms) {
  const haystack = values.join(' ').toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function addGameplayEvidence(accumulator, record) {
  const dedication = record.dedication?.score;
  if (Number.isFinite(dedication)) {
    add(accumulator, 'mastery', dedication / 100, 2);
    add(accumulator, 'challenge', (record.selfRatedMastery || 1) / 5, 1.25);
  }
  if (Number.isFinite(record.completionPercent)) {
    add(accumulator, 'completion', record.completionPercent / 100, 2);
  }
  if (Number.isFinite(record.achievementsTotal) && record.achievementsTotal > 0) {
    add(
      accumulator,
      'completion',
      (record.achievementsUnlocked || 0) / record.achievementsTotal,
      1.5
    );
  }
  add(accumulator, 'reflection', textStrength(record.userInfo), 0.75);
  if (record.screenshotFileName) add(accumulator, 'exploration', 0.55, 0.5);
}

function addVoiceEvidence(accumulator, record) {
  const emotionalStrength = Math.abs(Number(record.sentiment) || 0) / 2;
  add(accumulator, 'emotionalEngagement', emotionalStrength, 1.5);
  add(accumulator, 'reflection', textStrength(record.comment), 1.5);
  if (record.scopeType === 'content') add(accumulator, 'exploration', 0.6, 0.75);
  const terms = [record.comment, ...(record.tags || [])];
  if (containsAny(terms, ['story', 'narrative', '物語', 'ストーリー', '世界観', 'キャラ'])) {
    add(accumulator, 'narrative', 0.85, 1.5);
  }
  if (containsAny(terms, ['friend', 'multi', 'guild', 'coop', '友達', '協力', '対戦', '交流'])) {
    add(accumulator, 'social', 0.8, 1.5);
  }
}

function addEmotionEvidence(accumulator, record) {
  const entries = record.entries || [];
  if (entries.length > 0) {
    const averageEmotion = entries.reduce(
      (sum, entry) => sum + Math.abs(Number(entry.valence) || 0) / 2,
      0
    ) / entries.length;
    const averageArousal = entries.reduce(
      (sum, entry) => sum + ((Number(entry.arousal) || 1) - 1) / 4,
      0
    ) / entries.length;
    add(accumulator, 'emotionalEngagement', (averageEmotion + averageArousal) / 2, 2);
    add(
      accumulator,
      'reflection',
      entries.reduce((sum, entry) => sum + textStrength(entry.comment, 240), 0)
        / entries.length,
      1.5
    );
  }
  if (record.narrativeArc) add(accumulator, 'narrative', 0.9, 2);
  if (record.journeyStage) add(accumulator, 'exploration', 0.6, 0.75);
}

function addSurveyEvidence(accumulator, response) {
  const values = Object.values(response.answers || {});
  if (values.length === 0) return;
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length > 0) {
    const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    add(accumulator, 'mastery', clamp((average - 1) / 4), 0.5);
  }
  add(accumulator, 'reflection', clamp(values.length / 12), 0.75);
  const text = values.map(String);
  if (containsAny(text, ['story', 'narrative', '物語', 'ストーリー'])) {
    add(accumulator, 'narrative', 0.75, 0.75);
  }
  if (containsAny(text, ['social', 'friend', 'multi', '友達', '協力', '対戦'])) {
    add(accumulator, 'social', 0.75, 0.75);
  }
}

function analyzePersona(sources, analyzedAt) {
  const accumulator = createAccumulator();
  sources.gameplay.forEach((record) => addGameplayEvidence(accumulator, record));
  sources.voices.forEach((record) => addVoiceEvidence(accumulator, record));
  sources.emotionCurves.forEach((record) => addEmotionEvidence(accumulator, record));
  sources.surveys.forEach((record) => addSurveyEvidence(accumulator, record));

  const axes = Object.fromEntries(AXES.map(([id, label]) => {
    const value = accumulator[id].weight === 0
      ? 0
      : accumulator[id].total / accumulator[id].weight;
    return [id, {
      label,
      score: Math.round(clamp(value) * 100),
      evidenceWeight: Number(accumulator[id].weight.toFixed(2)),
    }];
  }));
  const leadingAxes = Object.entries(axes)
    .filter(([, axis]) => axis.evidenceWeight > 0)
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, 3)
    .map(([id, axis]) => ({ id, ...axis }));

  return {
    schemaVersion: 1,
    modelVersion: 'local-persona-v1',
    analyzedAt,
    axes,
    leadingAxes,
    evidence: {
      surveys: sources.surveys.length,
      gameplay: sources.gameplay.length,
      voices: sources.voices.length,
      emotionCurves: sources.emotionCurves.length,
    },
    note: '入力済みデータから傾向を可視化するローカル推定です。診断や人物評価ではありません。',
  };
}

module.exports = { AXES, analyzePersona };
