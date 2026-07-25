-- Corpus/GLABへ公開するVoluptasアンケート分類。
-- 設問の正本はVoluptas surveys.questions、本人回答の正本はCernereとする。
--
-- 再実行安全性 (idempotency):
--   通常は migrations/run.js の _migrations 台帳により一度しか実行されない。
--   ただし psql 等での手動再実行を想定し、本ファイルは
--   「運用中の公開状態 (visible_to_glab / is_active) を書き換えない」ことを保証する。
--   初回適用でのみ意味を持つ収束処理 —— レガシー DEFAULT true 環境の一括 opt-out と、
--   カノニカル seed の初期公開 —— は _migrations 台帳を参照して初回適用時に限定する。
--   台帳適用済みの環境へ再適用しても、スキーマ (列・既定値・制約・索引) は冪等に収束し、
--   公開フラグは現行の運用値のまま維持される。

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

-- NULL埋めは再実行しても運用値を壊さない (SET NOT NULL の前提を満たすだけ)。
UPDATE surveys
SET visible_to_glab = false
WHERE visible_to_glab IS NULL;

-- レガシー DEFAULT true 環境からの一括 opt-out は初回適用時のみ実行する。
-- 再実行でここが走ると、運用中に公開済みの survey が一括で非公開へ巻き戻るため、
-- _migrations 台帳に本ファイルの適用記録がある場合は何もしない。
DO $$
DECLARE
  already_applied boolean := false;
BEGIN
  IF to_regclass('_migrations') IS NOT NULL THEN
    -- 台帳が無い環境 (初回 psql 適用) でも解析エラーにならないよう動的SQLで参照する。
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM _migrations WHERE name = $1)'
      INTO already_applied
      USING '009_corpus_survey_catalog.sql';
  END IF;

  IF already_applied THEN
    RAISE NOTICE '009_corpus_survey_catalog.sql: already applied; preserving live visible_to_glab state';
    RETURN;
  END IF;

  UPDATE surveys SET visible_to_glab = false;
END
$$;

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

-- カノニカルな設問定義は収束させるが、公開フラグ (visible_to_glab / is_active) は
-- ON CONFLICT の更新対象から意図的に外し、運用中に設定された値を保持する。
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
  category = EXCLUDED.category;

-- 初回適用時のみ、カノニカル seed を公開状態へ引き上げる。
-- (レガシー環境では上の一括 opt-out で false に落ちているため、ここで確定させる。)
-- 再実行時は台帳の記録により何もしないので、運用側で非公開へ倒した seed は非公開のまま。
DO $$
DECLARE
  already_applied boolean := false;
BEGIN
  IF to_regclass('_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM _migrations WHERE name = $1)'
      INTO already_applied
      USING '009_corpus_survey_catalog.sql';
  END IF;

  IF already_applied THEN
    RAISE NOTICE '009_corpus_survey_catalog.sql: already applied; preserving live seed publication state';
    RETURN;
  END IF;

  UPDATE surveys
  SET visible_to_glab = true,
      is_active = true
  WHERE id = 'd2c6aca2-e754-4e4a-9f2b-270c85b989e5';
END
$$;
