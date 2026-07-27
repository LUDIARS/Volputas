'use strict';

const { GitSurveyPublisherError } = require('./gitSurveyError');
const {
  fetchRemoteRef,
  remoteBranchExists,
} = require('./gitSurveyRemote');
const {
  assertCanSwitchBranches,
  assertRefsRelated,
  deleteRefIfPresent,
  readCurrentBranch,
  readDivergence,
  refExists,
  switchToExistingBranch,
} = require('./gitSurveyRefs');

function prepareOnlineBranch({
  runGit,
  configuration,
  targetBranch,
  dirtyPathCount,
}) {
  const localRef = `refs/heads/${targetBranch}`;
  const remoteRef = `refs/remotes/${configuration.remoteName}/${targetBranch}`;
  const remoteBaseRef = (
    `refs/remotes/${configuration.remoteName}/${configuration.baseBranch}`
  );
  fetchRemoteRef({
    runGit,
    remoteName: configuration.remoteName,
    branch: configuration.baseBranch,
    remoteTrackingRef: remoteBaseRef,
  });
  const hasRemoteBranch = remoteBranchExists(
    runGit,
    configuration.remoteName,
    targetBranch
  );
  if (hasRemoteBranch) {
    fetchRemoteRef({
      runGit,
      remoteName: configuration.remoteName,
      branch: targetBranch,
      remoteTrackingRef: remoteRef,
    });
  } else {
    deleteRefIfPresent(runGit, remoteRef);
  }

  const hasLocalBranch = refExists(runGit, localRef);
  const currentBranch = readCurrentBranch(runGit);
  if (hasLocalBranch && hasRemoteBranch) {
    return reconcileLocalAndRemote({
      runGit,
      localRef,
      remoteRef,
      currentBranch,
      targetBranch,
      dirtyPathCount,
    });
  }
  if (hasRemoteBranch) {
    assertCanSwitchBranches(currentBranch, targetBranch, dirtyPathCount);
    runGit(['switch', '--create', targetBranch, '--track', remoteRef]);
    return 'created-from-remote';
  }
  if (hasLocalBranch) {
    if (!refExists(runGit, remoteBaseRef)) {
      throw baseUnavailableError();
    }
    assertRefsRelated(runGit, localRef, remoteBaseRef);
    const didSwitch = switchToExistingBranch({
      runGit,
      currentBranch,
      targetBranch,
      dirtyPathCount,
    });
    return didSwitch ? 'switched-local' : 'current-local';
  }
  if (!refExists(runGit, remoteBaseRef)) {
    throw baseUnavailableError();
  }

  assertCanSwitchBranches(currentBranch, targetBranch, dirtyPathCount);
  runGit([
    'switch',
    '--no-track',
    '--create',
    targetBranch,
    remoteBaseRef,
  ]);
  return 'created-from-remote-base';
}

function reconcileLocalAndRemote({
  runGit,
  localRef,
  remoteRef,
  currentBranch,
  targetBranch,
  dirtyPathCount,
}) {
  const divergence = readDivergence(runGit, localRef, remoteRef);
  if (divergence.ahead > 0 && divergence.behind > 0) {
    throw new GitSurveyPublisherError(
      'BRANCH_DIVERGED',
      'The local and remote survey branches have diverged; force push is not allowed.'
    );
  }
  if (divergence.behind > 0 && dirtyPathCount > 0) {
    throw new GitSurveyPublisherError(
      'FAST_FORWARD_WOULD_OVERWRITE',
      'The survey branch cannot be fast-forwarded while generated files have local changes.'
    );
  }

  const didSwitch = switchToExistingBranch({
    runGit,
    currentBranch,
    targetBranch,
    dirtyPathCount,
  });
  if (divergence.behind > 0) {
    runGit(['merge', '--ff-only', remoteRef]);
    return 'fast-forwarded';
  }
  return didSwitch ? 'switched' : 'current';
}

function prepareOfflineBranch({
  runGit,
  configuration,
  targetBranch,
  dirtyPathCount,
}) {
  const localRef = `refs/heads/${targetBranch}`;
  const localBaseRef = `refs/heads/${configuration.baseBranch}`;
  const remoteRef = `refs/remotes/${configuration.remoteName}/${targetBranch}`;
  const remoteBaseRef = (
    `refs/remotes/${configuration.remoteName}/${configuration.baseBranch}`
  );
  const hasLocalBranch = refExists(runGit, localRef);
  const currentBranch = readCurrentBranch(runGit);

  if (hasLocalBranch) {
    if (refExists(runGit, remoteRef)) {
      const divergence = readDivergence(runGit, localRef, remoteRef);
      if (divergence.behind > 0) {
        throw new GitSurveyPublisherError(
          'OFFLINE_BRANCH_STALE',
          'The local survey branch is behind or diverged from its cached remote branch.'
        );
      }
    }
    const didSwitch = switchToExistingBranch({
      runGit,
      currentBranch,
      targetBranch,
      dirtyPathCount,
    });
    return didSwitch ? 'switched-local' : 'current-local';
  }

  if (!refExists(runGit, localBaseRef)) {
    throw new GitSurveyPublisherError(
      'BASE_BRANCH_UNAVAILABLE',
      'The local base branch is unavailable in offline mode.'
    );
  }
  if (refExists(runGit, remoteBaseRef)) {
    const divergence = readDivergence(runGit, localBaseRef, remoteBaseRef);
    if (divergence.behind > 0) {
      throw new GitSurveyPublisherError(
        'OFFLINE_BASE_STALE',
        'The local base branch is behind or diverged from its cached remote branch.'
      );
    }
  }

  assertCanSwitchBranches(currentBranch, targetBranch, dirtyPathCount);
  runGit([
    'switch',
    '--no-track',
    '--create',
    targetBranch,
    localBaseRef,
  ]);
  return 'created-from-local-base';
}

function baseUnavailableError() {
  return new GitSurveyPublisherError(
    'BASE_BRANCH_UNAVAILABLE',
    'The fetched base branch is unavailable.'
  );
}

module.exports = {
  prepareOfflineBranch,
  prepareOnlineBranch,
};
