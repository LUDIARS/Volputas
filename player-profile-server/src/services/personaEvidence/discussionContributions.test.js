const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceContributions } = require('./sourceContributions');

test('discussion evidence uses the Di source id and distinct provenance kind', () => {
  const result = voiceContributions({
    id: 'local-record-id',
    sourceKind: 'discussion',
    sourceRef: 'di-utterance-id',
    scopeType: 'content',
    sentiment: 0,
    comment: 'I reflected on the story and characters.',
    tags: ['discussion'],
  });
  const sources = result.contributions.map((item) => item.source);
  assert.equal(sources.length > 0, true);
  assert.equal(sources.every((source) => source.kind === 'discussion'), true);
  assert.equal(sources.every((source) => source.id === 'di-utterance-id'), true);
});
