-- Migration 005: viewer-reaction timelines and versioned game beat scripts.
CREATE TABLE IF NOT EXISTS affect_timelines (
  id                  BIGSERIAL    PRIMARY KEY,
  game_id             VARCHAR(100) NOT NULL,
  source_kind         VARCHAR(30)  NOT NULL CHECK (source_kind IN ('video_comments', 'play_session')),
  source_ref          VARCHAR(200) NOT NULL,
  bin_ms              INTEGER      NOT NULL CHECK (bin_ms > 0),
  series              JSONB        NOT NULL,
  analysis_meta       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  vector_spec_version INTEGER      NOT NULL DEFAULT 1,
  algo_version        INTEGER      NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_ref, bin_ms, algo_version)
);

CREATE INDEX IF NOT EXISTS idx_affect_timelines_game_id
  ON affect_timelines(game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_beat_scripts (
  game_id    VARCHAR(100) NOT NULL,
  version    INTEGER      NOT NULL CHECK (version > 0),
  beats      JSONB        NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, version)
);
