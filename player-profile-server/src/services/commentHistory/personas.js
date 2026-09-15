const { buildVector, extractTextFeatures, VECTOR_SPEC_VERSION, DIM } = require('@ludiars/sentiment-core');
const { pseudoId } = require('../pseudoId');
const { parseHistorySnapshot } = require('./schema');

/** Exact platform identity only: YouTube comment and live chat IDs share a channel namespace. */
function speakerKey(row) {
  return `external-history:${row.source === 'steam' ? 'steam' : 'youtube'}:${row.authorId}`;
}

function groupRecords(records) {
  const deduplicated = new Map();
  for (const row of records) {
    const key = `${row.source}:${row.nativeId}`;
    const existing = deduplicated.get(key);
    if (existing && existing.authorId !== row.authorId) throw new Error('Conflicting author identity for one comment');
    if (!existing || row.fetchedAt >= existing.fetchedAt) deduplicated.set(key, row);
  }
  const groups = new Map();
  for (const row of deduplicated.values()) {
    const key = speakerKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function buildHistoryPersonas(input, { secret, youtubeApprovalReference, minComments = 10, now = Date.now() }) {
  if (!secret) throw new Error('VOLPUTAS_PSEUDO_ID_SECRET is required');
  if (!Number.isSafeInteger(minComments) || minComments < 1) throw new Error('minComments must be a positive integer');
  const snapshot = parseHistorySnapshot(input, now);
  const hasYoutube = snapshot.records.some(row => row.source !== 'steam');
  // This is an operator-supplied reference, not consent invented by the model.
  if (hasYoutube && !(typeof youtubeApprovalReference === 'string' && youtubeApprovalReference.trim())) {
    throw new Error('YouTube-derived personas require an approval reference covering this use; Steam-only snapshots can be processed separately');
  }
  const personas = [];
  let insufficientEvidence = 0;
  for (const [identity, records] of groupRecords(snapshot.records)) {
    if (records.length < minComments) { insufficientEvidence += 1; continue; }
    const affectVector = buildVector(records.map(row => extractTextFeatures(row.content, row.signal)));
    if (DIM !== 20 || affectVector.length !== 20 || affectVector.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error('sentiment-core must provide the supported fixed 20D space');
    }
    const source = records[0].source === 'steam' ? 'steam' : 'youtube';
    const observedMonths = new Set(records.map(row => new Date(row.postedAt).toISOString().slice(0, 7))).size;
    const times = records.reduce((range, row) => ({ first: Math.min(range.first, row.postedAt), last: Math.max(range.last, row.postedAt) }),
      { first: Infinity, last: -Infinity });
    personas.push({
      pseudoId: pseudoId(identity, secret), affectVector, vectorSpecVersion: VECTOR_SPEC_VERSION, exportSpecVersion: 2,
      traits: ['公開コメント由来の推定ペルソナ', `観測${records.length}件・${observedMonths}か月`, '本人の人格全体を再現するものではない'],
      preferenceAxes: {}, attributes: {}, aversions: [], mechanicReactions: [],
      historyEvidence: { schemaVersion: 1, source, generatedAt: snapshot.generatedAt, expiresAt: snapshot.expiresAt,
        windowStart: snapshot.windowStart, firstObservedAt: times.first, lastObservedAt: times.last,
        sampleCount: records.length, observedMonths, coverage: 'partial' },
    });
  }
  personas.sort((left, right) => left.pseudoId.localeCompare(right.pseudoId));
  return { personas, report: { generated: personas.length, insufficientEvidence,
    sourceRecords: snapshot.records.length, expiresAt: snapshot.expiresAt,
    incompleteJobs: snapshot.coverage.filter(job => job.status !== 'complete' || job.gaps?.length).length,
    youtubeApprovalReference: hasYoutube ? youtubeApprovalReference : null } };
}

module.exports = { buildHistoryPersonas, speakerKey };
