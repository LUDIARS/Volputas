-- Persona v2 research export is explicit opt-in. Existing and new accounts
-- remain excluded until the account owner enables the setting.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS research_export_consent BOOLEAN NOT NULL DEFAULT false;
