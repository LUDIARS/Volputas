// Shared validation contract for local and authenticated profile evidence.
function requiredText(value, label, maximum = 200) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw Object.assign(new Error(`${label} is required`), { code: 'INVALID_PROFILE_INPUT' });
  }
  if (normalized.length > maximum) {
    throw Object.assign(new Error(`${label} is too long`), { code: 'INVALID_PROFILE_INPUT' });
  }
  return normalized;
}

function optionalText(value, maximum = 4000) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (normalized.length > maximum) {
    throw Object.assign(new Error('Text input is too long'), { code: 'INVALID_PROFILE_INPUT' });
  }
  return normalized;
}

function optionalNumber(value, minimum, maximum) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw Object.assign(new Error(`Number must be between ${minimum} and ${maximum}`), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  return number;
}

function calculateDedication(input) {
  const signals = [
    [input.playtimeHours === null ? null : Math.min(input.playtimeHours / 120, 1), 0.35],
    [input.completionPercent === null ? null : input.completionPercent / 100, 0.3],
    [
      input.achievementsUnlocked === null || input.achievementsTotal === null
        || input.achievementsTotal === 0
        ? null
        : input.achievementsUnlocked / input.achievementsTotal,
      0.2,
    ],
    [input.selfRatedMastery === null ? null : input.selfRatedMastery / 5, 0.15],
  ].filter(([value]) => value !== null);

  if (signals.length === 0) {
    return { score: null, confidence: 'needs-details', signalsUsed: 0 };
  }
  const totalWeight = signals.reduce((sum, [, weight]) => sum + weight, 0);
  const weighted = signals.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return {
    score: Math.round((weighted / totalWeight) * 100),
    confidence: signals.length >= 3 ? 'high' : signals.length === 2 ? 'medium' : 'low',
    signalsUsed: signals.length,
  };
}

function validateGameplayInput(body = {}) {
  const input = {
    gameTitle: requiredText(body.gameTitle, 'Game title'),
    platform: optionalText(body.platform, 80),
    playtimeHours: optionalNumber(body.playtimeHours, 0, 100000),
    completionPercent: optionalNumber(body.completionPercent, 0, 100),
    achievementsUnlocked: optionalNumber(body.achievementsUnlocked, 0, 100000),
    achievementsTotal: optionalNumber(body.achievementsTotal, 0, 100000),
    selfRatedMastery: optionalNumber(body.selfRatedMastery, 1, 5),
    userInfo: optionalText(body.userInfo),
    screenshotFileName: optionalText(body.screenshotFileName, 255),
  };
  if (
    input.achievementsUnlocked !== null
    && input.achievementsTotal !== null
    && input.achievementsUnlocked > input.achievementsTotal
  ) {
    throw Object.assign(new Error('Unlocked achievements cannot exceed total achievements'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  return { ...input, dedication: calculateDedication(input) };
}

function validateVoiceInput(body = {}) {
  const scopeType = body.scopeType === 'content' ? 'content' : 'game';
  return {
    gameTitle: requiredText(body.gameTitle, 'Game title'),
    scopeType,
    contentName: scopeType === 'content'
      ? requiredText(body.contentName, 'Content name')
      : '',
    sentiment: optionalNumber(body.sentiment, -2, 2) ?? 0,
    comment: requiredText(body.comment, 'Comment', 8000),
    tags: optionalText(body.tags, 500)
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20),
  };
}

function validateEmotionCurveInput(body = {}) {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) {
    throw Object.assign(new Error('Add at least one timed reaction'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  return {
    gameTitle: requiredText(body.gameTitle, 'Game title'),
    videoFileName: requiredText(body.videoFileName, 'Video file name', 255),
    daysAfterPlay: optionalNumber(body.daysAfterPlay, 0, 36500),
    sessionLabel: optionalText(body.sessionLabel, 120),
    playContext: optionalText(body.playContext, 1000),
    narrativeArc: optionalText(body.narrativeArc, 120),
    journeyStage: optionalText(body.journeyStage, 120),
    entries: entries.slice(0, 500).map((entry) => ({
      timeSeconds: optionalNumber(entry.timeSeconds, 0, 864000) ?? 0,
      valence: optionalNumber(entry.valence, -2, 2) ?? 0,
      arousal: optionalNumber(entry.arousal, 1, 5) ?? 3,
      comment: requiredText(entry.comment, 'Timed comment', 2000),
    })).sort((left, right) => left.timeSeconds - right.timeSeconds),
  };
}

module.exports = {
  calculateDedication,
  validateEmotionCurveInput,
  validateGameplayInput,
  validateVoiceInput,
};
