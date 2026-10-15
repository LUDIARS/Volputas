-- AI プレイテスト感想 (Ingenium ai-playtest-review/1)。人の書き手を持たない匿名の AI 由来の声。
-- 人の感想 (play_impressions / Cernere voices) とは別の表に置き、user_id 列を持たない。
CREATE TABLE IF NOT EXISTS ai_playtest_reviews (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source = 'ai-autoplayer'),
  game_id TEXT NOT NULL,
  game_title TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  persona TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  adapter TEXT NOT NULL,
  screen TEXT NOT NULL CHECK (screen IN ('image', 'text')),
  ticks INTEGER NOT NULL CHECK (ticks >= 0),
  turns INTEGER NOT NULL CHECK (turns >= 0),
  outcome TEXT NOT NULL,
  summary TEXT NOT NULL,
  good JSONB NOT NULL,
  bad JSONB NOT NULL,
  confusions JSONB NOT NULL,
  reflection JSONB NOT NULL,
  played_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_playtest_reviews_recent ON ai_playtest_reviews (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_playtest_reviews_game ON ai_playtest_reviews (game_id, created_at DESC);
