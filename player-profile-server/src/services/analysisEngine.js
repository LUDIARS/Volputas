// Online (DB-backed) adapter around the pure 12-dimension classification
// engine (design §3.6): play-event aggregation and profile persistence live
// here; the classification math itself is in classificationEngine.js and is
// shared with local mode / persona.json v2.
const db = require('../config/database');
const profileModel = require('../models/profileModel');
const {
  CLASSIFICATION_SCHEMA,
  DIMENSIONS,
  GAMER_TYPES,
  MECHANICS_TYPES,
  STORY_TYPES,
} = require('./hobbyPatternDefinitions');
const { scoreGamerSubtypes } = require('./subtypeScoring');
const {
  SURVEY_DIMENSION_MAP,
  classifyPatterns,
  createAccumulator,
  deriveTags,
  detectSubtypes,
  integrateSurveyRecords,
  normalize,
} = require('./classificationEngine');

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
// Analysis Engine
// =============================================================================

async function analyzeUser(userId) {
  const { vector, counts } = createAccumulator();

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
  const measuredSubtypes = await loadMeasuredSubtypeScores(userId);
  const subtypes = detectSubtypes(normalizedVector, classification, measuredSubtypes);

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
  integrateSurveyRecords(rows, vector, counts);
}

// Subtype answers live in the same survey_responses rows as everything else, but they do not
// contribute to the 12-dimension vector — they narrow an already-determined main type — so they
// are aggregated separately by subtypeScoring.js instead of inside integrateSurveyRecords.
async function loadMeasuredSubtypeScores(userId, database = db) {
  const { rows } = await database.query(
    `SELECT sr.answers, s.questions
     FROM survey_responses sr
     JOIN surveys s ON sr.survey_id = s.id
     WHERE sr.user_id = $1`,
    [userId]
  );
  return scoreGamerSubtypes(rows);
}

module.exports = {
  analyzeUser,
  detectSubtypes,
  DIMENSIONS,
  CLASSIFICATION_SCHEMA,
  GAMER_TYPES,
  MECHANICS_TYPES,
  STORY_TYPES,
  EVENT_DIMENSION_MAP,
  integrateSurveyResponses,
  loadMeasuredSubtypeScores,
  SURVEY_DIMENSION_MAP,
};
