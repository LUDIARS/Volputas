const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes } = require('node:crypto');
const { buildHistoryPersonas } = require('./personas');

const now = Date.parse('2026-09-15T10:00:00Z');
const options = { secret: randomBytes(32).toString('hex'), minComments: 1, now };
function record(source, nativeId, authorId = 'same-id') {
  return { source, nativeId, authorId, content: 'fun story', gameSlug: 'topic', threadKey: 'video',
    sourceUrl: 'https://example.com/source', postedAt: now - 1000, fetchedAt: now,
    expiresAt: now + 86400000 };
}
function snapshot(records) {
  return { schemaVersion: 1, generatedAt: now, windowStart: Date.parse('2026-03-15T10:00:00Z'),
    expiresAt: now + 86400000, records,
    coverage: [{ kind: 'livechat', target: 'video', startedAt: now - 2000, status: 'pending' }] };
}

test('YouTube channel identity joins comments and live chat, never Steam', () => {
  const result = buildHistoryPersonas(snapshot([
    record('youtube', 'comment'), record('youtube-livechat', 'live'), record('steam', 'review'),
  ]), { ...options, youtubeApprovalReference: 'fixture-approval' });
  assert.equal(result.personas.length, 2);
  const youtube = result.personas.find(persona => persona.historyEvidence.source === 'youtube');
  assert.equal(youtube.historyEvidence.sampleCount, 2);
  assert.equal(youtube.affectVector.length, 20);
  assert.ok(youtube.affectVector.every(value => value >= 0 && value <= 1));
  assert.deepEqual(youtube.attributes, {});
  const output = JSON.stringify(result.personas);
  assert.equal(output.includes('same-id'), false);
  assert.equal(output.includes('fun story'), false);
  assert.equal(output.includes('example.com'), false);
});

test('replayed records do not change a persona or inflate sample count', () => {
  const row = record('steam', 'review');
  const once = buildHistoryPersonas(snapshot([row]), options).personas;
  const twice = buildHistoryPersonas(snapshot([row, row]), options).personas;
  assert.deepEqual(twice, once);
  assert.equal(twice[0].historyEvidence.sampleCount, 1);
});

test('missing YouTube approval and expired snapshots fail explicitly', () => {
  assert.throws(() => buildHistoryPersonas(snapshot([record('youtube', 'c')]), options), /approval reference/);
  assert.throws(() => buildHistoryPersonas({ ...snapshot([record('steam', 'r')]), expiresAt: now }, options), /expired/);
});

test('thin evidence is counted, not filled with an invented personality', () => {
  const result = buildHistoryPersonas(snapshot([record('steam', 'r')]), { ...options, minComments: 10 });
  assert.equal(result.personas.length, 0);
  assert.equal(result.report.insufficientEvidence, 1);
});

test('live chat before collection start and conflicting identity are rejected', () => {
  assert.throws(() => buildHistoryPersonas(snapshot([{ ...record('youtube-livechat', 'm'), postedAt: now - 3000 }]),
    { ...options, youtubeApprovalReference: 'fixture-approval' }), /predates collection/);
  assert.throws(() => buildHistoryPersonas(snapshot([record('steam', 'r', 'a'), record('steam', 'r', 'b')]), options), /Conflicting/);
});
