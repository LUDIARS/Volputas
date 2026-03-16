-- Migration 001: Initial schema
-- Phase 1: users, federated_identities, refresh_tokens
-- Phase 2: player_profiles, play_sessions, play_events
-- Phase 3: surveys, survey_responses

-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-----------------------------------------------------------
-- Phase 1: Core user & auth tables
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name  VARCHAR(100) NOT NULL,
  avatar_url    TEXT,
  locale        VARCHAR(10) NOT NULL DEFAULT 'ja',
  is_deleted    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS federated_identities (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      VARCHAR(50) NOT NULL,
  provider_sub  VARCHAR(255) NOT NULL,
  email         VARCHAR(255),
  raw_profile   JSONB,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_sub)
);

CREATE INDEX idx_federated_identities_user_id ON federated_identities(user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(128) NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-----------------------------------------------------------
-- Phase 2: Profile & Logging tables
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS player_profiles (
  user_id            UUID       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  playstyle_tags     TEXT[],
  personality_data   JSONB,
  preference_vector  FLOAT8[],
  preference_version INTEGER   NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS play_sessions (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id     VARCHAR(100)  NOT NULL,
  started_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  metadata    JSONB,
  CONSTRAINT check_session_end CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX idx_play_sessions_user_id ON play_sessions(user_id);

CREATE TABLE IF NOT EXISTS play_events (
  id          BIGSERIAL     PRIMARY KEY,
  session_id  UUID          NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  event_type  VARCHAR(100)  NOT NULL,
  event_data  JSONB         NOT NULL,
  occurred_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_play_events_session_id ON play_events(session_id);
CREATE INDEX idx_play_events_type ON play_events(event_type);

-----------------------------------------------------------
-- Phase 3: Survey tables
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS surveys (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       VARCHAR(255)  NOT NULL,
  description TEXT,
  questions   JSONB         NOT NULL,
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id    UUID         NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers      JSONB        NOT NULL,
  submitted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (survey_id, user_id)
);

-----------------------------------------------------------
-- Updated-at trigger function
-----------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_player_profiles_updated_at
  BEFORE UPDATE ON player_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
