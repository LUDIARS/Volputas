-- The review itself is the durable delivery queue, including reviews saved before this migration.
ALTER TABLE ai_playtest_reviews
  ADD COLUMN IF NOT EXISTS discutere_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discutere_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discutere_delivery_error TEXT;

CREATE INDEX IF NOT EXISTS ai_playtest_reviews_pending_delivery
  ON ai_playtest_reviews (discutere_attempted_at NULLS FIRST, created_at, id)
  WHERE discutere_delivered_at IS NULL;
