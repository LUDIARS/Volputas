const db = require('../config/database');
const { PREFERENCE_AXES } = require('./preferenceAxisDefinitions');
const AXIS_SET = new Set(PREFERENCE_AXES);

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function scoreQuestion(question, answer) {
  if (question.type === 'scale') {
    const minimum = Number(question.options?.min ?? 1);
    const maximum = Number(question.options?.max ?? 5);
    const numeric = Number(answer);
    if (!Number.isFinite(numeric) || maximum <= minimum) return null;
    return clamp((numeric - minimum) / (maximum - minimum), 0, 1);
  }
  if (question.type === 'choice') {
    const configured = question.scoring?.[String(answer)];
    if (typeof configured === 'number') return clamp(configured);
    if (configured && typeof configured === 'object') {
      const axisScore = Number(configured[question.axis]);
      if (Number.isFinite(axisScore)) return clamp(axisScore);
    }
    const option = Array.isArray(question.options)
      ? question.options.find((item) => {
        if (!item || typeof item !== 'object') return item === answer;
        return item.value === answer || item.label === answer;
      })
      : null;
    if (option && typeof option === 'object' && Number.isFinite(Number(option.weight))) {
      return clamp(Number(option.weight));
    }
    return 0.5;
  }
  return null;
}

function scorePreferenceAxes(records) {
  const totals = new Map();
  for (const record of records) {
    if (!Array.isArray(record.questions) || !record.answers || typeof record.answers !== 'object') continue;
    for (const question of record.questions) {
      if (!AXIS_SET.has(question.axis)) continue;
      const answer = record.answers[question.id];
      if (answer === undefined || answer === null) continue;
      const score = scoreQuestion(question, answer);
      if (score === null) continue;
      const current = totals.get(question.axis) || { total: 0, samples: 0 };
      current.total += score;
      current.samples += 1;
      totals.set(question.axis, current);
    }
  }
  return Object.fromEntries(
    [...totals.entries()].map(([axis, value]) => [axis, {
      score: Number((value.total / value.samples).toFixed(4)),
      samples: value.samples,
    }])
  );
}

async function recomputePreferenceAxes(userId, database = db) {
  const { rows } = await database.query(
    `SELECT sr.answers, s.questions
     FROM survey_responses sr
     JOIN surveys s ON s.id = sr.survey_id
     WHERE sr.user_id = $1`,
    [userId]
  );
  const scored = scorePreferenceAxes(rows);
  await database.transaction(async (client) => {
    await client.query('DELETE FROM player_preference_axes WHERE user_id = $1', [userId]);
    for (const [axis, value] of Object.entries(scored)) {
      await client.query(
        `INSERT INTO player_preference_axes (user_id, axis, score, samples)
         VALUES ($1, $2, $3, $4)`,
        [userId, axis, value.score, value.samples]
      );
    }
  });
  return scored;
}

async function getPreferenceAxes(userId, database = db) {
  const { rows } = await database.query(
    'SELECT axis, score FROM player_preference_axes WHERE user_id = $1 ORDER BY axis',
    [userId]
  );
  return Object.fromEntries(rows.map((row) => [row.axis, Number(row.score)]));
}

module.exports = {
  PREFERENCE_AXES,
  getPreferenceAxes,
  recomputePreferenceAxes,
  scorePreferenceAxes,
};
