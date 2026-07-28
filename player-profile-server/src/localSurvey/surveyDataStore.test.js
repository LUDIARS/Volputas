'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  atomicWrite,
  surveyArtifactPaths,
  writeSurveyArtifacts,
} = require('./surveyDataStore');

test('surveyArtifactPaths uses immutable GitHub ID rather than mutable login', () => {
  assert.deepEqual(
    surveyArtifactPaths({ surveyId: 'gamer-preferences', identityId: '42424242' }),
    {
      definition: 'surveys/gamer-preferences.md',
      response: 'responses/github-42424242/gamer-preferences.md',
    }
  );
});

test('surveyArtifactPaths rejects path traversal input', () => {
  assert.throws(
    () => surveyArtifactPaths({ surveyId: '../secret', identityId: '1' }),
    /kebab-case/
  );
  assert.throws(
    () => surveyArtifactPaths({ surveyId: 'safe', identityId: '../1' }),
    /positive decimal/
  );
});

test('writeSurveyArtifacts writes only the definition and stable response path', () => {
  const writes = [];
  const result = writeSurveyArtifacts({
    root: path.resolve('/private/data'),
    surveyId: 'gamer-preferences',
    identity: { id: '42', login: 'player' },
    definitionDocument: 'definition\r\n',
    responseDocument: 'response\n\n',
    writeAtomic: (target, content) => writes.push({ target, content }),
    ensureDirectory: () => undefined,
  });

  assert.deepEqual(result.relativePaths, [
    'surveys/gamer-preferences.md',
    'responses/github-42/gamer-preferences.md',
  ]);
  assert.deepEqual(
    writes.map(({ content }) => content),
    ['definition\n', 'response\n']
  );
  assert.match(writes[1].target, /responses[\\/]github-42[\\/]gamer-preferences\.md$/);
});

test('writeSurveyArtifacts rejects a linked response directory before writing', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voluptas-store-'));
  const repositoryRoot = path.join(fixtureRoot, 'repository');
  const outsideRoot = path.join(fixtureRoot, 'outside');
  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(outsideRoot);
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  try {
    fs.symlinkSync(
      outsideRoot,
      path.join(repositoryRoot, 'responses'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (error && ['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('directory links are unavailable in this environment');
      return;
    }
    throw error;
  }

  assert.throws(
    () => writeSurveyArtifacts({
      root: repositoryRoot,
      surveyId: 'gamer-preferences',
      identity: { id: '42', login: 'player' },
      definitionDocument: 'definition',
      responseDocument: 'sensitive response',
    }),
    /not a regular directory|link or junction/
  );
  assert.equal(fs.existsSync(path.join(repositoryRoot, 'surveys')), true);
  assert.equal(
    fs.existsSync(path.join(repositoryRoot, 'surveys', 'gamer-preferences.md')),
    false
  );
  assert.deepEqual(fs.readdirSync(outsideRoot), []);
});

test('atomicWrite replaces an existing artifact without leaving a temporary file', (t) => {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'voluptas-atomic-write-')
  );
  const target = path.join(repositoryRoot, 'responses', 'answer.md');
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));

  atomicWrite(target, 'first\n', { repositoryRoot });
  atomicWrite(target, 'second\n', { repositoryRoot });

  assert.equal(fs.readFileSync(target, 'utf8'), 'second\n');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['answer.md']);
});

test('atomicWrite removes the temporary artifact when replacement fails', (t) => {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'voluptas-atomic-failure-')
  );
  const target = path.join(repositoryRoot, 'responses', 'answer.md');
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));

  assert.throws(
    () => atomicWrite(target, 'sensitive answer\n', {
      repositoryRoot,
      rename: () => {
        throw new Error('forced replacement failure');
      },
    }),
    /forced replacement failure/
  );
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), []);
});
