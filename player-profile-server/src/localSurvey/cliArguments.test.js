'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT_SURVEY_ID, parseLocalSurveyArguments } = require('./cliArguments');

test('parseLocalSurveyArguments parses file and save-only options', () => {
  assert.deepEqual(
    parseLocalSurveyArguments(['--answers', 'answers.json', '--save-only']),
    {
      answersPath: 'answers.json',
      saveOnly: true,
      surveyId: DEFAULT_SURVEY_ID,
      help: false,
    }
  );
});

test('parseLocalSurveyArguments publishes unless --save-only is given', () => {
  assert.equal(parseLocalSurveyArguments([]).saveOnly, false);
  assert.equal(parseLocalSurveyArguments(['--save-only']).saveOnly, true);
});

test('parseLocalSurveyArguments defaults to the core survey', () => {
  assert.equal(parseLocalSurveyArguments([]).surveyId, 'gamer-preferences');
});

test('parseLocalSurveyArguments selects another survey by id', () => {
  assert.equal(
    parseLocalSurveyArguments(['--survey', 'gamer-subtypes']).surveyId,
    'gamer-subtypes'
  );
});

test('parseLocalSurveyArguments rejects a missing survey id', () => {
  assert.throws(
    () => parseLocalSurveyArguments(['--survey', '--save-only']),
    /requires a survey ID/
  );
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
