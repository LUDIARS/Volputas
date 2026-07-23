'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  COMMIT_MESSAGE,
  EXPECTED_REMOTE_URL,
  GitSurveyPublisherError,
  createGitSurveyPublisher,
  normalizeGitHubHttpsRemoteUrl,
} = require('./gitSurveyPublisher');

const IDENTITY = Object.freeze({ id: '42', login: 'neco-player' });
const ALLOWED_PATHS = Object.freeze([
  'surveys/gamer-preferences.md',
  'responses/github-42/gamer-preferences.md',
]);
const SORTED_PATHS = Object.freeze([...ALLOWED_PATHS].sort());
const BASE_SHA = '1111111111111111111111111111111111111111';
const LOCAL_SHA = '2222222222222222222222222222222222222222';
const REMOTE_SHA = '3333333333333333333333333333333333333333';
const COMMIT_SHA = '4444444444444444444444444444444444444444';

function createPublisherFixture({
  root = path.resolve('.'),
  gitCommand = 'git',
  gitDirectory = '.publisher-test-git',
  currentBranch = 'main',
  localBranches = { main: BASE_SHA },
  remoteBranches = { main: BASE_SHA },
  remoteTrackingBranches = {},
  dirtyEntries = [],
  hasChanges = false,
  divergence = null,
  fetchUrl = EXPECTED_REMOTE_URL,
  pushUrl = EXPECTED_REMOTE_URL,
  commitPaths = SORTED_PATHS,
  commitHook = null,
  remoteVerificationSha = null,
} = {}) {
  const state = {
    root,
    gitCommand,
    gitDirectory,
    currentBranch,
    localRefs: new Map(
      Object.entries(localBranches).map(([branch, sha]) => [
        `refs/heads/${branch}`,
        sha,
      ])
    ),
    remoteHeads: new Map(Object.entries(remoteBranches)),
    remoteTrackingRefs: new Map(
      Object.entries(remoteTrackingBranches).map(([branch, sha]) => [
        `refs/remotes/origin/${branch}`,
        sha,
      ])
    ),
    dirtyEntries: [...dirtyEntries],
    hasChanges,
    divergence,
    fetchUrl,
    pushUrl,
    commitPaths: [...commitPaths],
    commitHook,
    remoteVerificationSha,
    headSha: localBranches[currentBranch] || BASE_SHA,
    calls: [],
    pushCount: 0,
    commitCount: 0,
  };

  const runner = {
    run(executable, args, options) {
      assert.equal(executable, state.gitCommand);
      assert.equal(options.cwd, state.root);
      state.calls.push({
        executable,
        args: [...args],
        options: { ...options },
      });
      return runScriptedGit(state, args);
    },
  };
  const publisher = createGitSurveyPublisher(
    {
      dataRepositoryRoot: root,
      gitCommand,
    },
    { runner }
  );
  return {
    publisher,
    state,
    setWorkingChanges(entries, shouldCommit = true) {
      state.dirtyEntries = [...entries];
      state.hasChanges = shouldCommit;
    },
  };
}

function runScriptedGit(state, args) {
  if (args.includes('commit')) {
    state.commitCount += 1;
    state.headSha = COMMIT_SHA;
    state.localRefs.set(`refs/heads/${state.currentBranch}`, COMMIT_SHA);
    state.dirtyEntries = [];
    if (state.commitHook) {
      state.commitHook(state);
    }
    return result();
  }

  const command = args[0];
  if (command === 'rev-parse') {
    if (args[1] === '--show-toplevel') {
      return result(0, `${state.root}\n`);
    }
    if (args[1] === '--git-dir') {
      return result(0, `${state.gitDirectory}\n`);
    }
    if (args[1] === 'HEAD') {
      return result(0, `${state.headSha}\n`);
    }
  }
  if (command === 'remote' && args[1] === 'get-url') {
    const url = args.includes('--push') ? state.pushUrl : state.fetchUrl;
    const output = Array.isArray(url) ? url.join('\n') : url;
    return result(0, `${output}\n`);
  }
  if (command === 'status') {
    const output = state.dirtyEntries
      .map(({ status, file }) => `${status} ${file}\0`)
      .join('');
    return result(0, output);
  }
  if (command === 'show-ref') {
    const refName = args.at(-1);
    const exists = (
      state.localRefs.has(refName)
      || state.remoteTrackingRefs.has(refName)
    );
    return result(exists ? 0 : 1);
  }
  if (command === 'branch' && args[1] === '--show-current') {
    return result(0, state.currentBranch ? `${state.currentBranch}\n` : '');
  }
  if (command === 'fetch') {
    const [sourceRef, trackingRef] = args.at(-1).split(':');
    const branch = sourceRef.slice('refs/heads/'.length);
    const sha = state.remoteHeads.get(branch);
    assert.ok(sha, `scripted remote branch ${branch} must exist`);
    state.remoteTrackingRefs.set(trackingRef, sha);
    return result();
  }
  if (command === 'ls-remote') {
    const remoteRef = args.at(-1);
    const branch = remoteRef.slice('refs/heads/'.length);
    const sha = state.remoteHeads.get(branch);
    return sha
      ? result(0, `${sha}\t${remoteRef}\n`)
      : result(2);
  }
  if (command === 'switch') {
    switchBranch(state, args);
    return result();
  }
  if (command === 'rev-list') {
    const relationship = state.divergence || { ahead: 0, behind: 0 };
    return result(0, `${relationship.ahead}\t${relationship.behind}\n`);
  }
  if (command === 'merge-base') {
    return result(0, `${BASE_SHA}\n`);
  }
  if (command === 'merge') {
    const remoteRef = args.at(-1);
    state.headSha = state.remoteTrackingRefs.get(remoteRef);
    state.localRefs.set(`refs/heads/${state.currentBranch}`, state.headSha);
    return result();
  }
  if (command === 'update-ref' && args[1] === '--delete') {
    state.remoteTrackingRefs.delete(args[2]);
    return result();
  }
  if (command === 'add') {
    return result();
  }
  if (command === 'diff' && args.includes('--cached')) {
    return result(state.hasChanges ? 1 : 0);
  }
  if (command === 'diff-tree') {
    return result(
      0,
      state.commitPaths.length > 0
        ? `${state.commitPaths.join('\0')}\0`
        : ''
    );
  }
  if (command === 'push') {
    state.pushCount += 1;
    const remoteRef = args.at(-1).split(':')[1];
    const branch = remoteRef.slice('refs/heads/'.length);
    state.remoteHeads.set(
      branch,
      state.remoteVerificationSha || state.headSha
    );
    return result();
  }

  throw new Error(`Unhandled scripted Git command: ${args.join(' ')}`);
}

function switchBranch(state, args) {
  const createIndex = args.indexOf('--create');
  if (createIndex === -1) {
    state.currentBranch = args[1];
    state.headSha = state.localRefs.get(`refs/heads/${state.currentBranch}`);
    return;
  }

  const branch = args[createIndex + 1];
  const startRef = args.at(-1);
  const startSha = (
    state.localRefs.get(startRef)
    || state.remoteTrackingRefs.get(startRef)
    || state.headSha
  );
  state.currentBranch = branch;
  state.headSha = startSha;
  state.localRefs.set(`refs/heads/${branch}`, startSha);
}

function result(status = 0, stdout = '') {
  return Object.freeze({
    status,
    signal: null,
    stdout,
    stderr: '',
  });
}

function captureError(operation, expected) {
  let captured;
  assert.throws(
    () => {
      try {
        operation();
      } catch (error) {
        captured = error;
        throw error;
      }
    },
    expected
  );
  return captured;
}

test('offline prepare creates the stable identity branch without network access', () => {
  const fixture = createPublisherFixture({ gitCommand: 'configured-git' });

  const outcome = fixture.publisher.prepare(IDENTITY, {
    offline: true,
    allowedPaths: ALLOWED_PATHS,
  });

  assert.deepEqual(outcome, {
    status: 'prepared',
    mode: 'offline',
    branch: 'responses/github-42',
    branchAction: 'created-from-local-base',
    remoteName: 'origin',
    allowedPaths: SORTED_PATHS,
  });
  assert.equal(fixture.state.currentBranch, 'responses/github-42');
  assert.equal(
    fixture.state.calls.some(({ args }) => (
      args[0] === 'fetch' || args[0] === 'ls-remote' || args[0] === 'push'
    )),
    false
  );
  assert.equal(
    fixture.state.calls.every(({ executable }) => executable === 'configured-git'),
    true
  );
});

test('publish stages and commits exact paths, then pushes an explicit refspec', () => {
  const fixture = createPublisherFixture();
  fixture.publisher.prepare(IDENTITY, {
    offline: true,
    allowedPaths: ALLOWED_PATHS,
  });
  fixture.setWorkingChanges(
    SORTED_PATHS.map((file) => ({ status: ' M', file }))
  );

  const outcome = fixture.publisher.publish(IDENTITY, {
    allowedPaths: ALLOWED_PATHS,
  });

  assert.deepEqual(outcome, {
    status: 'published',
    branch: 'responses/github-42',
    change: 'committed',
    commitSha: COMMIT_SHA,
    pushed: true,
  });
  const addCall = fixture.state.calls.find(({ args }) => args[0] === 'add');
  assert.deepEqual(addCall.args, ['add', '--', ...SORTED_PATHS]);
  const commitCall = fixture.state.calls.find(({ args }) => args.includes('commit'));
  assert.deepEqual(
    commitCall.args.slice(commitCall.args.indexOf('commit')),
    ['commit', '--only', '--message', COMMIT_MESSAGE, '--', ...SORTED_PATHS]
  );
  assert.ok(commitCall.args.includes('user.name=neco-player'));
  assert.ok(
    commitCall.args.includes(
      'user.email=42+neco-player@users.noreply.github.com'
    )
  );
  const pushCall = fixture.state.calls.find(({ args }) => args[0] === 'push');
  assert.deepEqual(pushCall.args, [
    'push',
    '-u',
    'origin',
    'HEAD:refs/heads/responses/github-42',
  ]);
  assert.equal(pushCall.args.some((argument) => argument.includes('force')), false);
});

test('no-change publish skips an empty commit but still pushes branch state', () => {
  const fixture = createPublisherFixture();
  fixture.publisher.prepare(IDENTITY, {
    offline: true,
    allowedPaths: ALLOWED_PATHS,
  });

  const outcome = fixture.publisher.publish(IDENTITY, {
    allowedPaths: ALLOWED_PATHS,
  });

  assert.equal(outcome.change, 'unchanged');
  assert.equal(fixture.state.commitCount, 0);
  assert.equal(fixture.state.pushCount, 1);
});

test('prepare rejects dirty paths outside the generated allowlist', () => {
  const fixture = createPublisherFixture({
    dirtyEntries: [{ status: '??', file: 'unrelated-private-file.md' }],
  });

  assert.throws(
    () => fixture.publisher.prepare(IDENTITY, {
      offline: true,
      allowedPaths: ALLOWED_PATHS,
    }),
    (error) => (
      error instanceof GitSurveyPublisherError
      && error.code === 'UNEXPECTED_DIRTY_PATH'
    )
  );
  assert.equal(fixture.state.currentBranch, 'main');
});

test('offline prepare refuses cached divergence without overwriting either side', () => {
  const fixture = createPublisherFixture({
    currentBranch: 'responses/github-42',
    localBranches: {
      main: BASE_SHA,
      'responses/github-42': LOCAL_SHA,
    },
    remoteTrackingBranches: {
      'responses/github-42': REMOTE_SHA,
    },
    divergence: { ahead: 1, behind: 1 },
  });

  assert.throws(
    () => fixture.publisher.prepare(IDENTITY, {
      offline: true,
      allowedPaths: ALLOWED_PATHS,
    }),
    (error) => (
      error instanceof GitSurveyPublisherError
      && error.code === 'OFFLINE_BRANCH_STALE'
    )
  );
  assert.equal(fixture.state.headSha, LOCAL_SHA);
});

test('online prepare fetches only base and the current identity branch', () => {
  const fixture = createPublisherFixture({
    remoteBranches: {
      main: BASE_SHA,
      'responses/github-42': REMOTE_SHA,
      'responses/github-999': '9999999999999999999999999999999999999999',
    },
  });

  const outcome = fixture.publisher.prepare(IDENTITY, {
    offline: false,
    allowedPaths: ALLOWED_PATHS,
  });

  assert.equal(outcome.branchAction, 'created-from-remote');
  const fetchCalls = fixture.state.calls
    .filter(({ args }) => args[0] === 'fetch')
    .map(({ args }) => args);
  assert.deepEqual(fetchCalls, [
    [
      'fetch',
      '--no-tags',
      'origin',
      'refs/heads/main:refs/remotes/origin/main',
    ],
    [
      'fetch',
      '--no-tags',
      'origin',
      (
        'refs/heads/responses/github-42:'
        + 'refs/remotes/origin/responses/github-42'
      ),
    ],
  ]);
  assert.equal(
    fetchCalls.some((args) => args.join(' ').includes('github-999')),
    false
  );
});

test('remote normalization is strict and rejected URLs stay out of errors', () => {
  assert.equal(
    normalizeGitHubHttpsRemoteUrl(
      'https://github.com/LUDIARS/Voluptas-Data/'
    ),
    'https://github.com/ludiars/voluptas-data.git'
  );
  assert.throws(
    () => normalizeGitHubHttpsRemoteUrl(
      'git@github.com:LUDIARS/Voluptas-Data.git'
    ),
    /remote URL/
  );
  const fixture = createPublisherFixture({
    fetchUrl: 'https://top-secret@github.com/LUDIARS/Voluptas-Data.git',
  });

  const error = captureError(
    () => fixture.publisher.prepare(IDENTITY, {
      offline: true,
      allowedPaths: ALLOWED_PATHS,
    }),
    GitSurveyPublisherError
  );
  assert.equal(error.code, 'REMOTE_URL_INVALID');
  assert.doesNotMatch(error.message, /top-secret/);
});

test('prepare rejects a distinct or multiple push URL', () => {
  for (const pushUrl of [
    'https://github.com/other/private-data.git',
    [
      EXPECTED_REMOTE_URL,
      'https://github.com/other/private-data.git',
    ],
  ]) {
    const fixture = createPublisherFixture({ pushUrl });
    assert.throws(
      () => fixture.publisher.prepare(IDENTITY, {
        offline: true,
        allowedPaths: ALLOWED_PATHS,
      }),
      (error) => (
        error instanceof GitSurveyPublisherError
        && (
          error.code === 'PUSH_REMOTE_URL_MISMATCH'
          || error.code === 'PUSH_REMOTE_URL_INVALID'
        )
      )
    );
  }
});

test('prepare rejects an in-progress Git operation before branch changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voluptas-git-operation-'));
  const gitDirectory = path.join(root, '.git');
  fs.mkdirSync(gitDirectory);
  fs.writeFileSync(path.join(gitDirectory, 'MERGE_HEAD'), `${REMOTE_SHA}\n`, 'utf8');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createPublisherFixture({ root, gitDirectory: '.git' });

  assert.throws(
    () => fixture.publisher.prepare(IDENTITY, {
      offline: true,
      allowedPaths: ALLOWED_PATHS,
    }),
    (error) => (
      error instanceof GitSurveyPublisherError
      && error.code === 'GIT_OPERATION_IN_PROGRESS'
    )
  );
  assert.equal(fixture.state.currentBranch, 'main');
});

test('publish verifies the exact remote commit before reporting success', () => {
  const fixture = createPublisherFixture({
    remoteVerificationSha: REMOTE_SHA,
  });
  fixture.publisher.prepare(IDENTITY, {
    offline: true,
    allowedPaths: ALLOWED_PATHS,
  });
  fixture.setWorkingChanges(
    SORTED_PATHS.map((file) => ({ status: ' M', file }))
  );

  assert.throws(
    () => fixture.publisher.publish(IDENTITY, {
      allowedPaths: ALLOWED_PATHS,
    }),
    (error) => (
      error instanceof GitSurveyPublisherError
      && error.code === 'REMOTE_COMMIT_MISMATCH'
    )
  );
});

test('commit hook pushurl mutation is rejected before push', () => {
  const fixture = createPublisherFixture({
    commitHook(state) {
      state.pushUrl = 'https://github.com/other/private-data.git';
    },
  });
  fixture.publisher.prepare(IDENTITY, {
    offline: true,
    allowedPaths: ALLOWED_PATHS,
  });
  fixture.setWorkingChanges(
    SORTED_PATHS.map((file) => ({ status: ' M', file }))
  );

  assert.throws(
    () => fixture.publisher.publish(IDENTITY, {
      allowedPaths: ALLOWED_PATHS,
    }),
    (error) => (
      error instanceof GitSurveyPublisherError
      && error.code === 'PUSH_REMOTE_URL_MISMATCH'
    )
  );
  assert.equal(fixture.state.pushCount, 0);
});

test('commit hook cannot smuggle an unrelated committed path', () => {
  const fixture = createPublisherFixture({
    commitHook(state) {
      state.commitPaths.push('unrelated-private-file.md');
    },
  });
  fixture.publisher.prepare(IDENTITY, {
    offline: true,
    allowedPaths: ALLOWED_PATHS,
  });
  fixture.setWorkingChanges(
    SORTED_PATHS.map((file) => ({ status: ' M', file }))
  );

  assert.throws(
    () => fixture.publisher.publish(IDENTITY, {
      allowedPaths: ALLOWED_PATHS,
    }),
    (error) => (
      error instanceof GitSurveyPublisherError
      && error.code === 'UNEXPECTED_COMMITTED_PATH'
    )
  );
  assert.equal(fixture.state.pushCount, 0);
});
