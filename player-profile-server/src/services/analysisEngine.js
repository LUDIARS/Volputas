const db = require('../config/database');
const profileModel = require('../models/profileModel');

// Preference dimensions (Bartle Taxonomy extended)
const DIMENSIONS = [
  'achievement',  // 0
  'exploration',  // 1
  'social',       // 2
  'competition',  // 3
  'creativity',   // 4
  'narrative',    // 5
  'intensity',    // 6
  'mastery',      // 7
];

// Event type to dimension mapping with weights
const EVENT_DIMENSION_MAP = {
  level_clear:        { achievement: 0.6, mastery: 0.4 },
  area_discover:      { exploration: 1.0 },
  pvp_match:          { competition: 0.7, social: 0.3 },
  build_create:       { creativity: 1.0 },
  dialog_choice:      { narrative: 1.0 },
  session_heartbeat:  { intensity: 1.0 },
};

// Survey question dimension mapping
const SURVEY_DIMENSION_MAP = {
  achievement: 'achievement',
  exploration: 'exploration',
  social: 'social',
  competition: 'competition',
  creativity: 'creativity',
  narrative: 'narrative',
  intensity: 'intensity',
  mastery: 'mastery',
};

async function analyzeUser(userId) {
  const vector = new Array(DIMENSIONS.length).fill(0);
  const counts = new Array(DIMENSIONS.length).fill(0);

  // Step 1: Aggregate play events
  await aggregatePlayEvents(userId, vector, counts);

  // Step 2: Integrate survey responses
  await integrateSurveyResponses(userId, vector, counts);

  // Step 3: Normalize vector
  const normalizedVector = normalize(vector, counts);

  // Step 4: Derive tags
  const tags = deriveTags(normalizedVector);

  // Step 5: Update profile
  await profileModel.upsert(userId, {});
  await profileModel.updatePreferenceVector(userId, normalizedVector, tags);

  return { vector: normalizedVector, tags };
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

    // Special mastery scoring: factor in retries
    if (row.event_type === 'level_clear' && row.avg_retries !== null) {
      const masteryIdx = DIMENSIONS.indexOf('mastery');
      const retryBonus = Math.min(row.avg_retries / 5, 1.0);
      vector[masteryIdx] += eventCount * retryBonus * 0.3;
    }
  }

  // Intensity: compute from session durations
  const { rows: sessionRows } = await db.query(
    `SELECT COUNT(*) as session_count,
            AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) as avg_duration_sec
     FROM play_sessions
     WHERE user_id = $1 AND ended_at IS NOT NULL`,
    [userId]
  );

  if (sessionRows[0] && sessionRows[0].avg_duration_sec) {
    const intensityIdx = DIMENSIONS.indexOf('intensity');
    const durationScore = Math.min(sessionRows[0].avg_duration_sec / 3600, 1.0);
    const freqScore = Math.min(parseInt(sessionRows[0].session_count, 10) / 50, 1.0);
    vector[intensityIdx] += (durationScore + freqScore) * 10;
    counts[intensityIdx] += 2;
  }
}

async function integrateSurveyResponses(userId, vector, counts) {
  const { rows } = await db.query(
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
        vector[dimIndex] += 5;
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

function deriveTags(vector) {
  const threshold = 0.5;
  const tags = [];

  vector.forEach((val, i) => {
    if (val >= threshold) {
      tags.push(DIMENSIONS[i]);
    }
  });

  // If no strong tags, pick top 2
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

module.exports = { analyzeUser, DIMENSIONS };
