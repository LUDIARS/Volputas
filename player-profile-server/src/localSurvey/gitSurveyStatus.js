'use strict';

const path = require('node:path');
const { GitSurveyPublisherError } = require('./gitSurveyError');

const GENERATED_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const UNMERGED_STATUSES = new Set([
  'DD',
  'AU',
  'UD',
  'UA',
  'DU',
  'AA',
  'UU',
]);

function normalizeAllowedPaths(allowedPaths, githubId) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    throw new TypeError('allowedPaths must contain generated repository paths');
  }

  const responsePrefix = `responses/github-${githubId}/`;
  const normalized = [];
  const seen = new Set();
  for (const candidate of allowedPaths) {
    if (
      typeof candidate !== 'string'
      || candidate.length === 0
      || /[\0\r\n]/.test(candidate)
    ) {
      throw new TypeError('allowedPaths entries must be valid relative paths');
    }

    const portablePath = candidate.replaceAll('\\', '/');
    if (
      path.posix.isAbsolute(portablePath)
      || path.win32.isAbsolute(candidate)
      || path.posix.normalize(portablePath) !== portablePath
    ) {
      throw new TypeError('allowedPaths entries must be normalized relative paths');
    }

    const surveyFile = portablePath.startsWith('surveys/')
      ? portablePath.slice('surveys/'.length)
      : null;
    const responseFile = portablePath.startsWith(responsePrefix)
      ? portablePath.slice(responsePrefix.length)
      : null;
    if (
      (surveyFile === null || !GENERATED_FILE_PATTERN.test(surveyFile))
      && (responseFile === null || !GENERATED_FILE_PATTERN.test(responseFile))
    ) {
      throw new TypeError(
        'allowedPaths entries must be generated survey definition or identity response files'
      );
    }
    if (seen.has(portablePath)) {
      throw new TypeError('allowedPaths must not contain duplicates');
    }
    seen.add(portablePath);
    normalized.push(portablePath);
  }
  return normalized.sort();
}

function readDirtyPaths(runGit) {
  const output = runGit([
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]).stdout;

  try {
    return parsePorcelainPaths(output);
  } catch (error) {
    if (error instanceof GitSurveyPublisherError) {
      throw error;
    }
    throw new GitSurveyPublisherError(
      'GIT_STATUS_INVALID',
      'Git returned an invalid repository status.'
    );
  }
}

function parsePorcelainPaths(output) {
  if (typeof output !== 'string') {
    throw new TypeError('porcelain status must be text');
  }

  const records = output.split('\0');
  const paths = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length === 0) {
      if (index !== records.length - 1) {
        throw new TypeError('porcelain status contains an empty record');
      }
      continue;
    }
    if (record.length < 4 || record[2] !== ' ') {
      throw new TypeError('porcelain status record is malformed');
    }

    const status = record.slice(0, 2);
    if (UNMERGED_STATUSES.has(status)) {
      throw new GitSurveyPublisherError(
        'UNMERGED_PATH',
        'The survey data repository contains an unresolved merge path.'
      );
    }
    paths.add(normalizeReportedGitPath(record.slice(3)));
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      if (index >= records.length || records[index].length === 0) {
        throw new TypeError('porcelain rename record is incomplete');
      }
      paths.add(normalizeReportedGitPath(records[index]));
    }
  }
  return [...paths].sort();
}

function normalizeReportedGitPath(reportedPath) {
  if (
    typeof reportedPath !== 'string'
    || reportedPath.length === 0
    || /[\0\r\n]/.test(reportedPath)
  ) {
    throw new TypeError('Git path is invalid');
  }
  const portablePath = reportedPath.replaceAll('\\', '/');
  if (
    path.posix.isAbsolute(portablePath)
    || path.win32.isAbsolute(reportedPath)
    || path.posix.normalize(portablePath) !== portablePath
  ) {
    throw new TypeError('Git path is not repository-relative');
  }
  return portablePath;
}

function readCommittedPaths(runGit, commitSha) {
  const output = runGit([
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-z',
    commitSha,
  ]).stdout;
  if (typeof output !== 'string') {
    throw new GitSurveyPublisherError(
      'COMMITTED_PATHS_INVALID',
      'Git returned invalid committed path data.'
    );
  }

  try {
    return output
      .split('\0')
      .filter((entry) => entry.length > 0)
      .map(normalizeReportedGitPath)
      .sort();
  } catch {
    throw new GitSurveyPublisherError(
      'COMMITTED_PATHS_INVALID',
      'Git returned invalid committed path data.'
    );
  }
}

function assertOnlyAllowedCommittedPaths(committedPaths, allowedPaths) {
  const allowed = new Set(allowedPaths);
  if (
    committedPaths.length === 0
    || committedPaths.some((committedPath) => !allowed.has(committedPath))
  ) {
    throw new GitSurveyPublisherError(
      'UNEXPECTED_COMMITTED_PATH',
      'The survey commit contains paths outside the generated allowlist.'
    );
  }
}

function assertOnlyAllowedDirtyPaths(dirtyPaths, allowedPaths) {
  const allowed = new Set(allowedPaths);
  if (dirtyPaths.some((dirtyPath) => !allowed.has(dirtyPath))) {
    throw new GitSurveyPublisherError(
      'UNEXPECTED_DIRTY_PATH',
      'The survey data repository contains changes outside the generated paths.'
    );
  }
}

module.exports = {
  assertOnlyAllowedCommittedPaths,
  assertOnlyAllowedDirtyPaths,
  normalizeAllowedPaths,
  readCommittedPaths,
  readDirtyPaths,
};
