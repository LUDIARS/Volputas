const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmotionCurveDraft } = require('./emotionCurveDraft');
const { validateEmotionCurveInput } = require('../profileEvidenceSchemas');

const RECORD = {
  id: 'session-1',
  gameTitle: 'Elden Ring',
  status: 'completed',
  startedAt: '2026-08-13T00:00:00.000Z',
  endedAt: '2026-08-13T00:30:00.000Z',
  markers: [
    { sessionMs: 60000, origin: 'companion', type: 'hype', label: '' },
    { sessionMs: 90000, origin: 'game', type: 'event', label: 'boss' },
    { sessionMs: 120000, origin: 'desktop', type: 'stress', label: '操作ミス' },
  ],
};

const ANALYSIS = {
  utterances: [
    { sessionMs: 30000, text: 'ここ最高だ！', valence: 2, arousal: 4 },
    { sessionMs: 150000, text: 'うわ、死んだ…', valence: -1, arousal: 3 },
  ],
};

test('markers become stamp entries and utterances become comment entries', () => {
  const draft = buildEmotionCurveDraft({ record: RECORD, analysis: ANALYSIS });
  assert.equal(draft.mode, 'capture');
  assert.equal(draft.captureSessionId, 'session-1');
  assert.equal(draft.sessionPlaytimeMinutes, 30);
  // The `event` marker is a milestone, not an emotion — it must not become a stamp.
  assert.deepEqual(draft.entries.map((entry) => entry.timeSeconds), [30, 60, 120, 150]);
  assert.deepEqual(draft.entries[1], { timeSeconds: 60, stamp: 'hype', comment: '' });
  assert.deepEqual(draft.entries[0], {
    timeSeconds: 30, comment: 'ここ最高だ！', valence: 2, arousal: 4,
  });
});

test('the draft passes the shared emotion-curve validation as-is', () => {
  const validated = validateEmotionCurveInput(
    buildEmotionCurveDraft({ record: RECORD, analysis: ANALYSIS })
  );
  assert.equal(validated.mode, 'capture');
  assert.equal(validated.captureSessionId, 'session-1');
  assert.equal(validated.videoFileName, '');
  assert.equal(validated.entries.length, 4);
  // Stamp defaults fill valence/arousal for the tap-only entry.
  const stampEntry = validated.entries.find((entry) => entry.stamp === 'hype');
  assert.equal(stampEntry.valence, 2);
  assert.equal(stampEntry.arousal, 5);
});

test('a session with nothing to plot is refused', () => {
  assert.throws(
    () => buildEmotionCurveDraft({
      record: { ...RECORD, markers: [{ sessionMs: 0, origin: 'game', type: 'event', label: 'x' }] },
      analysis: null,
    }),
    /neither markers nor transcribed utterances/
  );
});

test('capture-mode records require their source session identity', () => {
  assert.throws(
    () => validateEmotionCurveInput({ gameTitle: 'Elden Ring', mode: 'capture', entries: ANALYSIS.utterances }),
    /Capture session id is required/
  );
});
