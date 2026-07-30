-- T16: discussion return is opt-in and requires an identity proven by OIDC.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS discussion_import_consent BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE federated_identities
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
