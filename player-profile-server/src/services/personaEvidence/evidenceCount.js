// User-evidence counting shared by local and online persona services.
// Survey definitions are catalog metadata, and the Steam snapshot is a single
// passive source — neither should inflate the per-record evidence count.
const { EVIDENCE_MEDIA } = require('../evidenceMedia');

// Survey answers are not a registered medium (they live in the data repository
// under `answers/`), so they are named here; every other counted key comes from
// the registry, and a medium that opts out of per-record counting is excluded.
const USER_EVIDENCE_KEYS = Object.freeze([
  'surveys',
  ...EVIDENCE_MEDIA
    .filter((medium) => medium.countsEveryRecord !== false)
    .map((medium) => medium.sourceKey),
]);

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
