const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateVoiceInput } = require('./profileEvidenceSchemas');

const base = { gameTitle: 'Elden Ring', comment: 'good', polarity: 'like' };

test('recommend defaults to null and accepts booleans', () => {
  assert.equal(validateVoiceInput({ ...base }).recommend, null);
  assert.equal(validateVoiceInput({ ...base, recommend: true }).recommend, true);
  assert.equal(validateVoiceInput({ ...base, recommend: false }).recommend, false);
});

test('recommend rejects non-boolean', () => {
  assert.throws(() => validateVoiceInput({ ...base, recommend: 'yes' }),
    (error) => error.code === 'INVALID_PROFILE_INPUT');
});

test('glabProjectId defaults to null, trims, and caps length', () => {
  assert.equal(validateVoiceInput({ ...base }).glabProjectId, null);
  assert.equal(validateVoiceInput({ ...base, glabProjectId: ' p-1 ' }).glabProjectId, 'p-1');
  assert.throws(() => validateVoiceInput({ ...base, glabProjectId: 'x'.repeat(101) }),
    (error) => error.code === 'INVALID_PROFILE_INPUT');
});

test('visibility defaults to private and only allows private/community', () => {
  assert.equal(validateVoiceInput({ ...base }).visibility, 'private');
  assert.equal(validateVoiceInput({ ...base, visibility: 'community' }).visibility, 'community');
  assert.throws(() => validateVoiceInput({ ...base, visibility: 'public' }),
    (error) => error.code === 'INVALID_PROFILE_INPUT');
});

test('anonymous defaults to false and rejects non-boolean', () => {
  assert.equal(validateVoiceInput({ ...base }).anonymous, false);
  assert.equal(validateVoiceInput({ ...base, anonymous: true }).anonymous, true);
  assert.throws(() => validateVoiceInput({ ...base, anonymous: 1 }),
    (error) => error.code === 'INVALID_PROFILE_INPUT');
});
