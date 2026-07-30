const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLUMN_BY_KIND,
  EVIDENCE_KINDS,
  EVIDENCE_MEDIA,
  MEDIA_KINDS,
  MEDIA_KIND_NAMES,
  assertCoversEveryMedium,
  mediaKindMatchesRecord,
} = require('./evidenceMedia');
const { MEDIA_RULES } = require('./profileMediaStore');
const { USER_EVIDENCE_KEYS } = require('./personaEvidence/evidenceCount');

const KEBAB = /^[a-z]+(?:-[a-z]+)*$/;
const SNAKE_RECORDS = /^[a-z]+(?:_[a-z]+)*_records$/;

// The Cernere column is the singular of the kind plus `_records`. English
// pluralisation is not mechanically reversible (`pitches` → `pitch`, `voices` →
// `voice`), so the expected names are pinned here: renaming a column becomes a
// deliberate two-file edit instead of a silent drift. These must equal the
// declarations in Cernere's 037_volputas_profile_evidence_schema.sql.
const EXPECTED_COLUMNS = {
  gameplay: 'gameplay_records',
  voices: 'voice_records',
  'voice-memos': 'voice_memo_records',
  'emotion-curves': 'emotion_curve_records',
  comparisons: 'comparison_records',
  'card-sorts': 'card_sort_records',
  annotations: 'annotation_records',
  pitches: 'pitch_records',
};

test('every medium is named consistently across its naming spaces', () => {
  for (const medium of EVIDENCE_MEDIA) {
    // The kind is used verbatim as an HTTP path segment and as a record
    // directory name in the data repository, so it stays lowercase kebab-case.
    assert.match(medium.kind, KEBAB, `kind: ${medium.kind}`);
    // `voicememo_records` used to break this and silently disabled voice memos.
    assert.match(medium.column, SNAKE_RECORDS, `column for ${medium.kind}`);
    assert.equal(medium.column, EXPECTED_COLUMNS[medium.kind], `column for ${medium.kind}`);
    // The analysis key is the kind in camelCase, which is derivable exactly.
    assert.equal(
      medium.sourceKey,
      medium.kind.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()),
      `sourceKey for ${medium.kind}`
    );
  }
  assert.deepEqual([...EVIDENCE_KINDS].sort(), Object.keys(EXPECTED_COLUMNS).sort());
});

test('media kinds stay kebab-case too', () => {
  for (const kind of MEDIA_KIND_NAMES) {
    // `voicememos` and `gamelogs` used to break this while `screenshots` and
    // `videos` did not, which is what made the media paths inconsistent.
    assert.match(kind, KEBAB, `media kind: ${kind}`);
  }
});

test('kinds, columns, and source keys are unique', () => {
  for (const field of ['kind', 'column', 'sourceKey']) {
    const values = EVIDENCE_MEDIA.map((medium) => medium[field]);
    assert.equal(new Set(values).size, values.length, `duplicate ${field}`);
  }
});

test('the Cernere column map covers exactly the registered media', () => {
  assert.deepEqual(Object.keys(COLUMN_BY_KIND).sort(), [...EVIDENCE_KINDS].sort());
});

test('media rules and media-kind registry describe the same kinds', () => {
  assert.deepEqual(Object.keys(MEDIA_RULES).sort(), [...MEDIA_KIND_NAMES].sort());
});

test('media kinds only reference registered evidence media', () => {
  for (const media of MEDIA_KINDS) {
    for (const recordKind of media.recordKinds) {
      assert.ok(
        EVIDENCE_KINDS.includes(recordKind),
        `${media.kind} references unknown record kind ${recordKind}`
      );
    }
  }
});

test('media ownership is enforced per kind', () => {
  assert.equal(mediaKindMatchesRecord('screenshots', 'annotations'), true);
  assert.equal(mediaKindMatchesRecord('screenshots', 'emotion-curves'), false);
  assert.equal(mediaKindMatchesRecord('voice-memos', 'voice-memos'), true);
  assert.equal(mediaKindMatchesRecord('game-logs', 'gameplay'), false);
  assert.equal(mediaKindMatchesRecord('unknown', 'gameplay'), false);
});

test('the evidence counter derives its keys from the registry', () => {
  const countedSourceKeys = EVIDENCE_MEDIA
    .filter((medium) => medium.countsEveryRecord !== false)
    .map((medium) => medium.sourceKey);
  assert.deepEqual([...USER_EVIDENCE_KEYS], ['surveys', ...countedSourceKeys]);
  // Voice memos are counted by transcript, not per record, so they must not
  // appear in the plain per-record key list.
  assert.equal(USER_EVIDENCE_KEYS.includes('voiceMemos'), false);
});

test('assertCoversEveryMedium reports the media a map is missing', () => {
  const complete = Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, () => {}]));
  assert.equal(assertCoversEveryMedium(complete, 'complete map'), complete);

  const { pitches, ...incomplete } = complete;
  assert.ok(pitches);
  assert.throws(
    () => assertCoversEveryMedium(incomplete, 'validator map'),
    /validator map is missing evidence media: pitches/
  );
});
