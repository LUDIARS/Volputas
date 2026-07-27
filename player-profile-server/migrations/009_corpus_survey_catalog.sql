-- Corpus/GLABへ公開するVoluptasアンケート分類。
-- 設問の正本はVoluptas surveys.questions、本人回答の正本はCernereとする。

ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'game_survey';

ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS visible_to_glab BOOLEAN NOT NULL DEFAULT false;

-- Earlier experimental GLAB migrations used DEFAULT true. Converge every
-- installation to explicit opt-in before exposing the catalog.
ALTER TABLE surveys
  ALTER COLUMN category SET DEFAULT 'game_survey',
  ALTER COLUMN visible_to_glab SET DEFAULT false;

UPDATE surveys
SET category = 'game_survey'
WHERE category IS NULL
   OR category NOT IN ('game_review', 'game_survey', 'peer_question');

UPDATE surveys
SET visible_to_glab = false;

ALTER TABLE surveys
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN visible_to_glab SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'surveys_corpus_category_check_v1'
      AND conrelid = 'surveys'::regclass
  ) THEN
    ALTER TABLE surveys
      ADD CONSTRAINT surveys_corpus_category_check_v1
      CHECK (category IN ('game_review', 'game_survey', 'peer_question'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_surveys_glab_catalog
  ON surveys(visible_to_glab, is_active, category, created_at DESC);

INSERT INTO surveys (
  id,
  title,
  description,
  questions,
  category,
  visible_to_glab,
  is_active
)
VALUES (
  'd2c6aca2-e754-4e4a-9f2b-270c85b989e5',
  'ゲームレビュー投稿',
  'プレイしたゲームを定性評価します。',
  '[
    {"id":"game_title","text":"ゲーム名","type":"freetext","required":true},
    {"id":"platform","text":"プレイ環境","type":"freetext","required":false},
    {"id":"overall_rating","text":"総合評価","type":"scale","required":true,"options":{"min":1,"max":5}},
    {"id":"strengths","text":"良かった点","type":"freetext","required":true},
    {"id":"weaknesses","text":"改善してほしい点","type":"freetext","required":false},
    {"id":"recommendation_score","text":"おすすめ度","type":"scale","required":false,"options":{"min":0,"max":10}},
    {"id":"free_comment","text":"自由記述","type":"freetext","required":false}
  ]'::jsonb,
  'game_review',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  questions = EXCLUDED.questions,
  category = EXCLUDED.category,
  visible_to_glab = EXCLUDED.visible_to_glab,
  is_active = EXCLUDED.is_active;
