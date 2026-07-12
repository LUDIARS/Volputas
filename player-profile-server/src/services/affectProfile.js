const { textToVector, weightedMean, VECTOR_SPEC_VERSION } = require('@ludiars/sentiment-core');
const db = require('../config/database');

function collectFreeTextSamples(records) {
  const samples = [];
  for (const record of records) {
    if (!Array.isArray(record.questions) || !record.answers || typeof record.answers !== 'object') continue;
    for (const question of record.questions) {
      if (!['freetext', 'free_text', 'text'].includes(question.type)) continue;
      const answer = record.answers[question.id];
      if (typeof answer !== 'string' || !answer.trim()) continue;
      samples.push({ text: answer.trim(), weight: Number(question.weight) || 1 });
    }
  }
  return samples;
}

function computeAffectProfile(samples) {
  if (!samples.length) return null;
  return {
    vector: weightedMean(
      samples.map((sample) => textToVector(sample.text)),
      samples.map((sample) => sample.weight)
    ),
    sampleTexts: samples.length,
    vectorSpecVersion: VECTOR_SPEC_VERSION,
  };
}

async function recomputeAffectProfile(userId, database = db) {
  const { rows } = await database.query(
    `SELECT sr.answers, s.questions
     FROM survey_responses sr
     JOIN surveys s ON s.id = sr.survey_id
     WHERE sr.user_id = $1`,
    [userId]
  );
  const profile = computeAffectProfile(collectFreeTextSamples(rows));
  if (!profile) {
    await database.query('DELETE FROM player_affect_profiles WHERE user_id = $1', [userId]);
    return null;
  }
  await database.query(
    `INSERT INTO player_affect_profiles
       (user_id, vector, sample_texts, vector_spec_version, computed_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       vector = EXCLUDED.vector,
       sample_texts = EXCLUDED.sample_texts,
       vector_spec_version = EXCLUDED.vector_spec_version,
       computed_at = now()`,
    [userId, profile.vector, profile.sampleTexts, profile.vectorSpecVersion]
  );
  return profile;
}

async function getAffectProfile(userId, database = db) {
  const { rows } = await database.query(
    `SELECT vector, sample_texts, vector_spec_version
     FROM player_affect_profiles WHERE user_id = $1`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    vector: rows[0].vector.map(Number),
    sampleTexts: rows[0].sample_texts,
    vectorSpecVersion: rows[0].vector_spec_version,
  };
}

module.exports = {
  collectFreeTextSamples,
  computeAffectProfile,
  getAffectProfile,
  recomputeAffectProfile,
};
