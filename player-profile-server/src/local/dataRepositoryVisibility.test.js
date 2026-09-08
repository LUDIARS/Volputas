const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DataRepositoryVisibilityChecker,
  DataRepositoryVisibilityError,
} = require('./dataRepositoryVisibility');

function jsonRunner(metadata) {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      return { stdout: JSON.stringify(metadata) };
    },
  };
}

test('assertPrivate accepts a private repository', async () => {
  const { run, calls } = jsonRunner({
    fullName: 'acme/volputas-data',
    private: true,
    visibility: 'private',
  });
  const checker = new DataRepositoryVisibilityChecker({ runGithub: run });

  const result = await checker.assertPrivate('acme/volputas-data');

  assert.deepEqual(result, {
    fullName: 'acme/volputas-data',
    isPrivate: true,
    visibility: 'private',
  });
  assert.deepEqual(calls[0], [
    'api',
    'repos/acme/volputas-data',
    '--jq',
    '{fullName: .full_name, private: .private, visibility: .visibility}',
  ]);
});

test('assertPrivate fails closed for a public repository', async () => {
  const { run } = jsonRunner({
    fullName: 'acme/volputas-data',
    private: false,
    visibility: 'public',
  });
  const checker = new DataRepositoryVisibilityChecker({ runGithub: run });

  await assert.rejects(
    () => checker.assertPrivate('acme/volputas-data'),
    (error) => {
      assert.ok(error instanceof DataRepositoryVisibilityError);
      assert.equal(error.code, 'DATA_REPOSITORY_NOT_PRIVATE');
      assert.match(error.message, /is not private/);
      assert.match(error.message, /visibility: public/);
      return true;
    }
  );
});

test('assertPrivate rejects an internal repository even though private is true', async () => {
  const { run } = jsonRunner({
    fullName: 'acme/volputas-data',
    private: true,
    visibility: 'internal',
  });
  const checker = new DataRepositoryVisibilityChecker({ runGithub: run });

  await assert.rejects(
    () => checker.assertPrivate('acme/volputas-data'),
    { code: 'DATA_REPOSITORY_NOT_PRIVATE' }
  );
});

test('assertPrivate does not expose malformed GitHub CLI output', async () => {
  const checker = new DataRepositoryVisibilityChecker({
    runGithub: async () => ({ stdout: 'not json' }),
  });

  await assert.rejects(
    () => checker.assertPrivate('acme/volputas-data'),
    (error) => {
      assert.ok(error instanceof DataRepositoryVisibilityError);
      assert.match(error.message, /invalid repository visibility metadata/);
      return true;
    }
  );
});

test('assertPrivate reports an actionable message when the GitHub CLI call fails', async () => {
  const checker = new DataRepositoryVisibilityChecker({
    runGithub: async () => {
      throw new Error('exit status 4');
    },
  });

  await assert.rejects(
    () => checker.assertPrivate('acme/volputas-data'),
    (error) => {
      assert.ok(error instanceof DataRepositoryVisibilityError);
      assert.match(error.message, /gh auth login/);
      return true;
    }
  );
});

test('assertPrivate memoizes a successful check within the verification window', async () => {
  const { run, calls } = jsonRunner({
    fullName: 'acme/volputas-data',
    private: true,
    visibility: 'private',
  });
  const checker = new DataRepositoryVisibilityChecker({ runGithub: run });

  await checker.assertPrivate('acme/volputas-data');
  await checker.assertPrivate('acme/volputas-data');
  await checker.assertPrivate('Acme/Volputas-Data');

  assert.equal(calls.length, 1);
});

// A desktop app stays open for days: a repository turned public after the first check
// has to be refused again, not trusted for the rest of the process run.
test('assertPrivate re-verifies once the cached result expires', async () => {
  let clock = 1_000;
  let call = 0;
  const checker = new DataRepositoryVisibilityChecker({
    now: () => clock,
    ttlMs: 60_000,
    runGithub: async () => {
      call += 1;
      return {
        stdout: JSON.stringify({
          fullName: 'acme/volputas-data',
          private: call === 1,
          visibility: call === 1 ? 'private' : 'public',
        }),
      };
    },
  });

  await checker.assertPrivate('acme/volputas-data');
  clock += 59_000;
  await checker.assertPrivate('acme/volputas-data');
  assert.equal(call, 1, 'a fresh result must be reused');

  clock += 2_000;
  await assert.rejects(
    () => checker.assertPrivate('acme/volputas-data'),
    { code: 'DATA_REPOSITORY_NOT_PRIVATE' }
  );
  assert.equal(call, 2);
});

test('assertPrivate retries after a failed check instead of caching the rejection', async () => {
  let call = 0;
  const checker = new DataRepositoryVisibilityChecker({
    runGithub: async () => {
      call += 1;
      if (call === 1) {
        return {
          stdout: JSON.stringify({
            fullName: 'acme/volputas-data',
            private: false,
            visibility: 'public',
          }),
        };
      }
      return {
        stdout: JSON.stringify({
          fullName: 'acme/volputas-data',
          private: true,
          visibility: 'private',
        }),
      };
    },
  });

  await assert.rejects(() => checker.assertPrivate('acme/volputas-data'));
  const result = await checker.assertPrivate('acme/volputas-data');

  assert.equal(result.isPrivate, true);
  assert.equal(call, 2);
});
