'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  SERVER_ROOT,
  loadLocalSurveyConfig,
} = require('./localSurveyConfig');

const VALID_CONFIG = JSON.stringify({
  schemaVersion: 1,
  dataRepository: {
    path: 'private/survey-data',
    remote: 'origin',
    githubRepository: 'LUDIARS/Voluptas-Data',
    expectedRemoteUrl: 'https://github.com/LUDIARS/Voluptas-Data.git',
    baseBranch: 'main',
    responseBranchPrefix: 'responses/github-',
  },
  commands: {
    git: 'git',
    github: 'gh',
  },
});

test('loadLocalSurveyConfig resolves the repository path from the server root', () => {
  const config = loadLocalSurveyConfig({
    env: {},
    readFile: () => VALID_CONFIG,
  });

  assert.equal(
    config.dataRepositoryRoot,
    path.resolve(SERVER_ROOT, 'private/survey-data')
  );
  assert.equal(config.responseBranchPrefix, 'responses/github-');
  assert.equal(config.githubRepository, 'LUDIARS/Voluptas-Data');
  assert.equal(config.githubCommand, 'gh');
});

test('loadLocalSurveyConfig supports an explicit repository directory override', () => {
  const config = loadLocalSurveyConfig({
    env: { VOLUPTAS_SURVEY_DATA_DIR: 'private/alternate-survey-data' },
    readFile: () => VALID_CONFIG,
  });

  assert.equal(
    config.dataRepositoryRoot,
    path.resolve(SERVER_ROOT, 'private/alternate-survey-data')
  );
});

test('loadLocalSurveyConfig fails fast on missing required fields', () => {
  assert.throws(
    () => loadLocalSurveyConfig({
      env: {},
      readFile: () => JSON.stringify({
        schemaVersion: 1,
        dataRepository: {},
        commands: {},
      }),
    }),
    /dataRepository\.path/
  );
});

test('loadLocalSurveyConfig rejects unsupported schema versions', () => {
  for (const schemaVersion of [undefined, '1', 2]) {
    const unsupported = JSON.parse(VALID_CONFIG);
    if (schemaVersion === undefined) {
      delete unsupported.schemaVersion;
    } else {
      unsupported.schemaVersion = schemaVersion;
    }

    assert.throws(
      () => loadLocalSurveyConfig({
        env: {},
        readFile: () => JSON.stringify(unsupported),
      }),
      /requires schemaVersion 1/
    );
  }
});

test('loadLocalSurveyConfig binds the privacy check to the Git remote repository', () => {
  const mismatched = JSON.parse(VALID_CONFIG);
  mismatched.dataRepository.expectedRemoteUrl = (
    'https://github.com/LUDIARS/Public-Survey-Data.git'
  );

  assert.throws(
    () => loadLocalSurveyConfig({
      env: {},
      readFile: () => JSON.stringify(mismatched),
    }),
    /must identify the same repository/
  );
});

test('loadLocalSurveyConfig redacts malformed config content', () => {
  const sensitiveContent = '{"token":"never-log",';

  assert.throws(
    () => loadLocalSurveyConfig({
      env: {},
      readFile: () => sensitiveContent,
    }),
    (error) => {
      assert.equal(error.message, 'Unable to read local survey config');
      assert.doesNotMatch(error.message, /never-log|token/);
      return true;
    }
  );
});
