-- Migration 016: ゲームマスタ (管理者が登録する対象ゲーム) と、アンケート/感想からの参照。
--
-- これまで感想・感情曲線の「ゲーム名」は自由入力で、同じゲームが表記ゆれのまま
-- 別物として溜まっていた。 GLAB の学内制作ゲームは Steam の直近プレイにも出ないため、
-- サジェストからも選べない。 ここでゲームの正本を Volputas に置き、 GLAB は
-- 「表示と投稿の面だけを持つ」 という DESIGN の分担のまま選択式にできるようにする。
--
-- 再実行安全性: 新規テーブルと索引、 surveys の追加列は IF NOT EXISTS で、
-- 運用中の is_active や既存の紐付けを書き換えない。

CREATE TABLE IF NOT EXISTS games (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           VARCHAR(200) NOT NULL,
  team            VARCHAR(200),
  platform        VARCHAR(120),
  description     TEXT,
  store_url       TEXT,
  -- GLAB のプロジェクト (制作チーム) と紐付けたいときだけ入れる。 GLAB 側 ID の
  -- 正本は GLAB なので、 ここでは検証しない不透明な文字列として保持する。
  glab_project_id VARCHAR(200),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- 登録した管理者の Cernere user id。 Volputas ローカル users への FK にはしない
  -- (GLAB 経由の管理者は Volputas にローカルアカウントを持たないことがある)。
  registered_by   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 表記ゆれの再発を防ぐのが目的なので、 一意性は大文字小文字を畳んで判定する。
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_title_unique
  ON games (lower(title));

CREATE INDEX IF NOT EXISTS idx_games_active
  ON games (is_active, created_at DESC);

-- ゲーム別アンケート。 アンケート定義の正本は surveys のままで、 game_id は
-- 「どのゲームについての設問か」 の紐付けだけを持つ。 ゲームを消しても回答済み
-- アンケートを失わないよう ON DELETE SET NULL とする。
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES games(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_surveys_game
  ON surveys (game_id, created_at DESC)
  WHERE game_id IS NOT NULL;
