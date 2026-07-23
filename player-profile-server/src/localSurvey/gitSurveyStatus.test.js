'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GitSurveyPublisherError } = require('./gitSurveyError');
const {
  assertOnlyAllowedCommittedPaths,
  readDirtyPaths,
} = require('./gitSurveyStatus');

for (const unmergedStatus of ['UU', 'AA', 'DD']) {
  test(`dirty-path reader rejects ${unmergedStatus} merge state`, () => {
    const runner = {
      run() {
        return {
          status: 0,
          stdout: (
            `${unmergedStatus} `
            + 'responses/github-42/gamer-preferences.md\0'
          ),
          stderr: '',
        };
      },
    };

    assert.throws(
      () => readDirtyPaths((args, options) => runner.run('git', args, options)),
      (error) => (
        error instanceof GitSurveyPublisherError
        && error.code === 'UNMERGED_PATH'
      )
    );
  });
}

test('committed-path guard rejects hook-added paths outside the allowlist', () => {
  assert.throws(
    () => assertOnlyAllowedCommittedPaths(
      [
        'responses/github-42/gamer-preferences.md',
        'unrelated-private-file.md',
      ],
      ['responses/github-42/gamer-preferences.md']
    ),
    (error) => (
      error instanceof GitSurveyPublisherError
      && error.code === 'UNEXPECTED_COMMITTED_PATH'
    )
  );
});
