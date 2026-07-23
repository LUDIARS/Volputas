'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readAnswersFile } = require('./answerFile');

test('readAnswersFile parses an answer object', () => {
  const answers = readAnswersFile('answers.json', {
    cwd: '/work',
    stat: () => ({ isFile: () => true, size: 20 }),
    readFile: () => Buffer.from('{"question":"answer"}', 'utf8'),
  });

  assert.deepEqual(answers, { question: 'answer' });
});

test('readAnswersFile rejects oversized input before reading it', () => {
  assert.throws(
    () => readAnswersFile('answers.json', {
      stat: () => ({ isFile: () => true, size: 21 }),
      readFile: () => {
        throw new Error('must not be called');
      },
      maxBytes: 20,
    }),
    /exceeds/
  );
});

test('readAnswersFile does not expose a rejected path through stat errors', () => {
  const sensitivePath = '{"favorite-titles":"secret game"}';

  assert.throws(
    () => readAnswersFile(sensitivePath, {
      stat: () => {
        throw new Error(`ENOENT: ${sensitivePath}`);
      },
    }),
    (error) => {
      assert.equal(error.message, 'Answers file is unavailable');
      assert.doesNotMatch(error.message, /secret game|favorite-titles/);
      return true;
    }
  );
});

test('readAnswersFile rejects non-object JSON roots', () => {
  assert.throws(
    () => readAnswersFile('answers.json', {
      stat: () => ({ isFile: () => true, size: 2 }),
      readFile: () => Buffer.from('[]', 'utf8'),
    }),
    /root must be an object/
  );
});

test('readAnswersFile rejects malformed UTF-8 without exposing answer bytes', () => {
  const invalidBytes = Buffer.from([
    0x7b, 0x22, 0x71, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d,
  ]);

  assert.throws(
    () => readAnswersFile('answers.json', {
      stat: () => ({ isFile: () => true, size: invalidBytes.length }),
      readFile: () => invalidBytes,
    }),
    (error) => {
      assert.equal(error.message, 'Answers file is not valid UTF-8 JSON');
      assert.doesNotMatch(error.message, /q|Ã|\(/);
      return true;
    }
  );
});
