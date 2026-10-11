const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnalysis } = require('./parseAnalysis');
const { voiceSource, sourceRevision } = require('./source');
const { resolveEvidence } = require('./evidence');
const { projectAnalysis } = require('./projection');
const { VoiceAnalysisService } = require('./voiceAnalysisService');

const record = { id: 'voice-1', comment: '最初は退屈。その後、再挑戦して達成感があった。操作は良いが悪いところもある。', sentiment: 0 };
const evidence = (quote = record.comment) => ({ sourceId: 'comment', quote });
const empty = () => ({ observations: [], events: [], order: [], links: [], unclassified: [] });
function observation(id, axisId, value, status = 'observed') {
  return { id, axisId, value, status, eventId: null, evidence: evidence() };
}
function parse(raw) { return parseAnalysis(JSON.stringify(raw), voiceSource(record).sources); }
function service(generate) {
  return new VoiceAnalysisService({ llmClient: { isConfigured: () => true, generate } });
}

test('exact quotations resolve Unicode code-point offsets and require ambiguous occurrences', () => {
  const sources = [{ id: 'comment', text: '🎮楽しい。楽しい' }];
  assert.throws(() => resolveEvidence({ sourceId: 'comment', quote: '楽しい' }, sources));
  assert.deepEqual(resolveEvidence({ sourceId: 'comment', quote: '楽しい', occurrence: 1 }, sources), {
    sourceId: 'comment', quote: '楽しい', startInclusive: 5, endExclusive: 8, coordinate: 'unicode-code-point',
  });
  assert.throws(() => resolveEvidence({ sourceId: 'comment', quote: 'とても楽しい' }, sources));
  assert.throws(() => resolveEvidence({ sourceId: 'other', quote: '楽しい' }, sources));
});

test('mixed appraisal never collapses into neutral; missing and unexperienced have no vector channel', () => {
  const raw = empty();
  raw.observations = [
    observation('p', 'appraisal.controls', 'positive'), observation('n', 'appraisal.controls', 'negative'),
    observation('n2', 'appraisal.controls', 'negative'), observation('u', 'd.cooperate', null, 'not_experienced'),
    observation('z', 'appraisal.story', 'neutral'),
  ];
  const result = projectAnalysis(parse(raw));
  assert.equal(result.axes.find((item) => item.axisId === 'appraisal.controls').mixed, true);
  assert.deepEqual(result.axes.find((item) => item.axisId === 'appraisal.story').categories, ['neutral']);
  assert.deepEqual(result.axes.find((item) => item.axisId === 'emotion.joy').states, ['not_mentioned']);
  assert.deepEqual(result.axes.find((item) => item.axisId === 'd.cooperate').states, ['not_experienced']);
  assert.equal(result.vector.indices.length, 3);
  assert.ok(!result.vector.observedAxisIds.includes('d.cooperate'));
});

test('unknown axes, invalid missing values and fabricated quotes are rejected', () => {
  for (const item of [observation('o', 'unknown.axis', 'present'),
    observation('o', 'a.mastery', 'present', 'not_experienced'),
    { ...observation('o', 'a.mastery', 'present'), evidence: evidence('捏造された引用') }]) {
    assert.throws(() => parse({ ...empty(), observations: [item] }), { code: 'VOICE_ANALYSIS_INVALID_RESPONSE' });
  }
});

test('temporal edges require evidence and cannot manufacture order, duration or intensity', () => {
  const raw = empty();
  raw.events = ['e1', 'e2'].map((id, index) => ({
    id, label: id, evidence: evidence(), valence: index ? 'positive' : 'negative', valenceEvidence: evidence(),
  }));
  const unknown = projectAnalysis(parse(raw));
  assert.equal(unknown.arc.coordinate, 'unknown');
  assert.equal(unknown.arc.transitions.length, 0);
  raw.order = [{ from: 'e1', to: 'e2', evidence: evidence() }];
  const known = projectAnalysis(parse(raw));
  assert.equal(known.arc.transitions[0].direction, 1);
  assert.equal(known.arc.durationMs, null);
  assert.equal(known.arc.changeRate, null);
  raw.order.push({ from: 'e2', to: 'e1', evidence: evidence() });
  assert.throws(() => parse(raw));
});

test('D-to-A reported links cannot point at an emotion or absent observation id', () => {
  const raw = empty();
  raw.observations = [observation('d', 'd.retry', 'present'), observation('a', 'a.achievement', 'present')];
  raw.links = [{ dObservationId: 'd', aObservationId: 'a', evidence: evidence() }];
  assert.equal(parse(raw).links[0].causality, 'not_verified');
  raw.observations[1].axisId = 'emotion.joy';
  assert.throws(() => parse(raw));
  raw.links[0].aObservationId = 'missing';
  assert.throws(() => parse(raw));
});

test('source whitelist preserves neutral zero and excludes identity and old analysis', () => {
  const input = { ...record, respondent: { name: 'secret' }, experienceAnalysis: { secret: true },
    followUps: [{ questionId: 'reason', answer: '理由です' }] };
  const source = voiceSource(input);
  assert.equal(source.sentiment, 0);
  assert.equal(source.respondent, undefined);
  assert.equal(source.experienceAnalysis, undefined);
  assert.equal(source.sources[1].text, '理由です');
  assert.equal(sourceRevision(input), sourceRevision({ ...input, respondent: { name: 'renamed' } }));
  assert.notEqual(sourceRevision(record), sourceRevision({ ...record, sentiment: null }));
});

test('same revision reuses a saved analysis; text and follow-ups make it stale', async () => {
  let calls = 0;
  const analyzer = service(async (request) => {
    calls += 1;
    assert.equal(request.disableTools, true);
    return { text: JSON.stringify(empty()), model: 'fake' };
  });
  const result = await analyzer.analyze(record, null, 'owner/voice');
  assert.equal(await analyzer.analyze(record, result, 'owner/voice'), result);
  assert.equal(calls, 1);
  assert.equal(analyzer.status(record, result).state, 'complete');
  const stale = analyzer.status({ ...record, followUps: [{ questionId: 'reason', answer: '理由' }] }, result);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.analysis, null);
  assert.equal(analyzer.status(record, { ...result, catalogRevision: 'older' }).state, 'stale');
});

test('in-flight duplicates are rejected and failure releases the key without leaking provider output', async () => {
  let rejectGeneration;
  const analyzer = service(() => new Promise((_resolve, reject) => { rejectGeneration = reject; }));
  const pending = analyzer.analyze(record, null, 'owner/voice');
  await assert.rejects(analyzer.analyze(record, null, 'owner/voice'), { code: 'VOICE_ANALYSIS_BUSY' });
  rejectGeneration(new Error('secret review and stderr'));
  await assert.rejects(pending, (error) => error.code === 'VOICE_ANALYSIS_GENERATION_FAILED'
    && !error.message.includes('secret'));
  analyzer.llmClient.generate = async () => ({ text: JSON.stringify(empty()), model: 'fake' });
  assert.equal((await analyzer.analyze(record, null, 'owner/voice')).analysisState, 'complete');
});
