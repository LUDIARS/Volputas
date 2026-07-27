'use strict';

const { createProcessRunner } = require('./processRunner');

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REPOSITORY_VISIBILITY_QUERY = (
  '{fullName: .full_name, private: .private, visibility: .visibility}'
);

class GithubRepositoryVisibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GithubRepositoryVisibilityError';
    this.code = 'DATA_REPOSITORY_UNAVAILABLE';
  }
}

// The local OKF survey flow pushes a respondent's own answers to
// `responses/github-<numeric-id>` in the data repository, so that repository must be private.
// Verified before any question is asked: discovering the wrong visibility after the answers
// exist would mean deciding what to do with data that is already on disk.
//
// `private` and `visibility` are both checked because they come from different generations of
// the GitHub API and an internal repository reports `private: true` with
// `visibility: "internal"` — that is not the private repository this flow expects.
function assertPrivateGithubRepository({
  cwd,
  repository,
  githubCommand = 'gh',
  runner = createProcessRunner(),
} = {}) {
  if (typeof repository !== 'string' || !GITHUB_REPOSITORY_PATTERN.test(repository)) {
    throw new TypeError('repository must use the GitHub owner/name form');
  }
  if (!runner || typeof runner.run !== 'function') {
    throw new TypeError('runner must expose a run function');
  }

  let output;
  try {
    output = runner.run(
      githubCommand,
      ['api', `repos/${repository}`, '--jq', REPOSITORY_VISIBILITY_QUERY],
      { cwd }
    ).stdout;
  } catch {
    throw new GithubRepositoryVisibilityError(
      'Unable to verify the private Volputas data repository.'
    );
  }

  let metadata;
  try {
    metadata = JSON.parse(output);
  } catch {
    throw new GithubRepositoryVisibilityError(
      'GitHub CLI returned invalid repository visibility metadata.'
    );
  }
  if (
    metadata?.fullName !== repository
    || metadata?.private !== true
    || metadata?.visibility !== 'private'
  ) {
    throw new GithubRepositoryVisibilityError(
      'The configured Volputas data repository is not the expected private repository.'
    );
  }

  return Object.freeze({
    fullName: metadata.fullName,
    isPrivate: true,
    visibility: 'private',
  });
}

module.exports = {
  GithubRepositoryVisibilityError,
  assertPrivateGithubRepository,
};
