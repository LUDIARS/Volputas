const db = require('../config/database');
const profileModel = require('../models/profileModel');

// =============================================================================
// Hobby Classification Patterns
// =============================================================================

// Pattern 1: Gamer Pattern
// Based on Magic: The Gathering psychographics (Timmy/Johnny/Spike + Vorthos/Melvin)
// Each main type has 4 subtypes
const GAMER_TYPES = {
  timmy: {
    label: 'Timmy/Tammy',
    description: 'Power gamer — seeks impressive, visceral experiences',
    subtypes: ['power', 'social', 'diversity', 'adrenaline'],
  },
  johnny: {
    label: 'Johnny/Jenny',
    description: 'Combo player — seeks creative self-expression',
    subtypes: ['combo', 'offbeat', 'uber', 'eliminator'],
  },
  spike: {
    label: 'Spike',
    description: 'Tournament player — seeks to prove ability through winning',
    subtypes: ['innovator', 'tuner', 'analyst', 'nut'],
  },
  vorthos: {
    label: 'Vorthos',
    description: 'Flavor enthusiast — values story, art, and world-building',
    subtypes: ['creative', 'collector', 'loremaster', 'cosplayer'],
  },
  melvin: {
    label: 'Melvin',
    description: 'Mechanics enthusiast — appreciates elegant system design',
    subtypes: ['designer', 'optimizer', 'theorist', 'completionist'],
  },
};

// Pattern 2: Mechanics Pattern
// Based on Roger Caillois' "Man and Play" (Les jeux et les hommes)
const MECHANICS_TYPES = {
  agon: {
    label: 'Agon',
    description: 'Competition — structured contests of skill and merit',
  },
  alea: {
    label: 'Alea',
    description: 'Chance/Luck — outcomes determined by fortune and randomness',
  },
  ilinx: {
    label: 'Ilinx',
    description: 'Vertigo/Thrill — pursuit of disorientation and altered perception',
  },
  mimicry: {
    label: 'Mimicry',
    description: 'Imitation/Roleplay — becoming another through simulation',
  },
};

// Pattern 3: Story Dynamics
// Based on Eric Berne's life scripts (Transactional Analysis)
const STORY_TYPES = {
  winner: {
    label: 'Winner Script',
    description: 'Pursues goals and achieves them — growth-oriented narrative',
  },
  banal: {
    label: 'Banal Script',
    description: 'Follows conventional paths — stability-oriented narrative',
  },
  loser: {
    label: 'Loser Script',
    description: 'Faces setbacks as recurring theme — conflict-oriented narrative',
  },
};

// =============================================================================
// Classification Dimensions (flat list for vector storage)
// =============================================================================

const DIMENSIONS = [
  // Gamer Pattern (5 main types)
  'gamer_timmy',
  'gamer_johnny',
  'gamer_spike',
  'gamer_vorthos',
  'gamer_melvin',
  // Mechanics Pattern (4 types)
  'mechanics_agon',
  'mechanics_alea',
  'mechanics_ilinx',
  'mechanics_mimicry',
  // Story Dynamics (3 types)
  'story_winner',
  'story_banal',
  'story_loser',
];

// =============================================================================
// Classification Schema (exported for API consumers)
// =============================================================================

const CLASSIFICATION_SCHEMA = {
  gamer: {
    label: 'Gamer Pattern',
    description: 'MTG psychographic profiles — how and why you play',
    types: GAMER_TYPES,
    dimensions: ['gamer_timmy', 'gamer_johnny', 'gamer_spike', 'gamer_vorthos', 'gamer_melvin'],
  },
  mechanics: {
    label: 'Mechanics Pattern',
    description: "Caillois' play categories — what kind of play attracts you",
    types: MECHANICS_TYPES,
    dimensions: ['mechanics_agon', 'mechanics_alea', 'mechanics_ilinx', 'mechanics_mimicry'],
  },
  story: {
    label: 'Story Dynamics',
    description: "Berne's life scripts — what narrative arc drives you",
    types: STORY_TYPES,
    dimensions: ['story_winner', 'story_banal', 'story_loser'],
  },
};

// =============================================================================
// Event → Dimension Mapping
// =============================================================================

const EVENT_DIMENSION_MAP = {
  // Power-oriented events → Timmy + Agon
  level_clear: {
    gamer_timmy: 0.4,
    gamer_spike: 0.3,
    mechanics_agon: 0.5,
    story_winner: 0.4,
  },
  // Discovery events → Vorthos + Mimicry
  area_discover: {
    gamer_vorthos: 0.6,
    gamer_johnny: 0.2,
    mechanics_mimicry: 0.3,
    story_banal: 0.2,
  },
  // PvP events → Spike + Agon
  pvp_match: {
    gamer_spike: 0.6,
    gamer_timmy: 0.2,
    mechanics_agon: 0.7,
    story_winner: 0.3,
  },
  // Building/creation events → Johnny + Mimicry
  build_create: {
    gamer_johnny: 0.6,
    gamer_melvin: 0.2,
    mechanics_mimicry: 0.4,
    story_winner: 0.2,
  },
  // Dialogue/story events → Vorthos + Mimicry
  dialog_choice: {
    gamer_vorthos: 0.7,
    mechanics_mimicry: 0.5,
    story_banal: 0.3,
  },
  // RNG/gacha events → Alea
  gacha_pull: {
    mechanics_alea: 0.8,
    gamer_timmy: 0.3,
    story_banal: 0.2,
  },
  // High-speed/action events → Ilinx
  speed_run: {
    mechanics_ilinx: 0.6,
    gamer_spike: 0.4,
    story_winner: 0.3,
  },
  // Customization events → Johnny + Melvin
  customize: {
    gamer_johnny: 0.4,
    gamer_melvin: 0.3,
    mechanics_mimicry: 0.3,
  },
};

// =============================================================================
// Survey → Dimension Mapping
// =============================================================================

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

// =============================================================================
// Analysis Engine
// =============================================================================

async function analyzeUser(userId) {
  const vector = new Array(DIMENSIONS.length).fill(0);
  const counts = new Array(DIMENSIONS.length).fill(0);

  // Step 1: Aggregate play events
  await aggregatePlayEvents(userId, vector, counts);

  // Step 2: Integrate survey responses
  await integrateSurveyResponses(userId, vector, counts);

  // Step 3: Normalize vector
  const normalizedVector = normalize(vector, counts);

  // Step 4: Classify patterns
  const classification = classifyPatterns(normalizedVector);

  // Step 5: Derive tags
  const tags = deriveTags(normalizedVector, classification);

  // Step 6: Detect gamer subtypes
  const subtypes = detectSubtypes(normalizedVector, classification);

  // Step 7: Update profile
  await profileModel.upsert(userId, {});
  await profileModel.updatePreferenceVector(userId, normalizedVector, tags, classification, subtypes);

  return {
    vector: normalizedVector,
    tags,
    classification,
    subtypes,
  };
}

async function aggregatePlayEvents(userId, vector, counts) {
  const { rows } = await db.query(
    `SELECT pe.event_type, COUNT(*) as count,
            AVG((pe.event_data->>'time_sec')::float) as avg_time,
            AVG((pe.event_data->>'retries')::float) as avg_retries
     FROM play_events pe
     JOIN play_sessions ps ON pe.session_id = ps.id
     WHERE ps.user_id = $1
     GROUP BY pe.event_type`,
    [userId]
  );

  for (const row of rows) {
    const mapping = EVENT_DIMENSION_MAP[row.event_type];
    if (!mapping) continue;

    const eventCount = parseInt(row.count, 10);

    for (const [dim, weight] of Object.entries(mapping)) {
      const dimIndex = DIMENSIONS.indexOf(dim);
      if (dimIndex === -1) continue;

      vector[dimIndex] += eventCount * weight;
      counts[dimIndex] += eventCount;
    }

    // Mastery/retry behavior → Spike + Melvin affinity
    if (row.event_type === 'level_clear' && row.avg_retries !== null) {
      const spikeIdx = DIMENSIONS.indexOf('gamer_spike');
      const melvinIdx = DIMENSIONS.indexOf('gamer_melvin');
      const retryBonus = Math.min(row.avg_retries / 5, 1.0);
      vector[spikeIdx] += eventCount * retryBonus * 0.3;
      vector[melvinIdx] += eventCount * retryBonus * 0.2;
    }
  }

  // Session frequency/duration → Story Dynamics signals
  const { rows: sessionRows } = await db.query(
    `SELECT COUNT(*) as session_count,
            AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) as avg_duration_sec
     FROM play_sessions
     WHERE user_id = $1 AND ended_at IS NOT NULL`,
    [userId]
  );

  if (sessionRows[0] && sessionRows[0].avg_duration_sec) {
    const durationScore = Math.min(sessionRows[0].avg_duration_sec / 3600, 1.0);
    const freqScore = Math.min(parseInt(sessionRows[0].session_count, 10) / 50, 1.0);
    const engagement = (durationScore + freqScore) * 5;

    // High engagement → Winner script tendency
    const winnerIdx = DIMENSIONS.indexOf('story_winner');
    vector[winnerIdx] += engagement;
    counts[winnerIdx] += 2;

    // Moderate engagement → Banal script
    const banalIdx = DIMENSIONS.indexOf('story_banal');
    vector[banalIdx] += (1 - Math.abs(durationScore - 0.5)) * 10;
    counts[banalIdx] += 2;

    // Ilinx from session intensity
    const ilinxIdx = DIMENSIONS.indexOf('mechanics_ilinx');
    vector[ilinxIdx] += durationScore * 5;
    counts[ilinxIdx] += 1;
  }
}

async function integrateSurveyResponses(userId, vector, counts, database = db) {
  const { rows } = await database.query(
    `SELECT sr.answers, s.questions
     FROM survey_responses sr
     JOIN surveys s ON sr.survey_id = s.id
     WHERE sr.user_id = $1`,
    [userId]
  );

  for (const row of rows) {
    const questions = row.questions;
    const answers = row.answers;

    if (!Array.isArray(questions)) continue;

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
        const selected = Array.isArray(question.options)
          ? question.options.find((option) => {
            if (!option || typeof option !== 'object') return option === answer;
            return option.value === answer || option.label === answer;
          })
          : null;
        const choiceWeight = selected && typeof selected === 'object' && Number.isFinite(Number(selected.weight))
          ? Number(selected.weight)
          : 5;
        vector[dimIndex] += choiceWeight;
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

// =============================================================================
// Pattern Classification
// =============================================================================

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

function detectSubtypes(vector, classification) {
  const gamer = classification.gamer;
  if (!gamer || !gamer.primary) return {};

  const gamerType = GAMER_TYPES[gamer.primary];
  if (!gamerType || !gamerType.subtypes) return {};

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

module.exports = {
  analyzeUser,
  DIMENSIONS,
  CLASSIFICATION_SCHEMA,
  GAMER_TYPES,
  MECHANICS_TYPES,
  STORY_TYPES,
  EVENT_DIMENSION_MAP,
  integrateSurveyResponses,
};
