// Builds an emotion-curve record payload out of a capture session: one-tap
// markers become stamp entries, transcribed utterances become comment entries
// carrying their lexicon affect. Pure — persistence and validation stay with
// the caller, so the draft passes through validateEmotionCurveInput like any
// hand-written curve and persona analysis consumes it unchanged.
const CAPTURE_MARKER_STAMPS = new Set(['hype', 'like', 'dislike', 'stress']);
const MAXIMUM_ENTRIES = 500;

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function draftError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function buildEmotionCurveDraft({ record, analysis }) {
  const markerEntries = record.markers
    .filter((marker) => CAPTURE_MARKER_STAMPS.has(marker.type))
    .map((marker) => ({
      timeSeconds: Math.round(marker.sessionMs / 1000),
      stamp: marker.type,
      comment: marker.label || '',
    }));
  const utteranceEntries = (analysis?.utterances || [])
    .filter((utterance) => utterance.text)
    .map((utterance) => ({
      timeSeconds: Math.round(utterance.sessionMs / 1000),
      comment: utterance.text,
      valence: utterance.valence,
      arousal: utterance.arousal,
    }));
  const entries = [...markerEntries, ...utteranceEntries]
    .sort((left, right) => left.timeSeconds - right.timeSeconds)
    .slice(0, MAXIMUM_ENTRIES);
  if (entries.length === 0) {
    throw draftError(
      409,
      'CAPTURE_DRAFT_EMPTY',
      'This session has neither markers nor transcribed utterances to build a curve from'
    );
  }
  const durationMs = record.endedAt
    ? Math.max(Date.parse(record.endedAt) - Date.parse(record.startedAt), 0)
    : null;
  return {
    gameTitle: record.gameTitle,
    mode: 'capture',
    captureSessionId: record.id,
    sessionLabel: `キャプチャ ${record.startedAt}`,
    daysAfterPlay: 0,
    sessionPlaytimeMinutes: durationMs === null ? null : Math.round(durationMs / 60000),
    entries,
  };
}

module.exports = { CAPTURE_MARKER_STAMPS, buildEmotionCurveDraft };
