-- Migration 007: Spectator sessions, impressions, assets, and processing jobs

ALTER TABLE play_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS elapsed_ms BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_ms BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'play_sessions_id_user_id_key'
  ) THEN
    ALTER TABLE play_sessions ADD CONSTRAINT play_sessions_id_user_id_key UNIQUE (id, user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'play_sessions_playtime_check'
  ) THEN
    ALTER TABLE play_sessions ADD CONSTRAINT play_sessions_playtime_check
      CHECK (elapsed_ms >= 0 AND active_ms >= 0 AND active_ms <= elapsed_ms);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS play_impressions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id            UUID NOT NULL,
  client_submission_id  VARCHAR(64) NOT NULL,
  request_hash          CHAR(64) NOT NULL,
  capture_anchor_id     VARCHAR(64) NOT NULL,
  body                  TEXT NOT NULL,
  captured_at           TIMESTAMPTZ NOT NULL,
  elapsed_ms            BIGINT NOT NULL,
  active_ms             BIGINT NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'draft',
  client_metadata       JSONB NOT NULL DEFAULT '{}',
  rejection_reason      TEXT,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_submission_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES play_sessions(id, user_id) ON DELETE CASCADE,
  CHECK (char_length(body) <= 2000),
  CHECK (elapsed_ms >= 0 AND active_ms >= 0 AND active_ms <= elapsed_ms),
  CHECK (status IN ('draft', 'uploading', 'processing', 'ready', 'rejected', 'deletion_pending', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_play_impressions_user_status
  ON play_impressions(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_play_impressions_session
  ON play_impressions(session_id, captured_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS impression_assets (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  impression_id    UUID NOT NULL REFERENCES play_impressions(id) ON DELETE CASCADE,
  client_asset_id  VARCHAR(64) NOT NULL,
  kind             VARCHAR(20) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'reserved',
  object_key       TEXT NOT NULL UNIQUE,
  mime_type        VARCHAR(100) NOT NULL,
  size_bytes       BIGINT NOT NULL,
  sha256           CHAR(64) NOT NULL,
  width            INTEGER,
  height           INTEGER,
  duration_ms      INTEGER,
  captured_at      TIMESTAMPTZ,
  clip_started_at  TIMESTAMPTZ,
  clip_ended_at    TIMESTAMPTZ,
  metadata         JSONB NOT NULL DEFAULT '{}',
  delivery_object_key TEXT,
  thumbnail_object_key TEXT,
  delivery_mime_type VARCHAR(100),
  delivery_size_bytes BIGINT,
  original_delete_after TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (impression_id, client_asset_id),
  CHECK (kind IN ('screenshot', 'video')),
  CHECK (status IN ('reserved', 'uploaded', 'processing', 'ready', 'rejected', 'deletion_pending', 'deleted')),
  CHECK (size_bytes >= 0),
  CHECK (delivery_size_bytes IS NULL OR delivery_size_bytes >= 0),
  CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_impression_assets_impression
  ON impression_assets(impression_id);
CREATE INDEX IF NOT EXISTS idx_impression_assets_status
  ON impression_assets(status);

CREATE TABLE IF NOT EXISTS impression_processing_jobs (
  impression_id   UUID PRIMARY KEY REFERENCES play_impressions(id) ON DELETE CASCADE,
  state           VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  locked_by       VARCHAR(100),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state IN ('pending', 'processing', 'complete', 'failed')),
  CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_impression_processing_jobs_due
  ON impression_processing_jobs(next_attempt_at) WHERE state IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS impression_deletion_audit (
  id             BIGSERIAL PRIMARY KEY,
  impression_id  UUID NOT NULL,
  user_id        UUID NOT NULL,
  object_count   INTEGER NOT NULL,
  outcome        VARCHAR(20) NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (outcome IN ('deleted', 'failed'))
);

DROP TRIGGER IF EXISTS trg_play_impressions_updated_at ON play_impressions;
CREATE TRIGGER trg_play_impressions_updated_at
  BEFORE UPDATE ON play_impressions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_impression_assets_updated_at ON impression_assets;
CREATE TRIGGER trg_impression_assets_updated_at
  BEFORE UPDATE ON impression_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_impression_processing_jobs_updated_at ON impression_processing_jobs;
CREATE TRIGGER trg_impression_processing_jobs_updated_at
  BEFORE UPDATE ON impression_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
