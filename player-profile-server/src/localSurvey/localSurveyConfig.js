'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeGitHubHttpsRemoteUrl } = require('./gitSurveyPublisher');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../config/local-survey.json');
const SERVER_ROOT = path.resolve(__dirname, '../..');

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Local survey config field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function loadLocalSurveyConfig({
  configPath = DEFAULT_CONFIG_PATH,
  env = process.env,
  readFile = fs.readFileSync,
} = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFile(configPath, 'utf8'));
  } catch {
    throw new Error('Unable to read local survey config');
  }

  if (parsed?.schemaVersion !== 1) {
    throw new Error('Local survey config requires schemaVersion 1');
  }
  const repository = parsed?.dataRepository;
  const commands = parsed?.commands;
  if (!repository || !commands) {
    throw new Error('Local survey config requires dataRepository and commands objects');
  }

  const configuredPath = requireString(repository.path, 'dataRepository.path');
  const overridePath = env.VOLUPTAS_SURVEY_DATA_DIR?.trim();
  const dataRepositoryRoot = path.resolve(SERVER_ROOT, overridePath || configuredPath);
  const githubRepository = requireString(
    repository.githubRepository,
    'dataRepository.githubRepository'
  );
  const expectedRemoteUrl = requireString(
    repository.expectedRemoteUrl,
    'dataRepository.expectedRemoteUrl'
  );
  assertMatchingGithubRepository(githubRepository, expectedRemoteUrl);

  return Object.freeze({
    serverRoot: SERVER_ROOT,
    dataRepositoryRoot,
    remote: requireString(repository.remote, 'dataRepository.remote'),
    githubRepository,
    expectedRemoteUrl,
    baseBranch: requireString(repository.baseBranch, 'dataRepository.baseBranch'),
    responseBranchPrefix: requireString(
      repository.responseBranchPrefix,
      'dataRepository.responseBranchPrefix'
    ),
    gitCommand: requireString(commands.git, 'commands.git'),
    githubCommand: requireString(commands.github, 'commands.github'),
  });
}

function assertMatchingGithubRepository(githubRepository, expectedRemoteUrl) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository)) {
    throw new Error(
      'Local survey config field "dataRepository.githubRepository" is invalid'
    );
  }

  let configuredRemote;
  let repositoryRemote;
  try {
    configuredRemote = normalizeGitHubHttpsRemoteUrl(expectedRemoteUrl);
    repositoryRemote = normalizeGitHubHttpsRemoteUrl(
      `https://github.com/${githubRepository}.git`
    );
  } catch {
    throw new Error(
      'Local survey config field "dataRepository.expectedRemoteUrl" is invalid'
    );
  }
  if (configuredRemote !== repositoryRemote) {
    throw new Error(
      'Local survey GitHub privacy target and Git remote must identify the same repository'
    );
  }
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  SERVER_ROOT,
  loadLocalSurveyConfig,
};
