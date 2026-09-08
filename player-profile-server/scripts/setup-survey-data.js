'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { safeErrorMessage } = require('../src/localSurvey/cliErrorMessage');
const { loadLocalSurveyConfig } = require('../src/localSurvey/localSurveyConfig');
const { assertPrivateGithubRepository } = require(
  '../src/localSurvey/githubRepositoryVisibility'
);
const { createProcessRunner } = require('../src/localSurvey/processRunner');

// @implements SPEC-LOCAL-SURVEY-GIT-WORKFLOW (Clone interface)
//   spec/interface/local-survey-git-workflow.md
//
// The data repository is configured per deployment via config/local-survey.json
// (dataRepository.githubRepository / expectedRemoteUrl), not hardcoded here. A
// deployment that never edits that config away from the shipped LUDIARS/VolputasData
// public template will fail the private-repository check below instead of silently
// cloning and using a public repository.
function main({
  env = process.env,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}, {
  loadConfig = loadLocalSurveyConfig,
  assertPrivateRepository = assertPrivateGithubRepository,
  createRunner = createProcessRunner,
  cloneRepository = defaultCloneRepository,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
  readdirSync = fs.readdirSync,
  mkdirSync = fs.mkdirSync,
} = {}) {
  try {
    const config = loadConfig({ env });
    const dataRoot = config.dataRepositoryRoot;

    const targetExists = existsSync(dataRoot);
    const targetIsEmpty = (
      targetExists
      && statSync(dataRoot).isDirectory()
      && readdirSync(dataRoot).length === 0
    );
    if (targetExists && !targetIsEmpty) {
      assertExistingClone(dataRoot, config.expectedRemoteUrl, config.gitCommand);
    } else {
      mkdirSync(path.dirname(dataRoot), { recursive: true });
      cloneRepository({
        repositoryUrl: config.expectedRemoteUrl,
        baseBranch: config.baseBranch,
        dataRoot,
        cwd: config.serverRoot,
        // `commands.git` is honoured by every other consumer of this config
        // (localSurveyWorkflow, gitSurveyPublisher, repositoryLock); setup must not be
        // the one step that silently falls back to whatever `git` PATH resolves to.
        gitCommand: config.gitCommand,
      });
    }

    // Fail fast here rather than only at `survey:local` time: a company that has not
    // yet pointed config/local-survey.json at their own private copy should find out
    // immediately, not after answers already exist locally.
    assertPrivateRepository({
      cwd: config.serverRoot,
      repository: config.githubRepository,
      githubCommand: config.githubCommand,
      runner: createRunner(),
    });

    output.write(`Data repository is ready at ${dataRoot}\n`);
    return 0;
  } catch (error) {
    errorOutput.write(
      `[fatal] ${safeErrorMessage(error, 'Unable to prepare the configured data repository clone.')}\n`
    );
    return typeof error?.status === 'number' && error.status !== 0 ? error.status : 1;
  }
}

function assertExistingClone(target, expectedRemoteUrl, gitCommand = 'git') {
  const topLevel = execFileSync(
    gitCommand,
    ['rev-parse', '--show-toplevel'],
    { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();
  const originUrl = execFileSync(
    gitCommand,
    ['remote', 'get-url', 'origin'],
    { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();

  if (path.resolve(topLevel) !== path.resolve(target)) {
    throw new Error(
      `Survey data path "${target}" is nested inside a different Git repository (top-level: ` +
      `"${topLevel}"). Remove or move the conflicting directory, then retry.`
    );
  }
  if (normalizeRepositoryUrl(originUrl) !== normalizeRepositoryUrl(expectedRemoteUrl)) {
    throw new Error(
      `Survey data at "${target}" has origin "${withoutCredentials(originUrl)}", which does ` +
      `not match the configured data repository "${expectedRemoteUrl}" ` +
      '(config/local-survey.json). Point the config at this repository, or remove the ' +
      'directory and rerun setup.'
    );
  }
}

// An existing clone's origin can carry an embedded credential
// (https://x-access-token:<token>@github.com/...). This message is printed to stderr,
// and the Git workflow contract requires credentials to stay out of URLs, stdout and
// stderr, so the userinfo is dropped before the URL is reported back to the operator.
// `expectedRemoteUrl` needs no such treatment: loadLocalSurveyConfig already rejects a
// configured remote that carries userinfo.
//
// Both remote spellings Git accepts are stripped: the scheme form above, and the SCP
// form (`user:token@github.com:owner/repo`), which has no `://` and so would otherwise
// carry its userinfo straight through to stderr.
function withoutCredentials(value) {
  const withScheme = value.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]*@/, '$1');
  if (withScheme !== value) return withScheme;
  return value.replace(/^[^/@]*@(?=[^/]*:)/, '');
}

function defaultCloneRepository({ repositoryUrl, baseBranch, dataRoot, cwd, gitCommand = 'git' }) {
  execFileSync(gitCommand, [
    'clone',
    '--branch',
    baseBranch,
    '--single-branch',
    repositoryUrl,
    dataRoot,
  ], {
    cwd,
    stdio: 'inherit',
  });
}

function normalizeRepositoryUrl(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
