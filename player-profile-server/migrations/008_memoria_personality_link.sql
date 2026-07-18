-- Migration 008: Memoria personality-trend linking
--
-- User-provided link to their own Memoria instance's opt-in personality-export endpoint
-- (Memoria: server/routes/personality-export.ts). Mirrors the Steam ID-linking pattern
-- (migration 007) — a self-service token entered by the user, not a Cernere-mediated flow
-- (Cernere has no service-to-service consent mechanism yet, see
-- spec/setup/cernere-integration-blocked.md).
--
-- Derived axes are never applied directly to player_profiles — they land in
-- personality_drafts and only move to player_profiles.personality_data once the user
-- explicitly approves, mirroring the profile_claims accept-flow
-- (spec/feature/delegated-profile-claims.md).

CREATE TABLE IF NOT EXISTS memoria_links (
  user_id           UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  memoria_base_url  TEXT          NOT NULL,
  token_ciphertext  TEXT          NOT NULL,
  linked_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_synced_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS personality_drafts (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  axes          JSONB         NOT NULL,
  source        VARCHAR(50)   NOT NULL DEFAULT 'memoria',
  computed_at   TIMESTAMPTZ   NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);

CREATE INDEX idx_personality_drafts_user_status ON personality_drafts(user_id, status);
