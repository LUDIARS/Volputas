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

const MECHANIC_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;

function validateMechanicIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw Object.assign(new Error('mechanicIds must be an array'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  return value.slice(0, 20).map((id) => {
    const normalized = String(id).trim().toLowerCase();
    if (!MECHANIC_ID_PATTERN.test(normalized)) {
      throw Object.assign(new Error(`Invalid mechanic id: ${id}`), {
        code: 'INVALID_PROFILE_INPUT',
      });
    }
    return normalized;
  });
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
    // polarity states the direction explicitly (design §3.5); the sentiment
    // slider stays the intensity.
    polarity: body.polarity === 'like' || body.polarity === 'dislike' ? body.polarity : null,
    // Ludus lexicon ids like "action/dodge-roll"; membership is not enforced
    // so the Voluptas-side overlay vocabulary keeps working.
    mechanicIds: validateMechanicIds(body.mechanicIds),
    comment: requiredText(body.comment, 'Comment', 8000),
    tags: optionalText(body.tags, 500)
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20),
  };
}

// One-tap stamps map onto the valence/arousal circumplex so persona analysis
// keeps working on stamp-only entries without new axes.
const EMOTION_STAMPS = {
  hype: { label: '盛り上がり', valence: 2, arousal: 5 },
  like: { label: 'スキ', valence: 2, arousal: 2 },
  dislike: { label: '嫌い', valence: -2, arousal: 2 },
  stress: { label: 'ストレス', valence: -2, arousal: 5 },
};

function validateEmotionEntry(entry = {}, mode = 'video') {
  const stamp = entry.stamp === undefined || entry.stamp === null || entry.stamp === ''
    ? null
    : String(entry.stamp);
  if (stamp !== null && !EMOTION_STAMPS[stamp]) {
    throw Object.assign(new Error(`Unknown emotion stamp: ${stamp}`), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  const comment = optionalText(entry.comment, 2000);
  if (!stamp && !comment) {
    throw Object.assign(new Error('Each timed reaction needs a stamp or a comment'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  const defaults = stamp ? EMOTION_STAMPS[stamp] : null;
  const shared = {
    stamp,
    valence: optionalNumber(entry.valence, -2, 2) ?? (defaults ? defaults.valence : 0),
    arousal: optionalNumber(entry.arousal, 1, 5) ?? (defaults ? defaults.arousal : 3),
    comment,
    // 進行アンカー (design §3.4): free-form label like 「3章ボス」; developer
    // aggregation joins on exact string match.
    progressLabel: optionalText(entry.progressLabel, 80),
  };
  if (mode === 'memory') {
    const position = optionalNumber(entry.position, 0, 100);
    if (position === null) {
      throw Object.assign(new Error('Memory-mode reactions need a position (0-100%)'), {
        code: 'INVALID_PROFILE_INPUT',
      });
    }
    return { position, ...shared };
  }
  return {
    timeSeconds: optionalNumber(entry.timeSeconds, 0, 864000) ?? 0,
    ...shared,
  };
}

function validateEmotionCurveInput(body = {}) {
  const mode = body.mode === 'memory' ? 'memory' : 'video';
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) {
    throw Object.assign(new Error('Add at least one timed reaction'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  const orderKey = mode === 'memory' ? 'position' : 'timeSeconds';
  return {
    gameTitle: requiredText(body.gameTitle, 'Game title'),
    mode,
    // memory mode is the video-less recollection sketch (design §3.4).
    videoFileName: mode === 'video'
      ? requiredText(body.videoFileName, 'Video file name', 255)
      : optionalText(body.videoFileName, 255),
    gameLogFileName: optionalText(body.gameLogFileName, 255),
    daysAfterPlay: optionalNumber(body.daysAfterPlay, 0, 36500),
    totalPlaytimeHours: optionalNumber(body.totalPlaytimeHours, 0, 100000),
    sessionPlaytimeMinutes: optionalNumber(body.sessionPlaytimeMinutes, 0, 100000),
    sessionLabel: optionalText(body.sessionLabel, 120),
    playContext: optionalText(body.playContext, 1000),
    narrativeArc: optionalText(body.narrativeArc, 120),
    journeyStage: optionalText(body.journeyStage, 120),
    entries: entries.slice(0, 500)
      .map((entry) => validateEmotionEntry(entry, mode))
      .sort((left, right) => left[orderKey] - right[orderKey]),
  };
}

// Pairwise comparison (design §4.1): experience cards reference the fixed
// deck; game comparisons carry free-form titles.
function validateComparisonInput(body = {}) {
  const kind = body.kind === 'game' ? 'game' : 'experience';
  const itemA = requiredText(body.itemA, 'Item A', 120);
  const itemB = requiredText(body.itemB, 'Item B', 120);
  if (itemA === itemB) {
    throw Object.assign(new Error('Comparison items must differ'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  if (body.winner !== 'a' && body.winner !== 'b') {
    throw Object.assign(new Error('Winner must be "a" or "b"'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  return { kind, itemA, itemB, winner: body.winner };
}

function validateCardSortInput(body = {}) {
  const mechanicId = requiredText(body.mechanicId, 'Mechanic id', 120).toLowerCase();
  if (!MECHANIC_ID_PATTERN.test(mechanicId)) {
    throw Object.assign(new Error(`Invalid mechanic id: ${body.mechanicId}`), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  if (!['love', 'neutral', 'avoid'].includes(body.bucket)) {
    throw Object.assign(new Error('Bucket must be "love", "neutral", or "avoid"'), {
      code: 'INVALID_PROFILE_INPUT',
    });
  }
  return { mechanicId, bucket: body.bucket };
}

function validatePitchInput(body = {}) {
  return {
    title: requiredText(body.title, 'Pitch title', 200),
    body: requiredText(body.body, 'Pitch body', 12000),
    referenceGames: optionalText(body.referenceGames, 1000),
  };
}

module.exports = {
  EMOTION_STAMPS,
  calculateDedication,
  validateCardSortInput,
  validateComparisonInput,
  validateEmotionCurveInput,
  validateGameplayInput,
  validatePitchInput,
  validateVoiceInput,
};
