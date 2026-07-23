'use strict';

const { GitSurveyPublisherError } = require('./gitSurveyError');

function fetchRemoteRef({
  runGit,
  remoteName,
  branch,
  remoteTrackingRef,
}) {
  runGit([
    'fetch',
    '--no-tags',
    remoteName,
    `refs/heads/${branch}:${remoteTrackingRef}`,
  ]);
}

function remoteBranchExists(runGit, remoteName, branch) {
  const remoteRef = `refs/heads/${branch}`;
  const result = runGit(
    ['ls-remote', '--exit-code', '--heads', remoteName, remoteRef],
    { allowedExitCodes: [0, 2] }
  );
  if (result.status === 2) {
    if (result.stdout.trim().length !== 0) {
      throw new GitSurveyPublisherError(
        'REMOTE_REF_INVALID',
        'Git returned invalid data for an absent survey branch.'
      );
    }
    return false;
  }

  readRemoteCommit(result.stdout, remoteRef);
  return true;
}

function verifyRemoteCommit(runGit, remoteName, branch, expectedCommitSha) {
  const remoteRef = `refs/heads/${branch}`;
  let result;
  try {
    result = runGit([
      'ls-remote',
      '--exit-code',
      '--heads',
      remoteName,
      remoteRef,
    ]);
  } catch {
    throw new GitSurveyPublisherError(
      'REMOTE_VERIFICATION_FAILED',
      'The pushed survey branch could not be verified.'
    );
  }

  const remoteCommitSha = readRemoteCommit(result.stdout, remoteRef);
  if (remoteCommitSha !== expectedCommitSha) {
    throw new GitSurveyPublisherError(
      'REMOTE_COMMIT_MISMATCH',
      'The pushed survey branch does not resolve to the local commit.'
    );
  }
}

function readRemoteCommit(output, expectedRef) {
  const line = readSingleLine(output);
  const match = /^([0-9a-f]{40,64})\t([^\t]+)$/i.exec(line || '');
  if (!match || match[2] !== expectedRef) {
    throw new GitSurveyPublisherError(
      'REMOTE_REF_INVALID',
      'Git returned an invalid remote survey branch reference.'
    );
  }
  return match[1].toLowerCase();
}

function normalizeGitHubHttpsRemoteUrl(remoteUrl) {
  if (
    typeof remoteUrl !== 'string'
    || remoteUrl.length === 0
    || /[\0\r\n]/.test(remoteUrl)
  ) {
    throw new TypeError('remote URL is invalid');
  }

  let parsed;
  try {
    parsed = new URL(remoteUrl.trim());
  } catch {
    throw new TypeError('remote URL is invalid');
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== 'github.com'
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new TypeError('remote URL must be a credential-free GitHub HTTPS URL');
  }

  const segments = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (
    segments.length !== 2
    || segments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment))
  ) {
    throw new TypeError('remote URL must identify one GitHub repository');
  }

  const owner = segments[0].toLowerCase();
  const repository = segments[1].replace(/\.git$/i, '').toLowerCase();
  if (repository.length === 0) {
    throw new TypeError('remote URL repository name is invalid');
  }
  return `https://github.com/${owner}/${repository}.git`;
}

function readSingleLine(output) {
  if (typeof output !== 'string' || output.includes('\0')) {
    return null;
  }
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/);
  return lines.length === 1 ? lines[0] : null;
}

module.exports = {
  fetchRemoteRef,
  normalizeGitHubHttpsRemoteUrl,
  remoteBranchExists,
  verifyRemoteCommit,
};
