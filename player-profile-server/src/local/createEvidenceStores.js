const { ProfileRecordStore } = require('./profileRecordStore');
const { EVIDENCE_KINDS } = require('../services/evidenceMedia');

/**
 * One record store per registered medium, keyed by the canonical kind. The kind
 * doubles as the record directory name inside the data repository, so the
 * registry stays the only place a medium's storage name is written down.
 */
function createEvidenceStores(now) {
  return Object.fromEntries(
    EVIDENCE_KINDS.map((kind) => [kind, new ProfileRecordStore(kind, now)])
  );
}

module.exports = { createEvidenceStores };
