-- Migration 003: retain only the documented allowlist in federated identity profiles.
UPDATE federated_identities
SET raw_profile = jsonb_strip_nulls(jsonb_build_object(
  'sub', raw_profile->'sub',
  'id', raw_profile->'id',
  'name', raw_profile->'name',
  'username', raw_profile->'username',
  'picture', raw_profile->'picture',
  'avatar', raw_profile->'avatar',
  'email', raw_profile->'email',
  'email_verified', raw_profile->'email_verified',
  'locale', raw_profile->'locale'
))
WHERE raw_profile IS NOT NULL;
