-- Migration 004: derived affect profile and independent 15-axis questionnaire scores.
CREATE TABLE IF NOT EXISTS player_affect_profiles (
  user_id             UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vector              FLOAT8[]    NOT NULL CHECK (array_length(vector, 1) = 20),
  sample_texts        INTEGER     NOT NULL CHECK (sample_texts > 0),
  vector_spec_version INTEGER     NOT NULL DEFAULT 1,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_preference_axes (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  axis       VARCHAR(64) NOT NULL,
  score      FLOAT8      NOT NULL CHECK (score >= -1 AND score <= 1),
  samples    INTEGER     NOT NULL CHECK (samples > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, axis)
);
