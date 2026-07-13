const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED_PROFILE_FIELDS,
  validateClaim,
  validateClaims,
  validateDecision,
  validateGrantInput,
} = require('./delegationPolicy');

test('delegation grants accept only explicit field scopes and bounded lifetime', () => {
  const result = validateGrantInput({
    allowed_fields: ['playstyle_tags', 'preference.style.explorer'],
    purpose: '共同でプレイ嗜好を確認する',
    expires_in_hours: 24,
    max_uses: 3,
  });
  assert.deepEqual(result.allowedFields, ['playstyle_tags', 'preference.style.explorer']);
  assert.equal(result.expiresInHours, 24);
  assert.equal(result.maxUses, 3);
  assert.throws(
    () => validateGrantInput({ allowed_fields: ['personality_data'], purpose: 'unsafe' }),
    /unsupported/
  );
  assert.throws(
    () => validateGrantInput({ allowed_fields: ['playstyle_tags'], purpose: 'x', expires_in_hours: 721 }),
    /between 1 and 720/
  );
  assert.ok(ALLOWED_PROFILE_FIELDS.every((field) => field === 'playstyle_tags' || field.startsWith('preference.')));
});

test('delegate claims reject free text, sensitive fields, and uncontrolled tags', () => {
  assert.deepEqual(validateClaim('playstyle_tags', ['gamer_johnny', 'mechanics_mimicry']), {
    field: 'playstyle_tags',
    value: ['gamer_johnny', 'mechanics_mimicry'],
  });
  assert.deepEqual(validateClaim('preference.style.explorer', 0.75), {
    field: 'preference.style.explorer',
    value: 0.75,
  });
  assert.throws(() => validateClaim('medical_history', 'diagnosis'), /unsupported/);
  assert.throws(() => validateClaim('personality_data', { note: 'free text' }), /unsupported/);
  assert.throws(() => validateClaim('playstyle_tags', ['攻撃的な人物']), /unsupported/);
  assert.throws(() => validateClaim('preference.style.explorer', 2), /between -1 and 1/);
  assert.throws(
    () => validateClaims([
      { field: 'preference.style.explorer', value: 0.5 },
      { field: 'preference.style.explorer', value: 0.2 },
    ]),
    /duplicate/
  );
  assert.equal(validateDecision('accept'), 'accept');
  assert.throws(() => validateDecision('approve-all'), /accept or reject/);
});
