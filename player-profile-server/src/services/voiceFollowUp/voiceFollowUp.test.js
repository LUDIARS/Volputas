const test = require('node:test');
const assert = require('node:assert/strict');
const { nextFollowUpQuestion } = require('./followUpQuestions');
const { applyFollowUpAnswer } = require('./applyFollowUpAnswer');
const { validateVoiceInput } = require('../profileEvidenceSchemas');

const LONG_COMMENT = '序盤の探索が楽しく、マップの作り込みが丁寧で、寄り道するたびに新しい発見があったのが一番良かったです。'
  + '操作も軽快で、ボス戦の手応えもちょうど良く、最後まで飽きずに遊べました。';

function savedVoice(overrides = {}) {
  return {
    id: 'v1',
    ...validateVoiceInput({ gameTitle: 'Sample', comment: 'よかった', playProgress: 'early' }),
    ...overrides,
  };
}

function answerAll(record, answers) {
  let current = record;
  for (const body of answers) current = { ...current, ...applyFollowUpAnswer(current, body) };
  return current;
}

test('first save keeps title, comment and progress; unanswered sentiment stays null', () => {
  const voice = validateVoiceInput({ gameTitle: 'Sample', comment: 'よかった', playProgress: 'middle' });
  assert.equal(voice.playProgress, 'middle');
  assert.equal(voice.sentiment, null);
  assert.equal(validateVoiceInput({ gameTitle: 'S', comment: 'c', sentiment: '0' }).sentiment, 0);
  assert.throws(() => validateVoiceInput({ gameTitle: 'S', comment: 'c', playProgress: 'ending' }),
    /Unknown play progress/);
});

test('the long fixture comment is long enough to skip the reason question', () => {
  assert.ok(LONG_COMMENT.length >= 60);
});

test('asks only missing information, one question at a time', () => {
  assert.equal(nextFollowUpQuestion(savedVoice()).id, 'sentiment');
  assert.equal(nextFollowUpQuestion(savedVoice({ playProgress: null })).id, 'playProgress');
  const complete = savedVoice({ sentiment: 1, polarity: 'like', comment: LONG_COMMENT });
  assert.equal(nextFollowUpQuestion(complete).id, 'highlight');
});

test('a sufficient record has no next question', () => {
  const record = answerAll(
    savedVoice({ sentiment: 0, polarity: 'dislike', comment: LONG_COMMENT }),
    [{ questionId: 'highlight', answer: '最初のボス戦' }]
  );
  assert.equal(nextFollowUpQuestion(record), null);
});

test('never asks about ranges the player has not reached', () => {
  const settled = [{ questionId: 'highlight', skip: true }];
  const early = answerAll(
    savedVoice({ sentiment: 1, polarity: 'like', comment: LONG_COMMENT }),
    settled
  );
  assert.equal(nextFollowUpQuestion(early), null);
  const cleared = answerAll(
    savedVoice({ sentiment: 1, polarity: 'like', comment: LONG_COMMENT, playProgress: 'cleared' }),
    settled
  );
  assert.equal(nextFollowUpQuestion(cleared).id, 'ending');
  assert.throws(() => applyFollowUpAnswer(early, { questionId: 'ending', answer: 'x' }),
    (error) => error.code === 'FOLLOW_UP_NOT_OPEN');
});

test('answers fill structured fields and keep the original comment and answer text', () => {
  const now = new Date('2026-10-09T00:00:00Z');
  const record = savedVoice();
  const patch = applyFollowUpAnswer(record, { questionId: 'sentiment', answer: '0' }, now);
  assert.equal(patch.sentiment, 0);
  assert.equal(patch.comment, undefined);
  assert.deepEqual(patch.followUps, [
    { questionId: 'sentiment', answer: '0', answeredAt: now.toISOString() },
  ]);
  const neither = applyFollowUpAnswer({ ...record, ...patch }, { questionId: 'polarity', answer: 'neither' });
  assert.equal(Object.hasOwn(neither, 'polarity'), false);
  assert.equal(neither.followUps.at(-1).answer, 'neither');
});

test('skip and resume: a skipped question is not asked again', () => {
  const skipped = answerAll(savedVoice(), [{ questionId: 'sentiment', skip: true }]);
  assert.deepEqual(skipped.skippedFollowUps, ['sentiment']);
  assert.equal(skipped.sentiment, null);
  assert.equal(nextFollowUpQuestion(skipped).id, 'polarity');
});

test('rejects unknown questions, invalid choices and empty text', () => {
  const record = savedVoice({ sentiment: 1, polarity: 'like' });
  assert.throws(() => applyFollowUpAnswer(record, { questionId: 'nope', answer: 'x' }), /Unknown follow-up/);
  assert.throws(() => applyFollowUpAnswer(savedVoice(), { questionId: 'sentiment', answer: '3' }),
    /Unknown answer/);
  assert.throws(() => applyFollowUpAnswer(record, { questionId: 'reason', answer: '  ' }),
    /Answer text is required/);
});
