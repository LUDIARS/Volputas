const {
  DIM,
  buildTargetVector,
  loadAffectVocabulary,
  weightedMean,
} = require('@ludiars/sentiment-core');
const db = require('../config/database');

const VOCABULARY = loadAffectVocabulary();
const VOCABULARY_BY_KEY = new Map(VOCABULARY.map((entry) => [entry.key, entry]));

const AFFECT_INTENTS = {
  accomplishment: { intended_emotions: ['joy'], intended_aspects: ['difficulty'] },
  mastery: { intended_emotions: ['joy', 'anticipation'], intended_aspects: ['difficulty'] },
  tension_release: { intended_emotions: ['fear', 'joy'], intended_aspects: ['difficulty'] },
  immersion: { intended_emotions: ['trust'], intended_aspects: ['story', 'graphics'] },
  discovery: { intended_emotions: ['surprise', 'joy'], intended_aspects: ['content'] },
  flow: { intended_emotions: ['joy'], intended_aspects: ['fun', 'difficulty'] },
  game_feel: { intended_emotions: ['joy'], intended_aspects: ['fun', 'performance'] },
  excitement: { intended_emotions: ['anticipation', 'joy'], intended_aspects: ['fun'] },
  collection: { intended_emotions: ['trust'], intended_aspects: ['content', 'replayability'] },
  expression: { intended_emotions: ['joy'], intended_aspects: ['content'] },
  fellowship: { intended_emotions: ['trust', 'joy'], intended_aspects: ['fun'] },
  narrative: { intended_emotions: ['joy', 'sadness'], intended_aspects: ['story'] },
  wonder: { intended_emotions: ['surprise'], intended_aspects: ['graphics'] },
  strategic: { intended_emotions: ['anticipation', 'joy'], intended_aspects: ['difficulty'] },
  frustration: { intended_emotions: ['anger'], intended_aspects: ['difficulty'] },
  boredom: { intended_emotions: ['sadness'], intended_aspects: ['fun'] },
  monotony: { intended_emotions: ['sadness'], intended_aspects: ['replayability'] },
  confusion: { intended_emotions: ['surprise'], intended_aspects: ['difficulty'] },
  anger: { intended_emotions: ['anger'], intended_aspects: ['fun'] },
  sadness: { intended_emotions: ['sadness'], intended_aspects: ['story'] },
  unfair_monetization: { intended_emotions: ['anger', 'disgust'], intended_aspects: ['price_value'] },
  fear: { intended_emotions: ['fear'], intended_aspects: ['story'] },
  suspense: { intended_emotions: ['fear', 'anticipation'], intended_aspects: ['story'] },
  solitude: { intended_emotions: ['sadness', 'trust'], intended_aspects: ['story'] },
};

function validateBeatScript(beats) {
  if (!Array.isArray(beats) || beats.length === 0) throw new TypeError('beats must be a non-empty array');
  const orders = new Set();
  return beats.map((beat) => {
    if (!beat || typeof beat !== 'object') throw new TypeError('each beat must be an object');
    if (typeof beat.beat !== 'string' || !beat.beat.trim()) throw new TypeError('beat name is required');
    if (!Number.isInteger(beat.order) || beat.order < 1) throw new TypeError('beat order must be a positive integer');
    if (orders.has(beat.order)) throw new TypeError(`duplicate beat order: ${beat.order}`);
    orders.add(beat.order);
    if (!Array.isArray(beat.intended_affect) || beat.intended_affect.length === 0) {
      throw new TypeError(`intended_affect is required for ${beat.beat}`);
    }
    for (const key of beat.intended_affect) {
      if (!VOCABULARY_BY_KEY.has(key)) throw new TypeError(`unknown intended_affect: ${key}`);
    }
    const intensity = Number(beat.intended_intensity);
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
      throw new TypeError(`intended_intensity must be 0..1 for ${beat.beat}`);
    }
    const hint = beat.markers?.t_hint_ms;
    if (hint !== undefined && (
      !Array.isArray(hint)
      || hint.length !== 2
      || !hint.every((value) => Number.isInteger(value) && value >= 0)
      || hint[1] <= hint[0]
    )) {
      throw new TypeError(`markers.t_hint_ms must be [start,end] for ${beat.beat}`);
    }
    return {
      beat: beat.beat.trim(),
      order: beat.order,
      intended_affect: [...beat.intended_affect],
      intended_intensity: intensity,
      markers: beat.markers && typeof beat.markers === 'object' ? { ...beat.markers } : {},
    };
  }).sort((left, right) => left.order - right.order);
}

function beatTargetVector(beat) {
  const intents = beat.intended_affect.map((key) => {
    const entry = VOCABULARY_BY_KEY.get(key);
    return {
      ...AFFECT_INTENTS[key],
      intended_valence: entry.valence === 'ambivalent' ? 'neutral' : entry.valence,
    };
  });
  const target = weightedMean(intents.map((intent) => buildTargetVector([intent])), intents.map(() => 1));
  return target.map((value) => Number((0.5 + (value - 0.5) * beat.intended_intensity).toFixed(4)));
}

function beatScriptToTargetSeries(beats, binMs = 30_000) {
  const validated = validateBeatScript(beats);
  const series = [];
  const unaligned = [];
  for (const beat of validated) {
    const hint = beat.markers.t_hint_ms;
    if (!hint) {
      unaligned.push(beat.beat);
      continue;
    }
    const vector = beatTargetVector(beat);
    if (vector.length !== DIM) throw new Error(`target vector must have ${DIM} dimensions`);
    for (let t = Math.floor(hint[0] / binMs) * binMs; t < hint[1]; t += binMs) {
      series.push({ t, beat: beat.beat, vector });
    }
  }
  return { series, unaligned };
}

async function createBeatScriptVersion(gameId, beats, database = db) {
  const validated = validateBeatScript(beats);
  return database.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`beat-script:${gameId}`]);
    const { rows: versionRows } = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM game_beat_scripts WHERE game_id = $1',
      [gameId]
    );
    const version = Number(versionRows[0].version);
    const { rows } = await client.query(
      `INSERT INTO game_beat_scripts (game_id, version, beats)
       VALUES ($1, $2, $3) RETURNING *`,
      [gameId, version, JSON.stringify(validated)]
    );
    return rows[0];
  });
}

async function getBeatScript(gameId, version, database = db) {
  const params = [gameId];
  const versionClause = version ? 'AND version = $2' : '';
  if (version) params.push(version);
  const { rows } = await database.query(
    `SELECT * FROM game_beat_scripts
     WHERE game_id = $1 ${versionClause}
     ORDER BY version DESC LIMIT 1`,
    params
  );
  return rows[0] || null;
}

module.exports = {
  AFFECT_INTENTS,
  beatScriptToTargetSeries,
  beatTargetVector,
  createBeatScriptVersion,
  getBeatScript,
  validateBeatScript,
};
