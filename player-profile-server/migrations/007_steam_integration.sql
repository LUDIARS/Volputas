-- Migration 007: Steam ID linking + owned games snapshot
--
-- Steam login is not supported (Steam auth uses OpenID 2.0, not the OAuth2 flow the other
-- providers use). This is ID-linking only: a user attaches their public SteamID64, and we
-- snapshot their owned-games + playtime from the Steam Web API. Kept separate from
-- play_sessions/play_events since Steam only exposes aggregate playtime per app, not
-- discrete sessions/events — forcing it into those tables would fabricate fake sessions.

CREATE TABLE IF NOT EXISTS steam_profiles (
  user_id           UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  steam_id64        VARCHAR(20)  NOT NULL UNIQUE,
  persona_name      VARCHAR(255),
  avatar_url        TEXT,
  profile_url       TEXT,
  visibility_state  INTEGER,
  linked_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_synced_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS steam_owned_games (
  user_id                     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id                      INTEGER      NOT NULL,
  name                        VARCHAR(255) NOT NULL,
  playtime_forever_minutes    INTEGER      NOT NULL DEFAULT 0,
  playtime_2weeks_minutes     INTEGER      NOT NULL DEFAULT 0,
  img_icon_url                TEXT,
  synced_at                   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id)
);

CREATE INDEX idx_steam_owned_games_user_playtime
  ON steam_owned_games (user_id, playtime_forever_minutes DESC);
