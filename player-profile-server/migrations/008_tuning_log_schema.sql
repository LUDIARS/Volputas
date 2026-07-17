-- Migration 008: Ludellus tuning-log schema.
-- Content master, per-player ability snapshots and per-player tuning params
-- that back reaction-speed / language-comprehension estimation and the
-- GET /api/v1/games/:gameId/tuning/me endpoint.
-- See ludellus-tuning-log-design.md §7, §8, §9.

-- §7.1 Question-content master. Composite PK (id, version) keeps historical
-- revisions addressable so past trial logs stay interpretable after edits.
CREATE TABLE IF NOT EXISTS content_items (
  id         VARCHAR(100) NOT NULL,
  version    INTEGER      NOT NULL CHECK (version > 0),
  game_id    VARCHAR(100) NOT NULL,
  task_type  VARCHAR(50)  NOT NULL,
  lang       VARCHAR(10)  NOT NULL,
  attributes JSONB        NOT NULL DEFAULT '{}'::jsonb,
  stats      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

CREATE INDEX IF NOT EXISTS idx_content_items_game_active
  ON content_items(game_id, is_active);

-- §8.1 Derived ability estimates. All values are recomputable from raw
-- play_events, so this table is a re-buildable summary, not a source of truth.
CREATE TABLE IF NOT EXISTS player_ability_snapshots (
  id            BIGSERIAL    PRIMARY KEY,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id       VARCHAR(100) NOT NULL,
  device_class  VARCHAR(20),
  metrics       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  sample_trials INTEGER      NOT NULL DEFAULT 0 CHECK (sample_trials >= 0),
  window_start  TIMESTAMPTZ,
  window_end    TIMESTAMPTZ,
  algo_version  INTEGER      NOT NULL DEFAULT 1,
  computed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT check_snapshot_window CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start)
);

CREATE INDEX IF NOT EXISTS idx_ability_snapshots_user_game
  ON player_ability_snapshots(user_id, game_id, computed_at DESC);

-- §9.1 Per-player tuning parameters. Composite PK (user_id, game_id); the
-- client reads this at session start and stamps tuning_version onto events.
CREATE TABLE IF NOT EXISTS player_tuning_params (
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id           VARCHAR(100) NOT NULL,
  tuning_version    INTEGER      NOT NULL DEFAULT 1 CHECK (tuning_version > 0),
  params            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  based_on_snapshot BIGINT       REFERENCES player_ability_snapshots(id) ON DELETE SET NULL,
  computed_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);
