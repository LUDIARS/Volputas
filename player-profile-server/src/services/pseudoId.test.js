const test = require('node:test');
const assert = require('node:assert/strict');
const { pseudoId } = require('./pseudoId');
const { buildExternalUtterances } = require('./utteranceExport');

test('pseudo id is deterministic and does not expose the SID', () => {
  const sid = '6a9ecf3b-834d-4b8d-8844-89ca813dbcc9';
  const first = pseudoId(sid, 'test-secret');
  assert.equal(first, pseudoId(sid, 'test-secret'));
  assert.match(first, /^ext:voluptas:[0-9a-f]{16}$/);
  assert.equal(first.includes(sid), false);
});

test('utterance export excludes SID, email and IdP subject', () => {
  const sid = '6a9ecf3b-834d-4b8d-8844-89ca813dbcc9';
  const output = buildExternalUtterances([{
    response_id: 'response-1',
    survey_id: 'survey-1',
    user_id: sid,
    submitted_at: '2026-07-12T00:00:00.000Z',
    locale: 'ja',
    questions: [{ id: 'comment', type: 'freetext', gameSlug: 'sample' }],
    answers: { comment: '難しいけど楽しい' },
  }], 'test-secret');
  const serialized = JSON.stringify(output);
  assert.equal(output.length, 1);
  assert.equal(serialized.includes(sid), false);
  assert.equal(serialized.includes('@'), false);
  assert.match(output[0].authorId, /^ext:voluptas:/);
});
