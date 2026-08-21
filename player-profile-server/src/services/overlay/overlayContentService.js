// Content the overlay app reads over the loopback API
// (spec/feature/window-overlay-extension.md §表示コンテンツ, task T9).
// It only composes what the existing local services already expose: the
// overlay is a client of the local app and never touches the profile stores.
/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
const CHART_KINDS = Object.freeze({
  hotspot: 'hotspot',
  'narrative-arc': 'narrative-arc',
});

function overlayError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

class OverlayContentService {
  constructor({
    markdownStore,
    captureSessionService,
    gameInsightService,
    narrativeArcService,
  }) {
    this.markdownStore = markdownStore;
    this.captureSessionService = captureSessionService;
    this.gameInsightService = gameInsightService;
    this.narrativeArcService = narrativeArcService;
  }

  // The overlay polls this to decide whether the marker panel is live: when no
  // session is recording it buffers locally instead of dropping input.
  async status(context) {
    const record = await this.captureSessionService.active(context);
    return {
      captureSession: record
        ? { id: record.id, status: record.status, startedAt: record.startedAt }
        : null,
      chartKinds: Object.keys(CHART_KINDS),
    };
  }

  async documents(context) {
    return this.markdownStore.list(context);
  }

  async document(context, documentId) {
    return this.markdownStore.read(context, documentId);
  }

  // Chart payloads keep the exact prop shape the shared chart components take
  // (`analysis`), so the overlay renders them without a second adapter.
  async chart(context, kind, recordId) {
    if (!CHART_KINDS[kind]) {
      throw overlayError(400, 'UNKNOWN_OVERLAY_CHART', `Unknown overlay chart kind: ${kind}`);
    }
    const record = kind === 'hotspot'
      ? await this.gameInsightService.find(context, recordId)
      : await this.narrativeArcService.find(context, recordId);
    return {
      type: kind,
      id: record.id,
      gameTitle: record.gameTitle || null,
      analysis: record.analysis || null,
    };
  }
}

module.exports = { OverlayContentService, OVERLAY_CHART_KINDS: CHART_KINDS };
