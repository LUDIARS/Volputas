-- Migration 008: self-reported reactions attached to a reviewed video position

CREATE TABLE IF NOT EXISTS impression_reactions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  impression_id    UUID NOT NULL REFERENCES play_impressions(id) ON DELETE CASCADE,
  video_offset_ms  BIGINT NOT NULL,
  kind             VARCHAR(20) NOT NULL,
  content          TEXT NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (video_offset_ms >= 0),
  CHECK (kind IN ('comment', 'positive', 'negative')),
  CHECK (char_length(content) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_impression_reactions_timeline
  ON impression_reactions(impression_id, video_offset_ms, created_at);
