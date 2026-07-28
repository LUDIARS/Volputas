// User-evidence counting shared by local and online persona services.
// Survey definitions are catalog metadata, and the Steam snapshot is a single
// passive source — neither should inflate the per-record evidence count.
const USER_EVIDENCE_KEYS = [
  'surveys',
  'gameplay',
  'voices',
  'emotionCurves',
  'comparisons',
];

function countUserEvidence(sources) {
  const records = USER_EVIDENCE_KEYS.reduce(
    (sum, key) => sum + (sources[key]?.length || 0),
    0
  );
  const transcribedVoiceMemos = (sources.voiceMemos || [])
    .filter((record) => String(record.transcript || '').trim()).length;
  return records + transcribedVoiceMemos + (sources.steam?.games?.length ? 1 : 0);
}

module.exports = { USER_EVIDENCE_KEYS, countUserEvidence };
