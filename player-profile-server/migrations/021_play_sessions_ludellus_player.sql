-- Ludellus の子ども (player、例 p_0123456789abcdef) の id をプレイ記録に残す (SPEC-VO-PLAY-STREAM-STORE)。
-- 本人 (user_id) はログインした保護者。どの子が遊んだかはこの列で分ける。中継 (Ludellus Web) が
-- 保護者の子であることを確かめてから渡す。旧い記録は NULL のまま。
ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS ludellus_player_id TEXT;
CREATE INDEX IF NOT EXISTS idx_play_sessions_user_ludellus_player ON play_sessions (user_id, ludellus_player_id);
