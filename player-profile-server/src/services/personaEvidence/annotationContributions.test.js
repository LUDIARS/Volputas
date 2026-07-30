const test = require('node:test');
const assert = require('node:assert/strict');
const { annotationContributions } = require('./annotationContributions');
const { MOMENT_TYPE_AXIS_MAP } = require('./axisMappings');
const { PREFERENCE_AXES } = require('../preferenceAxisDefinitions');
const { validateAnnotationInput } = require('../profileEvidenceSchemas');

test('annotation moment mappings stay inside the canonical axis vocabulary', () => {
  const canonicalAxes = new Set(PREFERENCE_AXES);
  assert.deepEqual(Object.keys(MOMENT_TYPE_AXIS_MAP).sort(), [
    'achievement',
    'aesthetic',
    'discovery',
    'social',
    'story',
  ]);
  for (const targets of Object.values(MOMENT_TYPE_AXIS_MAP)) {
    assert.equal(
      Number(targets.reduce((sum, [, share]) => sum + share, 0).toFixed(4)),
      1
    );
    for (const [axis] of targets) assert.ok(canonicalAxes.has(axis));
  }
});

test('annotation validation requires image name, moment type, and caption', () => {
  assert.deepEqual(validateAnnotationInput({
    screenshotFileName: 'moment.png',
    momentType: 'discovery',
    caption: 'A hidden path opened behind the waterfall.',
  }), {
    screenshotFileName: 'moment.png',
    momentType: 'discovery',
    caption: 'A hidden path opened behind the waterfall.',
  });
  assert.throws(() => validateAnnotationInput({
    screenshotFileName: '',
    momentType: 'discovery',
    caption: 'caption',
  }));
  assert.throws(() => validateAnnotationInput({
    screenshotFileName: 'moment.png',
    momentType: 'combat',
    caption: 'caption',
  }));
  assert.throws(() => validateAnnotationInput({
    screenshotFileName: 'moment.png',
    momentType: 'story',
    caption: '',
  }));
});

test('aesthetic annotations split axis evidence and add a caption affect sample', () => {
  const result = annotationContributions([{
    id: 'annotation-1',
    momentType: 'aesthetic',
    caption: 'The quiet sunset made the ruined city feel beautiful.',
  }]);
  assert.deepEqual(result.contributions, [
    {
      axis: 'style.narrative',
      value: 1,
      weight: 0.5,
      source: { kind: 'annotation', id: 'annotation-1', field: 'momentType' },
    },
    {
      axis: 'style.explorer',
      value: 1,
      weight: 0.5,
      source: { kind: 'annotation', id: 'annotation-1', field: 'momentType' },
    },
  ]);
  assert.deepEqual(result.affectSamples, [{
    text: 'The quiet sunset made the ruined city feel beautiful.',
    weight: 1,
  }]);
});
