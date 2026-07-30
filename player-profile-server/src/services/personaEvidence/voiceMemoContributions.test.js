const test = require('node:test');
const assert = require('node:assert/strict');
const { validateVoiceMemoInput } = require('../profileEvidenceSchemas');
const { VoiceMemoTranscriber } = require('../voiceMemoTranscriber');
const { countUserEvidence } = require('./evidenceCount');
const { collectMechanicReactions, mechanicAversionEvidence } = require('./mechanicReactions');
const { voiceMemoContributions } = require('./sourceContributions');

test('voice memo input permits media-only records before manual transcription', () => {
  const memo = validateVoiceMemoInput({
    gameTitle: 'Example',
    audioFileName: 'memo.webm',
    durationSeconds: 12,
    transcript: '',
  });
  assert.equal(memo.transcript, '');
  assert.equal(memo.durationSeconds, 12);
  assert.equal(countUserEvidence({ voiceMemos: [memo] }), 0);
  assert.deepEqual(voiceMemoContributions(memo), {
    contributions: [],
    aversionEvidence: [],
  });
  assert.deepEqual(collectMechanicReactions([], [memo]), []);
});

test('a transcript follows the voice evidence path with voicememo provenance', () => {
  const memo = validateVoiceMemoInput({
    gameTitle: 'Example',
    audioFileName: 'memo.webm',
    durationSeconds: 8,
    transcript: '友達との協力プレイは楽しいが、ガチャは苦手',
    sentiment: -2,
    polarity: 'dislike',
    mechanicIds: ['Core/Gacha'],
  });
  const result = voiceMemoContributions({ id: 'memo-1', ...memo });
  assert.ok(result.contributions.length > 0);
  assert.ok(result.contributions.every((item) => item.source.kind === 'voicememo'));
  assert.ok(result.contributions.some((item) => item.source.field === 'transcript'));
  assert.ok(!result.contributions.some((item) => item.source.field === 'comment'));
  assert.equal(countUserEvidence({ voiceMemos: [memo] }), 1);

  assert.deepEqual(collectMechanicReactions([], [{ id: 'memo-1', ...memo }]), [{
    mechanicId: 'core/gacha',
    sentiment: -2,
    samples: 1,
    sources: ['voicememo:memo-1'],
  }]);
  assert.deepEqual(mechanicAversionEvidence([], [{ id: 'memo-1', ...memo }]), [{
    target: 'mechanic:core/gacha',
    strength: 1,
    source: { kind: 'voicememo', id: 'memo-1', field: 'mechanicIds' },
  }]);
});

test('default transcriber exposes the pluggable boundary without automatic STT', async () => {
  await assert.rejects(
    new VoiceMemoTranscriber().transcribe({ filePath: 'memo.webm' }),
    (error) =>
      error.code === 'VOICE_MEMO_TRANSCRIBER_UNAVAILABLE'
      && error.statusCode === 501
  );
});
