'use strict';

const path = require('node:path');
const { normalizeGitHubHttpsRemoteUrl } = require('./gitSurveyRemote');

const EXPECTED_REMOTE_URL = 'https://github.com/LUDIARS/VolputasData.git';
const DEFAULT_REMOTE_NAME = 'origin';
const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_BRANCH_PREFIX = 'responses/github-';
const COMMIT_MESSAGE = 'Update local survey response';

function normalizePublisherConfiguration({
  dataRepositoryRoot,
  expectedRemoteUrl = EXPECTED_REMOTE_URL,
  remoteName = DEFAULT_REMOTE_NAME,
  baseBranch = DEFAULT_BASE_BRANCH,
  branchPrefix = DEFAULT_BRANCH_PREFIX,
  gitCommand = 'git',
  allowRemotePublish = false,
} = {}) {
  if (
    typeof dataRepositoryRoot !== 'string'
    || dataRepositoryRoot.length === 0
    || !path.isAbsolute(dataRepositoryRoot)
  ) {
    throw new TypeError('dataRepositoryRoot must be an absolute path');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remoteName)) {
    throw new TypeError('remoteName is invalid');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(baseBranch)) {
    throw new TypeError('baseBranch is invalid');
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*-$/.test(branchPrefix)
    || branchPrefix.includes('..')
    || branchPrefix.includes('//')
  ) {
    throw new TypeError('branchPrefix is invalid');
  }
  if (
    typeof gitCommand !== 'string'
    || gitCommand.length === 0
    || /[\0\r\n]/.test(gitCommand)
  ) {
    throw new TypeError('gitCommand must be a non-empty executable');
  }
  if (typeof allowRemotePublish !== 'boolean') {
    throw new TypeError('allowRemotePublish must be a boolean');
  }

  return Object.freeze({
    dataRepositoryRoot: path.resolve(dataRepositoryRoot),
    expectedRemoteUrl: normalizeGitHubHttpsRemoteUrl(expectedRemoteUrl),
    remoteName,
    baseBranch,
    branchPrefix,
    gitCommand,
    allowRemotePublish,
  });
}

module.exports = {
  COMMIT_MESSAGE,
  EXPECTED_REMOTE_URL,
  normalizePublisherConfiguration,
};
