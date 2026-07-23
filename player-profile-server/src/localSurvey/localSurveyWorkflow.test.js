'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runLocalSurveyWorkflow } = require('./localSurveyWorkflow');

const DEFINITION = {
  id: 'gamer-preferences',
  version: '1.0.0',
  title: 'Survey',
  description: 'Description',
  questions: [
    {
      id: 'choice',
      type: 'choice',
      text: 'Choose',
      options: [{ value: 'yes', label: 'Yes' }],
    },
  ],
};

const CONFIG = {
  dataRepositoryRoot: '/private/data',
  expectedRemoteUrl: 'https://github.com/LUDIARS/Voluptas-Data.git',
  remote: 'origin',
  baseBranch: 'main',
  responseBranchPrefix: 'responses/github-',
  gitCommand: 'git',
};

function testDependencies(events) {
  return {
    runner: { run() {} },
    validateAnswers: (answers) => {
      events.push('validate');
      return answers;
    },
    renderDefinition: () => {
      events.push('render-definition');
      return 'definition';
    },
    renderResponse: () => {
      events.push('render-response');
      return 'response';
    },
    publisherFactory: () => ({
      prepare: async (_identity, options) => {
        events.push(`prepare:${options.offline}`);
        return { branch: 'responses/github-42' };
      },
      publish: async () => {
        events.push('publish');
        return {
          status: 'published',
          branch: 'responses/github-42',
          change: 'committed',
          commitSha: 'abcdef1',
          pushed: true,
        };
      },
    }),
    lockFactory: () => ({
      runExclusive: async (operation) => {
        events.push('lock');
        const result = await operation();
        events.push('unlock');
        return result;
      },
    }),
    writeArtifacts: ({ definitionDocument, responseDocument }) => {
      events.push(`write:${definitionDocument}:${responseDocument}`);
      return {
        relativePaths: [
          'surveys/gamer-preferences.md',
          'responses/github-42/gamer-preferences.md',
        ],
      };
    },
  };
}

test('runLocalSurveyWorkflow prepares, writes, commits, and pushes under one lock', async () => {
  const events = [];
  const result = await runLocalSurveyWorkflow({
    answers: { choice: 'yes' },
    config: CONFIG,
    definition: DEFINITION,
    identity: { id: '42', login: 'player' },
    producerRevision: 'abcdef1',
    saveOnly: false,
    timestamp: '2026-07-23T00:00:00.000Z',
  }, testDependencies(events));

  assert.deepEqual(events, [
    'validate',
    'render-definition',
    'render-response',
    'lock',
    'prepare:false',
    'write:definition:response',
    'publish',
    'unlock',
  ]);
  assert.equal(result.status, 'published');
  assert.equal(result.commitSha, 'abcdef1');
});

test('runLocalSurveyWorkflow leaves generated files unstaged in save-only mode', async () => {
  const events = [];
  const result = await runLocalSurveyWorkflow({
    answers: { choice: 'yes' },
    config: CONFIG,
    definition: DEFINITION,
    identity: { id: '42', login: 'player' },
    producerRevision: 'abcdef1',
    saveOnly: true,
    timestamp: '2026-07-23T00:00:00.000Z',
  }, testDependencies(events));

  assert.equal(result.status, 'saved');
  assert.ok(events.includes('prepare:true'));
  assert.ok(!events.includes('publish'));
});
