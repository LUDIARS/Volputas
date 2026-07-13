-- Migration 006: subject-controlled, time-bound delegated profile proposals.
CREATE TABLE IF NOT EXISTS profile_delegation_grants (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_user_id  UUID        REFERENCES users(id) ON DELETE CASCADE,
  invite_token_hash CHAR(64)    UNIQUE,
  allowed_fields    TEXT[]      NOT NULL CHECK (cardinality(allowed_fields) > 0),
  purpose           VARCHAR(200) NOT NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  max_uses          INTEGER     NOT NULL CHECK (max_uses BETWEEN 1 AND 50),
  uses              INTEGER     NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  expires_at        TIMESTAMPTZ NOT NULL,
  invited_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at       TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  CHECK (subject_user_id IS DISTINCT FROM delegate_user_id),
  CHECK (
    (status = 'pending' AND delegate_user_id IS NULL AND invite_token_hash IS NOT NULL)
    OR (status = 'active' AND delegate_user_id IS NOT NULL AND invite_token_hash IS NULL)
    OR (status IN ('revoked', 'expired') AND invite_token_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_profile_delegations_subject
  ON profile_delegation_grants(subject_user_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_delegations_delegate
  ON profile_delegation_grants(delegate_user_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS profile_claims (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  grant_id          UUID        NOT NULL REFERENCES profile_delegation_grants(id) ON DELETE CASCADE,
  subject_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  field             VARCHAR(96) NOT NULL,
  proposed_value    JSONB       NOT NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'cancelled')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  decided_by        UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_claims_subject
  ON profile_claims(subject_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_claims_grant
  ON profile_claims(grant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_claims_retention
  ON profile_claims(status, decided_at)
  WHERE status IN ('rejected', 'withdrawn', 'expired', 'cancelled');

CREATE TABLE IF NOT EXISTS delegation_audit_events (
  id                BIGSERIAL   PRIMARY KEY,
  grant_id          UUID        NOT NULL REFERENCES profile_delegation_grants(id) ON DELETE CASCADE,
  claim_id          UUID        REFERENCES profile_claims(id) ON DELETE SET NULL,
  subject_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  action            VARCHAR(48) NOT NULL,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delegation_audit_grant
  ON delegation_audit_events(grant_id, created_at DESC);
