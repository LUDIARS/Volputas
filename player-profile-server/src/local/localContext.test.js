const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfiguredContext } = require('./localContext');

test('shared local context follows each company repository when settings change', async () => {
  let dataRepositoryPath = '/company-a';
  const checked = [];
  const configuredContext = createConfiguredContext({
    configStore: { read: async () => ({ dataRepositoryPath, name: 'respondent' }) },
    gitAuthorReader: {
      read: async (root) => ({
        name: 'respondent',
        repositoryRoot: root,
        remoteUrl: `git@github.com:${root.slice(1)}/research.git`,
      }),
    },
    dataRepositoryVisibilityChecker: { assertPrivate: async (repo) => checked.push(repo) },
  });

  assert.equal((await configuredContext()).gitAuthor.repositoryRoot, '/company-a');
  dataRepositoryPath = '/company-b';
  assert.equal((await configuredContext()).gitAuthor.repositoryRoot, '/company-b');
  assert.deepEqual(checked, ['company-a/research', 'company-b/research']);
});

test('shared local context rejects non-private repositories before refreshing saved identity', async () => {
  let writes = 0;
  const rejection = Object.assign(new Error('Repository is public'), {
    code: 'DATA_REPOSITORY_NOT_PRIVATE',
  });
  const configuredContext = createConfiguredContext({
    configStore: {
      read: async () => ({ dataRepositoryPath: '/company', name: 'old-name' }),
      write: async () => { writes += 1; },
    },
    gitAuthorReader: {
      read: async () => ({ name: 'new-name', remoteUrl: 'https://github.com/company/data.git' }),
    },
    dataRepositoryVisibilityChecker: { assertPrivate: async () => { throw rejection; } },
  });

  await assert.rejects(configuredContext(), (error) => error === rejection);
  assert.equal(writes, 0);
});
