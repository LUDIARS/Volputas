// Pure 12-dimension classification engine (design §3.6 / T3): answers +
// question metadata in, classification scores out. No DB access here — the
// online adapter (analysisEngine.js) layers play-event aggregation and
// profile persistence on top, and the persona v2 pipeline calls
// classifyFromSurveyRecords directly so local mode shares the same math.
const {
  CLASSIFICATION_SCHEMA,
  DIMENSIONS,
  GAMER_TYPES,
} = require('./hobbyPatternDefinitions');
const { scoreGamerSubtypes, selectPrimarySubtype } = require('./subtypeScoring');

const SURVEY_DIMENSION_MAP = {
  // Gamer pattern dimensions
  power_fantasy: 'gamer_timmy',
  self_expression: 'gamer_johnny',
  winning: 'gamer_spike',
  flavor_story: 'gamer_vorthos',
  system_design: 'gamer_melvin',
  // Mechanics pattern dimensions
  competition: 'mechanics_agon',
  luck_chance: 'mechanics_alea',
  thrill_rush: 'mechanics_ilinx',
  roleplay: 'mechanics_mimicry',
  // Story dynamics dimensions
  goal_achievement: 'story_winner',
  daily_routine: 'story_banal',
  challenge_struggle: 'story_loser',
  // Legacy mappings (backward compat with old surveys)
  achievement: 'gamer_spike',
  exploration: 'gamer_vorthos',
  social: 'gamer_timmy',
  creativity: 'gamer_johnny',
  narrative: 'gamer_vorthos',
  mastery: 'gamer_melvin',
  intensity: 'mechanics_ilinx',
};

function createAccumulator() {
  return {
    vector: new Array(DIMENSIONS.length).fill(0),
    counts: new Array(DIMENSIONS.length).fill(0),
  };
}

// Choice questions may carry a `scoring` map ({ answerValue: -1..1 }), shared with the
// 15-axis preferenceAxes engine (see preferenceAxes.js scoreQuestion). When present it takes
// precedence and is rescaled to this engine's 0..10 domain. Falls back to the legacy
// per-option `weight` (already 0..10) for surveys authored before `scoring` existed.
function choiceWeight(question, answer) {
  const configured = question.scoring?.[String(answer)];
  if (Number.isFinite(Number(configured))) {
    const clamped = Math.max(-1, Math.min(1, Number(configured)));
    return (clamped + 1) * 5;
  }
  const selected = Array.isArray(question.options)
    ? question.options.find((option) => {
      if (!option || typeof option !== 'object') return option === answer;
      return option.value === answer || option.label === answer;
    })
    : null;
  return selected && typeof selected === 'object' && Number.isFinite(Number(selected.weight))
    ? Number(selected.weight)
    : 5;
}

// records: [{ questions, answers }]
function integrateSurveyRecords(records, vector, counts) {
  for (const record of records || []) {
    const { questions, answers } = record;
    if (!Array.isArray(questions) || !answers || typeof answers !== 'object') continue;

    for (const question of questions) {
      const dimension = SURVEY_DIMENSION_MAP[question.dimension];
      if (!dimension) continue;

      const dimIndex = DIMENSIONS.indexOf(dimension);
      if (dimIndex === -1) continue;

      const answer = answers[question.id];
      if (answer === undefined || answer === null) continue;

      if (question.type === 'scale') {
        const max = question.options?.max || 5;
        const min = question.options?.min || 1;
        const normalizedScore = (Number(answer) - min) / (max - min);
        vector[dimIndex] += normalizedScore * 10;
        counts[dimIndex] += 1;
      } else if (question.type === 'choice') {
        vector[dimIndex] += choiceWeight(question, answer);
        counts[dimIndex] += 1;
      }
    }
  }
}

function normalize(vector, counts) {
  return vector.map((val, i) => {
    if (counts[i] === 0) return 0;
    const avg = val / counts[i];
    return Math.round(Math.min(Math.max(avg / 10, 0), 1) * 1000) / 1000;
  });
}

function classifyPatterns(vector) {
  const result = {};

  for (const [patternKey, schema] of Object.entries(CLASSIFICATION_SCHEMA)) {
    const scores = {};
    let maxScore = 0;
    let primary = null;

    for (const dim of schema.dimensions) {
      const dimIndex = DIMENSIONS.indexOf(dim);
      const score = dimIndex >= 0 ? vector[dimIndex] : 0;
      const typeKey = dim.replace(`${patternKey}_`, '');
      scores[typeKey] = score;

      if (score > maxScore) {
        maxScore = score;
        primary = typeKey;
      }
    }

    result[patternKey] = {
      label: schema.label,
      scores,
      primary,
      primaryScore: maxScore,
    };
  }

  return result;
}

// `measuredSubtypes` comes from the dedicated `gamer-subtypes` survey (see
// src/surveys/gamerSubtypesSurvey.js). When the respondent answered it, the subtype is read
// from those answers. Otherwise the legacy positional heuristic below is used, which derives
// nothing from actual subtype questions — hence the explicit `source` field, so a consumer can
// tell a measured subtype from a guessed one instead of treating both as a result.
function detectSubtypes(vector, classification, measuredSubtypes = {}) {
  const gamer = classification.gamer;
  if (!gamer || !gamer.primary) return {};

  const gamerType = GAMER_TYPES[gamer.primary];
  if (!gamerType || !gamerType.subtypes) return {};

  const measured = selectPrimarySubtype(gamer.primary, measuredSubtypes);
  if (measured) {
    return {
      gamerType: gamer.primary,
      gamerLabel: gamerType.label,
      source: 'survey',
      primarySubtype: measured.primarySubtype,
      subtypeScores: measured.subtypeScores,
      subtypeSamples: measured.subtypeSamples,
    };
  }

  // This heuristic remains experimental until calibrated against labelled player data.
  // Determine subtype based on secondary pattern signals
  const mechanicsScores = classification.mechanics?.scores || {};
  const storyScores = classification.story?.scores || {};

  const subtypeScoring = gamerType.subtypes.map((subtype, idx) => {
    let score = 0;

    // Cross-reference with mechanics pattern
    const mechanicsValues = Object.values(mechanicsScores);
    if (mechanicsValues[idx % mechanicsValues.length]) {
      score += mechanicsValues[idx % mechanicsValues.length];
    }

    // Cross-reference with story dynamics
    const storyValues = Object.values(storyScores);
    if (storyValues[idx % storyValues.length]) {
      score += storyValues[idx % storyValues.length] * 0.5;
    }

    return { subtype, score };
  });

  subtypeScoring.sort((a, b) => b.score - a.score);

  return {
    gamerType: gamer.primary,
    gamerLabel: gamerType.label,
    source: 'heuristic',
    primarySubtype: subtypeScoring[0]?.subtype || null,
    subtypeScores: Object.fromEntries(subtypeScoring.map((s) => [s.subtype, s.score])),
  };
}

function deriveTags(vector, classification) {
  const tags = [];

  // Add primary type from each pattern as tag
  for (const [patternKey, result] of Object.entries(classification)) {
    if (result.primary && result.primaryScore > 0) {
      tags.push(`${patternKey}:${result.primary}`);
    }
  }

  // Add any dimension with score >= 0.5 as supplementary tag
  const threshold = 0.5;
  vector.forEach((val, i) => {
    if (val >= threshold) {
      const dimTag = DIMENSIONS[i];
      if (!tags.some((t) => t.endsWith(dimTag.split('_').pop()))) {
        tags.push(dimTag);
      }
    }
  });

  // If no tags, pick top 2 dimensions
  if (tags.length === 0) {
    const indexed = vector.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => b.v - a.v);
    for (let j = 0; j < Math.min(2, indexed.length); j++) {
      if (indexed[j].v > 0) {
        tags.push(DIMENSIONS[indexed[j].i]);
      }
    }
  }

  return tags;
}

// Survey-only classification for modes without play-event data (local mode /
// persona.json v2). Returns null when no dimension received any signal so the
// caller can distinguish "no data" from an all-zero profile.
function classifyFromSurveyRecords(records) {
  const { vector, counts } = createAccumulator();
  integrateSurveyRecords(records, vector, counts);
  if (counts.every((count) => count === 0)) return null;

  const normalizedVector = normalize(vector, counts);
  const classification = classifyPatterns(normalizedVector);
  const tags = deriveTags(normalizedVector, classification);
  const subtypes = detectSubtypes(normalizedVector, classification, scoreGamerSubtypes(records));
  return {
    vector: normalizedVector,
    classification,
    tags,
    subtypes,
  };
}

module.exports = {
  SURVEY_DIMENSION_MAP,
  choiceWeight,
  classifyFromSurveyRecords,
  classifyPatterns,
  createAccumulator,
  deriveTags,
  detectSubtypes,
  integrateSurveyRecords,
  normalize,
};
