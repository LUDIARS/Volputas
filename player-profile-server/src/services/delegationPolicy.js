const { DelegationError } = require('./delegationError');
const { PREFERENCE_AXES } = require('./preferenceAxisDefinitions');

const DEFAULT_EXPIRY_HOURS = 24 * 7;
const MAX_EXPIRY_HOURS = 24 * 30;
const DEFAULT_MAX_USES = 10;
const MAX_CLAIMS_PER_REQUEST = 20;

const PLAYSTYLE_TAGS = Object.freeze([
  'gamer_timmy',
  'gamer_johnny',
  'gamer_spike',
  'gamer_vorthos',
  'gamer_melvin',
  'mechanics_agon',
  'mechanics_alea',
  'mechanics_ilinx',
  'mechanics_mimicry',
  'story_winner',
  'story_banal',
  'story_loser',
]);

const PLAYSTYLE_TAG_SET = new Set(PLAYSTYLE_TAGS);
const ALLOWED_PROFILE_FIELDS = Object.freeze([
  'playstyle_tags',
  ...PREFERENCE_AXES.map((axis) => `preference.${axis}`),
]);
const ALLOWED_FIELD_SET = new Set(ALLOWED_PROFILE_FIELDS);

function invalid(message) {
  throw new DelegationError(400, 'INVALID_DELEGATION_INPUT', message);
}

function integerInRange(value, fallback, minimum, maximum, label) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    invalid(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return candidate;
}

function validateAllowedFields(value) {
  if (!Array.isArray(value) || value.length === 0) invalid('allowed_fields must be a non-empty array');
  const fields = [...new Set(value)];
  if (fields.length !== value.length || fields.some((field) => !ALLOWED_FIELD_SET.has(field))) {
    invalid('allowed_fields contains an unsupported or duplicate field');
  }
  return fields;
}

function validateGrantInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('request body must be an object');
  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
  if (!purpose || purpose.length > 200) invalid('purpose must contain 1 to 200 characters');
  return {
    allowedFields: validateAllowedFields(input.allowed_fields),
    purpose,
    expiresInHours: integerInRange(
      input.expires_in_hours,
      DEFAULT_EXPIRY_HOURS,
      1,
      MAX_EXPIRY_HOURS,
      'expires_in_hours'
    ),
    maxUses: integerInRange(input.max_uses, DEFAULT_MAX_USES, 1, 50, 'max_uses'),
  };
}

function validatePlaystyleTags(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > PLAYSTYLE_TAGS.length) {
    invalid('playstyle_tags must be a non-empty controlled-tag array');
  }
  const tags = [...new Set(value)];
  if (tags.length !== value.length || tags.some((tag) => !PLAYSTYLE_TAG_SET.has(tag))) {
    invalid('playstyle_tags contains an unsupported or duplicate tag');
  }
  return tags;
}

function validatePreferenceScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    invalid('preference value must be a finite number between -1 and 1');
  }
  return Number(value.toFixed(4));
}

function validateClaim(field, value) {
  if (!ALLOWED_FIELD_SET.has(field)) invalid(`unsupported profile field: ${String(field)}`);
  if (field === 'playstyle_tags') return { field, value: validatePlaystyleTags(value) };
  return { field, value: validatePreferenceScore(value) };
}

function validateClaims(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CLAIMS_PER_REQUEST) {
    invalid(`claims must contain 1 to ${MAX_CLAIMS_PER_REQUEST} items`);
  }
  const claims = value.map((claim) => {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) invalid('each claim must be an object');
    return validateClaim(claim.field, claim.value);
  });
  const fields = claims.map((claim) => claim.field);
  if (new Set(fields).size !== fields.length) invalid('claims cannot contain duplicate fields');
  return claims;
}

function validateDecision(value) {
  if (value !== 'accept' && value !== 'reject') invalid('decision must be accept or reject');
  return value;
}

module.exports = {
  ALLOWED_PROFILE_FIELDS,
  PLAYSTYLE_TAGS,
  validateClaim,
  validateClaims,
  validateDecision,
  validateGrantInput,
};
