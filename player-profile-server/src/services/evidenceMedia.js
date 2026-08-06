// Single source of truth for the user-evidence media.
//
// Every medium used to be named independently in five places — the store kind,
// the HTTP path, the local data-repository directory, the Cernere managed-project
// column, and the camelCase key used by the persona analysis — and the five
// drifted (`cardsorts` vs `card-sorts`, `voicememo_records` vs the rest). Adding
// a medium also meant hand-editing about ten registration points, which is what
// made parallel feature branches collide on the same lines.
//
// Add a medium by adding one entry here. The local app, the online routes, both
// persona services, the Cernere column map, and the evidence counter all derive
// their wiring from this list, so the names cannot diverge again.
//
// `kind` is the canonical identifier and is used verbatim as
//   - the store kind passed to the Cernere evidence store,
//   - the HTTP path segment (`/api/local/<kind>`, `/api/profile/<kind>`),
//   - the record directory inside the local data repository.
// `column` is the Cernere managed-project column; it must stay in sync with the
// declaration in Cernere's `040_volputas_profile_evidence_schema.sql`, because
// managed_project.set_user_data silently drops undeclared columns.
// `sourceKey` is the camelCase key in the analysis `sources` / `evidence` maps.
const EVIDENCE_MEDIA = Object.freeze([
  Object.freeze({
    kind: 'gameplay',
    column: 'gameplay_records',
    sourceKey: 'gameplay',
  }),
  Object.freeze({
    kind: 'voices',
    column: 'voice_records',
    sourceKey: 'voices',
  }),
  Object.freeze({
    kind: 'voice-memos',
    column: 'voice_memo_records',
    sourceKey: 'voiceMemos',
    // A memo without a transcript carries no analysable content, so the evidence
    // counter applies its own rule instead of counting every record.
    countsEveryRecord: false,
  }),
  Object.freeze({
    kind: 'emotion-curves',
    column: 'emotion_curve_records',
    sourceKey: 'emotionCurves',
  }),
  Object.freeze({
    kind: 'comparisons',
    column: 'comparison_records',
    sourceKey: 'comparisons',
  }),
  Object.freeze({
    kind: 'card-sorts',
    column: 'card_sort_records',
    sourceKey: 'cardSorts',
  }),
  Object.freeze({
    kind: 'annotations',
    column: 'annotation_records',
    sourceKey: 'annotations',
  }),
  Object.freeze({
    kind: 'pitches',
    column: 'pitch_records',
    sourceKey: 'pitches',
  }),
]);

// Protected media attached to evidence records. `kind` is the path segment and
// the media directory name; `recordKinds` lists the evidence media allowed to
// own that file type, so a screenshot ticket cannot be replayed against an
// emotion curve.
const MEDIA_KINDS = Object.freeze([
  Object.freeze({ kind: 'screenshots', recordKinds: Object.freeze(['gameplay', 'annotations']) }),
  Object.freeze({ kind: 'voice-memos', recordKinds: Object.freeze(['voice-memos']) }),
  Object.freeze({ kind: 'videos', recordKinds: Object.freeze(['emotion-curves']) }),
  Object.freeze({ kind: 'game-logs', recordKinds: Object.freeze(['emotion-curves']) }),
]);

const EVIDENCE_KINDS = Object.freeze(EVIDENCE_MEDIA.map((medium) => medium.kind));

const MEDIA_KIND_NAMES = Object.freeze(MEDIA_KINDS.map((media) => media.kind));

const COLUMN_BY_KIND = Object.freeze(Object.fromEntries(
  EVIDENCE_MEDIA.map((medium) => [medium.kind, medium.column])
));

const RECORD_KINDS_BY_MEDIA_KIND = Object.freeze(Object.fromEntries(
  MEDIA_KINDS.map((media) => [media.kind, new Set(media.recordKinds)])
));

function mediaKindMatchesRecord(mediaKind, recordKind) {
  return RECORD_KINDS_BY_MEDIA_KIND[mediaKind]?.has(recordKind) || false;
}

/**
 * Fails fast when a caller-supplied map (validators, stores) does not cover
 * every registered medium. Without this a forgotten entry surfaces as an
 * `undefined is not a function` on the first request instead of at startup.
 */
function assertCoversEveryMedium(byKind, label) {
  const missing = EVIDENCE_KINDS.filter((kind) => !byKind[kind]);
  if (missing.length > 0) {
    throw new Error(`${label} is missing evidence media: ${missing.join(', ')}`);
  }
  return byKind;
}

module.exports = {
  COLUMN_BY_KIND,
  EVIDENCE_KINDS,
  EVIDENCE_MEDIA,
  MEDIA_KINDS,
  MEDIA_KIND_NAMES,
  assertCoversEveryMedium,
  mediaKindMatchesRecord,
};
