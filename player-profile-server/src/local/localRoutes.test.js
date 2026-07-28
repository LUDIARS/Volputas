const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLocalApp } = require('../localApp');

test('reports Git PATH status and derives the answer folder Name from Git Author', async (t) => {
  const repositoryRoot = path.resolve('VolputasData');
  let savedConfig;
  const gitStatus = { available: true, version: 'git version 2.50.0' };
  const gitAuthor = {
    repositoryRoot,
    name: 'k.mitarai',
    email: 'author@example.test',
    remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
  };
  const app = createLocalApp({
    serveFrontend: false,
    configStore: {
      read: async () => null,
      write: async (config) => {
        savedConfig = config;
        return config;
      },
    },
    gitCli: {
      inspect: async () => gitStatus,
      assertAvailable: async () => gitStatus,
    },
    gitAuthorReader: {
      read: async (requestedPath) => {
        assert.equal(requestedPath, repositoryRoot);
        return gitAuthor;
      },
    },
    responseStore: {},
    surveyDefinitionStore: {
      list: async (requestedPath) => {
        assert.equal(requestedPath, repositoryRoot);
        return [{ id: 'gamer-preference' }, { id: 'gamer-subtypes' }];
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const environment = await fetch(`${origin}/api/local/environment`).then((response) =>
    response.json());
  assert.deepEqual(environment.data.git, gitStatus);

  const runtime = await fetch(`${origin}/api/runtime`).then((response) => response.json());
  assert.deepEqual(runtime.data, { mode: 'local', authentication: 'none' });

  const configured = await fetch(`${origin}/api/local/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataRepositoryPath: repositoryRoot, name: 'ignored-input' }),
  }).then((response) => response.json());

  assert.equal(configured.ok, true);
  assert.equal(savedConfig.name, gitAuthor.name);
  assert.equal(configured.data.config.name, gitAuthor.name);
  assert.deepEqual(configured.data.surveys, {
    count: 2,
    ids: ['gamer-preference', 'gamer-subtypes'],
  });
});

test('synchronizes an existing config Name when Git Author changes', async (t) => {
  const repositoryRoot = path.resolve('VolputasData');
  let savedConfig;
  const app = createLocalApp({
    serveFrontend: false,
    configStore: {
      read: async () => ({
        schemaVersion: 2,
        dataRepositoryPath: repositoryRoot,
        name: 'old-author',
      }),
      write: async (config) => {
        savedConfig = config;
        return config;
      },
    },
    gitAuthorReader: {
      read: async () => ({
        repositoryRoot,
        name: 'current-author',
        email: 'current@example.test',
        remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
      }),
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const payload = await fetch(`http://127.0.0.1:${port}/api/local/config`)
    .then((response) => response.json());

  assert.equal(payload.ok, true);
  assert.equal(payload.data.config.name, 'current-author');
  assert.equal(savedConfig.name, 'current-author');
});

test('publishes a local survey response before reporting save success', async (t) => {
  const repositoryRoot = path.resolve('VolputasData');
  const responseFilePath = path.join(repositoryRoot, 'answers', 'Neco', 'sample.json');
  const survey = {
    id: 'sample',
    title: 'Sample survey',
    questions: [{ id: 'choice', text: 'Choose', type: 'choice', options: ['yes'] }],
  };
  let publishInput;
  const app = createLocalApp({
    serveFrontend: false,
    configStore: {
      read: async () => ({
        schemaVersion: 2,
        dataRepositoryPath: repositoryRoot,
        name: 'Neco',
      }),
      write: async (config) => config,
    },
    gitAuthorReader: {
      read: async () => ({
        repositoryRoot,
        name: 'Neco',
        email: 'neco@example.test',
        remoteUrl: 'https://github.com/neco/VolputasData.git',
      }),
    },
    responseStore: {
      write: async () => ({
        filePath: responseFilePath,
        response: { updatedAt: '2026-07-27T00:00:00.000Z' },
      }),
    },
    surveyDefinitionStore: {
      find: async () => survey,
    },
    surveyPublisher: {
      publish: async (input) => {
        publishInput = input;
        return {
          committed: true,
          pushed: true,
          commit: 'abc1234',
          pathspec: 'answers/Neco/sample.json',
        };
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/local/surveys/sample/response`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: { choice: 'yes' } }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(publishInput, {
    repositoryRoot,
    responseFilePath,
    surveyId: 'sample',
  });
  assert.equal(payload.data.gitSync.commit, 'abc1234');
  assert.equal(payload.data.gitSync.pushed, true);
});
