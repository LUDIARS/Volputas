'use strict';

const { createProcessRunner } = require('./processRunner');
const { normalizeGithubIdentity } = require('./githubIdentity');
const {
  COMMIT_MESSAGE,
  EXPECTED_REMOTE_URL,
  normalizePublisherConfiguration,
} = require('./gitSurveyConfiguration');
const {
  prepareOfflineBranch,
  prepareOnlineBranch,
} = require('./gitSurveyBranch');
const { GitSurveyPublisherError } = require('./gitSurveyError');
const { assertCurrentBranch } = require('./gitSurveyRefs');
const {
  readCommitSha,
  verifyRepository,
} = require('./gitSurveyRepository');
const {
  normalizeGitHubHttpsRemoteUrl,
  verifyRemoteCommit,
} = require('./gitSurveyRemote');
const {
  assertOnlyAllowedCommittedPaths,
  assertOnlyAllowedDirtyPaths,
  normalizeAllowedPaths,
  readCommittedPaths,
  readDirtyPaths,
} = require('./gitSurveyStatus');

function createGitSurveyPublisher(configurationInput = {}, {
  runner = createProcessRunner(),
} = {}) {
  const configuration = normalizePublisherConfiguration(configurationInput);
  validateRunner(runner);

  const runGit = (args, options = {}) => runner.run(
    configuration.gitCommand,
    args,
    {
      cwd: configuration.dataRepositoryRoot,
      ...options,
    }
  );

  function prepare(identity, {
    offline = false,
    allowedPaths,
  } = {}) {
    if (typeof offline !== 'boolean') {
      throw new TypeError('offline must be a boolean');
    }

    const githubIdentity = normalizeGithubIdentity(identity);
    const generatedPaths = normalizeAllowedPaths(allowedPaths, githubIdentity.id);
    const targetBranch = `${configuration.branchPrefix}${githubIdentity.id}`;

    verifyRepository(runGit, configuration);
    const dirtyPaths = readDirtyPaths(runGit);
    assertOnlyAllowedDirtyPaths(dirtyPaths, generatedPaths);

    const branchAction = offline
      ? prepareOfflineBranch({
        runGit,
        configuration,
        targetBranch,
        dirtyPathCount: dirtyPaths.length,
      })
      : prepareOnlineBranch({
        runGit,
        configuration,
        targetBranch,
        dirtyPathCount: dirtyPaths.length,
      });
    assertOnlyAllowedDirtyPaths(readDirtyPaths(runGit), generatedPaths);

    return Object.freeze({
      status: 'prepared',
      mode: offline ? 'offline' : 'online',
      branch: targetBranch,
      branchAction,
      remoteName: configuration.remoteName,
      allowedPaths: Object.freeze([...generatedPaths]),
    });
  }

  function publish(identity, { allowedPaths } = {}) {
    if (!configuration.allowRemotePublish) {
      throw new GitSurveyPublisherError(
        'REMOTE_PUBLICATION_DISABLED',
        'Remote survey publication requires explicit configuration.'
      );
    }
    const githubIdentity = normalizeGithubIdentity(identity);
    const generatedPaths = normalizeAllowedPaths(allowedPaths, githubIdentity.id);
    const targetBranch = `${configuration.branchPrefix}${githubIdentity.id}`;

    verifyRepository(runGit, configuration);
    assertCurrentBranch(runGit, targetBranch);
    assertOnlyAllowedDirtyPaths(readDirtyPaths(runGit), generatedPaths);

    runGit(['add', '--', ...generatedPaths]);
    assertOnlyAllowedDirtyPaths(readDirtyPaths(runGit), generatedPaths);
    const stagedDiff = runGit(
      ['diff', '--cached', '--quiet', '--exit-code', '--', ...generatedPaths],
      { allowedExitCodes: [0, 1] }
    );
    const didCommit = stagedDiff.status === 1;

    if (didCommit) {
      const noreplyEmail = (
        `${githubIdentity.id}+${githubIdentity.login}@users.noreply.github.com`
      );
      runGit([
        '-c',
        `user.name=${githubIdentity.login}`,
        '-c',
        `user.email=${noreplyEmail}`,
        'commit',
        '--only',
        '--message',
        COMMIT_MESSAGE,
        '--',
        ...generatedPaths,
      ]);
    }

    const commitSha = readCommitSha(runGit);
    if (didCommit) {
      assertOnlyAllowedCommittedPaths(
        readCommittedPaths(runGit, commitSha),
        generatedPaths
      );
    }
    const remainingDirtyPaths = readDirtyPaths(runGit);
    assertOnlyAllowedDirtyPaths(remainingDirtyPaths, generatedPaths);
    if (remainingDirtyPaths.length > 0) {
      throw new GitSurveyPublisherError(
        'POST_COMMIT_DIRTY',
        'Generated paths changed during commit; refusing to push stale survey data.'
      );
    }

    // Commit hooks are untrusted repository code and may mutate Git config/state.
    verifyRepository(runGit, configuration);
    assertCurrentBranch(runGit, targetBranch);
    runGit([
      'push',
      '-u',
      configuration.remoteName,
      `HEAD:refs/heads/${targetBranch}`,
    ]);
    verifyRemoteCommit(runGit, configuration.remoteName, targetBranch, commitSha);

    return Object.freeze({
      status: 'published',
      branch: targetBranch,
      change: didCommit ? 'committed' : 'unchanged',
      commitSha,
      pushed: true,
    });
  }

  return Object.freeze({ prepare, publish });
}

function validateRunner(runner) {
  if (!runner || typeof runner.run !== 'function') {
    throw new TypeError('runner must expose a run function');
  }
}

module.exports = {
  COMMIT_MESSAGE,
  EXPECTED_REMOTE_URL,
  GitSurveyPublisherError,
  createGitSurveyPublisher,
  normalizeGitHubHttpsRemoteUrl,
};
