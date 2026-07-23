'use strict';

const { GitSurveyPublisherError } = require('./gitSurveyError');

function refExists(runGit, refName) {
  const result = runGit(
    ['show-ref', '--verify', '--quiet', refName],
    { allowedExitCodes: [0, 1] }
  );
  return result.status === 0;
}

function deleteRefIfPresent(runGit, refName) {
  if (refExists(runGit, refName)) {
    runGit(['update-ref', '--delete', refName]);
  }
}

function readCurrentBranch(runGit) {
  const output = runGit(['branch', '--show-current']).stdout;
  if (typeof output !== 'string' || output.includes('\0')) {
    return null;
  }
  const branch = output.trim();
  return branch.length > 0 && !/[\r\n]/.test(branch) ? branch : null;
}

function assertCurrentBranch(runGit, targetBranch) {
  if (readCurrentBranch(runGit) !== targetBranch) {
    throw new GitSurveyPublisherError(
      'WRONG_BRANCH',
      'The survey data repository is not on the prepared identity branch.'
    );
  }
}

function switchToExistingBranch({
  runGit,
  currentBranch,
  targetBranch,
  dirtyPathCount,
}) {
  if (currentBranch === targetBranch) {
    return false;
  }
  assertCanSwitchBranches(currentBranch, targetBranch, dirtyPathCount);
  runGit(['switch', targetBranch]);
  return true;
}

function assertCanSwitchBranches(currentBranch, targetBranch, dirtyPathCount) {
  if (currentBranch !== targetBranch && dirtyPathCount > 0) {
    throw new GitSurveyPublisherError(
      'DIRTY_BRANCH_SWITCH',
      'Generated files have local changes; refusing to switch survey branches.'
    );
  }
}

function readDivergence(runGit, leftRef, rightRef) {
  const output = runGit([
    'rev-list',
    '--left-right',
    '--count',
    `${leftRef}...${rightRef}`,
  ]).stdout.trim();
  const match = /^(\d+)\s+(\d+)$/.exec(output);
  if (!match) {
    throw new GitSurveyPublisherError(
      'BRANCH_RELATION_INVALID',
      'Git returned an invalid branch relationship.'
    );
  }
  return {
    ahead: Number(match[1]),
    behind: Number(match[2]),
  };
}

function assertRefsRelated(runGit, leftRef, rightRef) {
  const result = runGit(
    ['merge-base', leftRef, rightRef],
    { allowedExitCodes: [0, 1] }
  );
  if (result.status !== 0) {
    throw new GitSurveyPublisherError(
      'UNRELATED_BRANCH',
      'The local survey branch is unrelated to the configured base branch.'
    );
  }
}

module.exports = {
  assertCanSwitchBranches,
  assertCurrentBranch,
  assertRefsRelated,
  deleteRefIfPresent,
  readCurrentBranch,
  readDivergence,
  refExists,
  switchToExistingBranch,
};
