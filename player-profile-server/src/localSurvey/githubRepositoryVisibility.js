'use strict';

const { createProcessRunner } = require('./processRunner');

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PUBLIC_REPOSITORY_QUERY = (
  '{fullName: .full_name, visibility: .visibility}'
);

class GithubRepositoryVisibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GithubRepositoryVisibilityError';
    this.code = 'DATA_REPOSITORY_UNAVAILABLE';
  }
}

function assertPublicGithubRepository({
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
      ['api', `repos/${repository}`, '--jq', PUBLIC_REPOSITORY_QUERY],
      { cwd }
    ).stdout;
  } catch {
    throw new GithubRepositoryVisibilityError(
      'Unable to verify the public Volputas data repository.'
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
    || metadata?.visibility !== 'public'
  ) {
    throw new GithubRepositoryVisibilityError(
      'The configured Volputas data repository is not the expected public repository.'
    );
  }

  return Object.freeze({
    fullName: metadata.fullName,
    visibility: 'public',
  });
}

module.exports = {
  GithubRepositoryVisibilityError,
  assertPublicGithubRepository,
};
