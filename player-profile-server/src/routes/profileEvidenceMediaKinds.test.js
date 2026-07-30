const test = require('node:test');
const assert = require('node:assert/strict');
const { mediaKindMatchesRecord } = require('./profileEvidence');

test('screenshots belong to gameplay and annotation records only', () => {
  assert.equal(mediaKindMatchesRecord('screenshots', 'gameplay'), true);
  assert.equal(mediaKindMatchesRecord('screenshots', 'annotations'), true);
  assert.equal(mediaKindMatchesRecord('screenshots', 'emotion-curves'), false);
  assert.equal(mediaKindMatchesRecord('videos', 'annotations'), false);
  assert.equal(mediaKindMatchesRecord('unknown', 'annotations'), false);
});
