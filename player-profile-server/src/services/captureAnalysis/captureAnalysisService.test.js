const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptureAnalysisService } = require('./captureAnalysisService');

const CONTEXT = { repositoryRoot: '/repo', name: 'tester' };

function fakeCaptureSessionService(record, { audio = { filePath: '/media/a.webm' } } = {}) {
  return {
    saved: null,
    async findRecord() { return record; },
    async resolveAudio() { return audio; },
    async saveAnalysis(_context, _sessionId, analysis) {
      this.saved = analysis;
      return { ...record, analysis };
    },
  };
}

function createService(record, overrides = {}) {
  const captureSessionService = fakeCaptureSessionService(record, overrides);
  const service = new CaptureAnalysisService({
    captureSessionService,
    sttClient: overrides.sttClient || {
      baseUrl: 'http://127.0.0.1:1',
      async transcribeWavFile() {
        return [
          { startMs: 1000, endMs: 2000, text: '最高に楽しい！' },
          { startMs: 5000, endMs: 6000, text: 'ドアを開けた' },
        ];
      },
    },
    wavConverter: overrides.wavConverter || {
      ffmpegPath: 'ffmpeg',
      async withWav(_inputPath, use) { return use('/tmp/fake.wav'); },
    },
    now: () => new Date('2026-08-13T01:00:00.000Z'),
  });
  return { service, captureSessionService };
}

const COMPLETED_RECORD = {
  id: 's1',
  status: 'completed',
  capture: { audioFileName: 's1.webm', audioStartSessionMs: 10000 },
};

test('utterances land on the session clock with affect and provenance', async () => {
  const { service, captureSessionService } = createService(COMPLETED_RECORD);
  const record = await service.analyze(CONTEXT, 's1');
  const analysis = captureSessionService.saved;
  assert.equal(record.analysis, analysis);
  assert.equal(analysis.extractor, 'whisper-stt+sentiment-lexicon');
  assert.equal(analysis.analyzedAt, '2026-08-13T01:00:00.000Z');
  assert.equal(analysis.utteranceCount, 2);
  assert.deepEqual(
    analysis.utterances.map((utterance) => utterance.sessionMs),
    [11000, 15000]
  );
  assert.ok(analysis.utterances[0].valence > 0);
  assert.equal(typeof analysis.utterances[1].arousal, 'number');
});

test('recording, audio-less, and unanchored sessions are refused with specific codes', async () => {
  const recording = createService({ ...COMPLETED_RECORD, status: 'recording' });
  await assert.rejects(recording.service.analyze(CONTEXT, 's1'), /Stop the capture session/);

  const audioless = createService(COMPLETED_RECORD, { audio: null });
  await assert.rejects(audioless.service.analyze(CONTEXT, 's1'), /no uploaded audio/);

  const unanchored = createService({
    ...COMPLETED_RECORD,
    capture: { audioFileName: 's1.webm', audioStartSessionMs: null },
  });
  await assert.rejects(unanchored.service.analyze(CONTEXT, 's1'), (error) => {
    assert.equal(error.code, 'CAPTURE_AUDIO_UNANCHORED');
    return true;
  });
});

test('status reports the configured backends for the UI', () => {
  const { service } = createService(COMPLETED_RECORD);
  assert.deepEqual(service.status(), {
    stt: { configured: true },
    ffmpeg: { command: 'ffmpeg' },
  });
});

test('analysis does not persist the configured STT endpoint', async () => {
  const { service, captureSessionService } = createService(COMPLETED_RECORD);
  await service.analyze(CONTEXT, 's1');
  assert.equal(Object.hasOwn(captureSessionService.saved, 'sttUrl'), false);
});
