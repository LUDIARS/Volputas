'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseLocalSurveyArguments } = require('./cliArguments');

test('parseLocalSurveyArguments parses file and save-only options', () => {
  assert.deepEqual(
    parseLocalSurveyArguments(['--answers', 'answers.json', '--save-only']),
    {
      answersPath: 'answers.json',
      saveOnly: true,
      help: false,
    }
  );
});

test('parseLocalSurveyArguments defaults to local-only storage', () => {
  assert.equal(parseLocalSurveyArguments([]).saveOnly, true);
});

test('parseLocalSurveyArguments rejects a missing answers path', () => {
  assert.throws(
    () => parseLocalSurveyArguments(['--answers', '--save-only']),
    /requires a path/
  );
});

test('parseLocalSurveyArguments rejects unknown options', () => {
  assert.throws(
    () => parseLocalSurveyArguments(['--publish-all']),
    /Unknown/
  );
});
