'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { collectInteractiveAnswers } = require('./interactiveSurvey');

test('collectInteractiveAnswers maps numbered choices and free text by question ID', async () => {
  const responses = ['2', 'A favorite game'];
  let responseIndex = 0;
  let closed = false;
  const output = { write() {} };
  const answers = await collectInteractiveAnswers([
    {
      id: 'choice',
      type: 'choice',
      text: 'Choose',
      options: [
        { value: 'one', label: 'One' },
        { value: 'two', label: 'Two' },
      ],
    },
    {
      id: 'text',
      type: 'freetext',
      text: 'Describe',
    },
  ], {
    input: {},
    output,
    createInterface: () => ({
      question: async () => responses[responseIndex++],
      close: () => {
        closed = true;
      },
    }),
  });

  assert.deepEqual(answers, { choice: 'two', text: 'A favorite game' });
  assert.equal(closed, true);
});

test('collectInteractiveAnswers retries invalid numbered choices', async () => {
  const responses = ['x', '0', '1'];
  let responseIndex = 0;
  const messages = [];
  const answers = await collectInteractiveAnswers([
    {
      id: 'choice',
      type: 'choice',
      text: 'Choose',
      options: [{ value: 'one', label: 'One' }],
    },
  ], {
    input: {},
    output: { write: (message) => messages.push(message) },
    createInterface: () => ({
      question: async () => responses[responseIndex++],
      close() {},
    }),
  });

  assert.deepEqual(answers, { choice: 'one' });
  assert.equal(messages.filter((message) => message.includes('1〜1')).length, 2);
});
