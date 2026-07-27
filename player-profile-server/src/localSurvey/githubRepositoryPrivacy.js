'use strict';

const { createProcessRunner } = require('./processRunner');

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PRIVATE_REPOSITORY_QUERY = '{fullName: .full_name, isPrivate: .private}';

class GithubRepositoryPrivacyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GithubRepositoryPrivacyError';
    this.code = 'PRIVATE_DATA_REPOSITORY_UNAVAILABLE';
  }
}

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
      ['api', `repos/${repository}`, '--jq', PRIVATE_REPOSITORY_QUERY],
      { cwd }
    ).stdout;
  } catch {
    throw new GithubRepositoryPrivacyError(
      'Unable to verify the private Voluptas data repository.'
    );
  }

  let metadata;
  try {
    metadata = JSON.parse(output);
  } catch {
    throw new GithubRepositoryPrivacyError(
      'GitHub CLI returned invalid repository privacy metadata.'
    );
  }
  if (
    metadata?.fullName !== repository
    || metadata?.isPrivate !== true
  ) {
    throw new GithubRepositoryPrivacyError(
      'The configured Voluptas data repository is not the expected private repository.'
    );
  }

  return Object.freeze({
    fullName: metadata.fullName,
    isPrivate: true,
  });
}

module.exports = {
  GithubRepositoryPrivacyError,
  assertPrivateGithubRepository,
};
