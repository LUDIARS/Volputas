const test = require('node:test');
const assert = require('node:assert/strict');
const { answeredSentiment } = require('./answeredSentiment');
const { collectMechanicReactions, mechanicAversionEvidence } = require('./mechanicReactions');
const { voiceContributions } = require('./sourceContributions');
const { analyzePersona } = require('../personaEvidenceAnalysis');

test('unanswered sentiment is null, explicit neutral is 0', () => {
  assert.equal(answeredSentiment({ sentiment: null }), null);
  assert.equal(answeredSentiment({}), null);
  assert.equal(answeredSentiment({ sentiment: 0 }), 0);
  assert.equal(answeredSentiment({ sentiment: -2 }), -2);
});

test('mechanic reactions skip unanswered voices without polarity but keep neutral and polarity', () => {
  const reactions = collectMechanicReactions([
    { id: 'a', sentiment: null, mechanicIds: ['action/jump'] },
    { id: 'b', sentiment: 0, mechanicIds: ['action/jump'] },
    { id: 'c', sentiment: null, polarity: 'dislike', mechanicIds: ['action/dash'] },
  ]);
  const jump = reactions.find((item) => item.mechanicId === 'action/jump');
  assert.equal(jump.samples, 1);
  assert.equal(jump.sentiment, 0);
  assert.equal(reactions.find((item) => item.mechanicId === 'action/dash').sentiment, -1);
  assert.equal(mechanicAversionEvidence([
    { id: 'c', sentiment: null, polarity: 'dislike', mechanicIds: ['action/dash'] },
  ])[0].strength, 0.5);
});

test('voice contributions add no emotional signal for an unanswered slider', () => {
  const unanswered = voiceContributions({ id: 'v', sentiment: null, comment: 'ふつう' });
  const neutral = voiceContributions({ id: 'v', sentiment: 0, comment: 'ふつう' });
  const fields = (result) => result.contributions.map((item) => item.source?.field);
  assert.equal(fields(unanswered).includes('sentiment'), false);
  assert.equal(fields(neutral).includes('sentiment'), true);
});

test('v1 analysis does not count an unanswered voice as neutral engagement', () => {
  const base = { gameplay: [], emotionCurves: [], surveys: [] };
  const comment = 'a'.repeat(10);
  const at = '2026-10-09T00:00:00.000Z';
  const unanswered = analyzePersona({ ...base, voices: [{ sentiment: null, comment }] }, at);
  const neutral = analyzePersona({ ...base, voices: [{ sentiment: 0, comment }] }, at);
  assert.equal(unanswered.axes.emotionalEngagement.evidenceWeight, 0);
  assert.equal(neutral.axes.emotionalEngagement.evidenceWeight, 1.5);
  assert.equal(neutral.axes.emotionalEngagement.score, 0);
});
