'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GitSurveyPublisherError } = require('./gitSurveyError');
const { normalizeGitHubHttpsRemoteUrl } = require('./gitSurveyRemote');

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

function verifyRepository(runGit, configuration) {
  let topLevel;
  try {
    topLevel = readSingleLine(
      runGit(['rev-parse', '--show-toplevel']).stdout
    );
  } catch {
    throw new GitSurveyPublisherError(
      'REPOSITORY_UNAVAILABLE',
      'The configured survey data directory is not a Git repository.'
    );
  }
  if (
    !topLevel
    || normalizeComparablePath(topLevel)
      !== normalizeComparablePath(configuration.dataRepositoryRoot)
    || !isCanonicalTopLevel(topLevel, configuration.dataRepositoryRoot)
  ) {
    throw new GitSurveyPublisherError(
      'REPOSITORY_TOP_LEVEL_MISMATCH',
      'The configured survey data directory is not the repository top level.'
    );
  }

  assertNoGitOperationInProgress(runGit, configuration.dataRepositoryRoot);
  verifyRemoteUrl(runGit, configuration, { isPush: false });
  verifyRemoteUrl(runGit, configuration, { isPush: true });
}

function readCommitSha(runGit) {
  const commitSha = readSingleLine(runGit(['rev-parse', 'HEAD']).stdout);
  if (!commitSha || !COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new GitSurveyPublisherError(
      'COMMIT_SHA_INVALID',
      'Git returned an invalid commit identifier.'
    );
  }
  return commitSha.toLowerCase();
}

function verifyRemoteUrl(runGit, configuration, { isPush }) {
  const argumentsList = ['remote', 'get-url'];
  if (isPush) {
    argumentsList.push('--push');
  }
  argumentsList.push('--all', configuration.remoteName);

  let actualRemote;
  try {
    const remoteValue = readSingleLine(runGit(argumentsList).stdout);
    actualRemote = normalizeGitHubHttpsRemoteUrl(remoteValue);
  } catch {
    throw new GitSurveyPublisherError(
      isPush ? 'PUSH_REMOTE_URL_INVALID' : 'REMOTE_URL_INVALID',
      isPush
        ? 'The survey data push URL is missing or invalid.'
        : 'The survey data remote URL is missing or invalid.'
    );
  }
  if (actualRemote !== configuration.expectedRemoteUrl) {
    throw new GitSurveyPublisherError(
      isPush ? 'PUSH_REMOTE_URL_MISMATCH' : 'REMOTE_URL_MISMATCH',
      isPush
        ? 'The survey data push URL does not match the configured private repository.'
        : 'The survey data remote does not match the configured private repository.'
    );
  }
}

function assertNoGitOperationInProgress(runGit, repositoryRoot) {
  const gitDirectoryValue = readSingleLine(
    runGit(['rev-parse', '--git-dir']).stdout
  );
  if (!gitDirectoryValue) {
    throw new GitSurveyPublisherError(
      'GIT_DIRECTORY_INVALID',
      'Git returned an invalid repository metadata directory.'
    );
  }
  const gitDirectory = path.resolve(repositoryRoot, gitDirectoryValue);
  const operationMarkers = [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'REBASE_HEAD',
    'rebase-apply',
    'rebase-merge',
    'BISECT_LOG',
  ];
  if (operationMarkers.some((marker) => fs.existsSync(path.join(gitDirectory, marker)))) {
    throw new GitSurveyPublisherError(
      'GIT_OPERATION_IN_PROGRESS',
      'A merge, rebase, cherry-pick, revert, or bisect is in progress.'
    );
  }
}

function isCanonicalTopLevel(topLevel, configuredRoot) {
  try {
    const resolvedTopLevel = path.resolve(topLevel);
    const resolvedRoot = path.resolve(configuredRoot);
    const realTopLevel = fs.realpathSync.native(resolvedTopLevel);
    const realRoot = fs.realpathSync.native(resolvedRoot);
    return (
      normalizeComparablePath(realTopLevel) === normalizeComparablePath(realRoot)
      && normalizeComparablePath(realRoot) === normalizeComparablePath(resolvedRoot)
    );
  } catch {
    return false;
  }
}

function readSingleLine(output) {
  if (typeof output !== 'string' || output.includes('\0')) {
    return null;
  }
  const trimmed = output.trim();
  if (trimmed.length === 0 || /[\r\n]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeComparablePath(candidate) {
  const normalized = path.resolve(candidate);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

module.exports = {
  readCommitSha,
  verifyRepository,
};
