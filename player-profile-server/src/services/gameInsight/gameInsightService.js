// Orchestrates the cross-player game insight (spec/feature/game-insight.md):
// reads every player's emotion curves for one game, runs the deterministic
// hotspot / dropout aggregate, persists it as a derived record with provenance,
// and — separately — assembles game markers, Anatomia code locations and
// screen-recording frames around the focus points for the LLM proposal. The
// aggregate never needs the LLM, Anatomia or ffmpeg to be configured.
const { createHash } = require('node:crypto');
const { aggregateHotspots } = require('./hotspotAggregate');
const { MAXIMUM_GAME_TITLE_LENGTH, normalizeTitle } = require('./cohortReader');
const {
  attachGameContext,
  identifierTokens,
  selectFocusPoints,
} = require('./improvementContext');
const { SYSTEM_PROMPT, buildImprovementPrompt } = require('./improvementPrompt');

const INSIGHT_EXTRACTOR = 'hotspot-aggregate/v1';
const INSIGHT_SCHEMA_VERSION = 1;

/** @implements SPEC-GAME-INSIGHT */
function compareText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function insightError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

// One record per game (the cohort is the whole data repository, so the title
// alone identifies it). Hash keeps the id a safe path segment.
/** @implements SPEC-GAME-INSIGHT */
function insightRecordId(gameTitle) {
  const digest = createHash('sha256').update(gameTitle).digest('hex');
  return `gi-${digest.slice(0, 24)}`;
}

// Revision of exactly the inputs the aggregate and the prompt consume.
/** @implements SPEC-GAME-INSIGHT */
function sourceRevision(items) {
  const relevant = items.map(({ playerKey, record }) => ({
    playerKey,
    id: record.id,
    mode: record.mode,
    createdAt: record.createdAt,
    sessionPlaytimeMinutes: record.sessionPlaytimeMinutes,
    captureSessionId: record.captureSessionId,
    entries: record.entries,
  })).sort((left, right) => compareText(left.playerKey, right.playerKey)
    || compareText(left.id, right.id)
    || compareText(JSON.stringify(left), JSON.stringify(right)));
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

/** @implements SPEC-GAME-INSIGHT */
class GameInsightService {
  constructor({
    cohortReader,
    insightStore,
    captureSessionService = null,
    anatomiaClient = null,
    frameExtractor = null,
    llmClient,
    now = () => new Date(),
  }) {
    this.cohortReader = cohortReader;
    this.insightStore = insightStore;
    this.captureSessionService = captureSessionService;
    this.anatomiaClient = anatomiaClient;
    this.frameExtractor = frameExtractor;
    this.llmClient = llmClient;
    this.now = now;
  }

  async games(context) {
    return this.cohortReader.games(context);
  }

  async list(context) {
    return this.insightStore.list(context);
  }

  async find(context, insightId) {
    const record = (await this.insightStore.list(context)).find((item) => item.id === insightId);
    if (!record) throw insightError(404, 'GAME_INSIGHT_NOT_FOUND', 'Game insight not found');
    return record;
  }

  async sourceItems(context, gameTitle) {
    const title = normalizeTitle(gameTitle);
    if (!title) throw insightError(400, 'INVALID_GAME_INSIGHT_INPUT', 'gameTitle is required');
    if (title.length > MAXIMUM_GAME_TITLE_LENGTH) {
      throw insightError(400, 'INVALID_GAME_INSIGHT_INPUT', 'gameTitle is too long');
    }
    return this.cohortReader.readGame(context, title);
  }

  async analyze(context, { gameTitle }) {
    const title = normalizeTitle(gameTitle);
    const items = await this.sourceItems(context, title);
    const analysis = aggregateHotspots(items);
    const id = insightRecordId(title);
    const existing = (await this.insightStore.list(context)).find((item) => item.id === id);
    const { record } = await this.insightStore.write({
      ...context,
      data: {
        id,
        schemaVersion: INSIGHT_SCHEMA_VERSION,
        gameTitle: title,
        sourceRecordIds: items.map(({ record: source }) => source.id).sort(),
        sourceRevision: sourceRevision(items),
        provenance: { extractor: INSIGHT_EXTRACTOR, analyzedAt: this.now().toISOString() },
        analysis,
        // Kept across re-analysis; its own sourceRevision flags it as stale.
        proposal: existing?.proposal ?? null,
      },
    });
    return record;
  }

  status() {
    return {
      evaluation: { configured: Boolean(this.llmClient?.isConfigured()) },
      anatomia: { configured: Boolean(this.anatomiaClient?.isConfigured()) },
      frames: { configured: Boolean(this.frameExtractor) },
    };
  }

  // Own capture sessions for the game; `linked` when a source emotion curve
  // was drafted from it. Other players' captures live in their own directories
  // and are not reachable here by design.
  async captureSessionCandidates(context, insightId) {
    const record = await this.find(context, insightId);
    if (!this.captureSessionService) return [];
    const linked = new Set((record.analysis.sessions || [])
      .map((session) => session.captureSessionId).filter(Boolean));
    const sessions = await this.captureSessionService.list(context);
    return sessions
      .filter((session) => normalizeTitle(session.gameTitle) === record.gameTitle)
      .map((session) => {
        const screen = session.capture?.screenRecording;
        const screenDuration = Number(screen?.durationSeconds);
        return {
          id: session.id,
          startedAt: session.startedAt,
          status: session.status,
          linked: linked.has(session.id),
          hasScreenRecording: Boolean(screen),
          screenRecordingDurationSeconds: Number.isFinite(screenDuration) && screenDuration > 0
            ? screenDuration
            : 0,
          gameMarkerCount: (session.markers || []).filter((marker) => marker.origin === 'game').length,
        };
      })
      .sort((left, right) => Number(right.linked) - Number(left.linked)
        || Number(right.hasScreenRecording) - Number(left.hasScreenRecording)
        || right.screenRecordingDurationSeconds - left.screenRecordingDurationSeconds
        || String(right.startedAt).localeCompare(String(left.startedAt)));
  }

  async resolveCaptureSession(context, insight, captureSessionId) {
    if (!this.captureSessionService) {
      if (captureSessionId) {
        throw insightError(503, 'CAPTURE_SESSION_NOT_CONFIGURED',
          'Capture sessions are not available for game insight proposals');
      }
      return null;
    }
    if (captureSessionId) {
      const captureSession = await this.captureSessionService.findRecord(context, String(captureSessionId));
      if (normalizeTitle(captureSession.gameTitle) !== insight.gameTitle) {
        throw insightError(400, 'CAPTURE_SESSION_GAME_MISMATCH',
          'Capture session must belong to the game being analyzed');
      }
      return captureSession;
    }
    const candidates = await this.captureSessionCandidates(context, insight.id);
    const best = candidates.find((candidate) => candidate.hasScreenRecording) || null;
    return best ? this.captureSessionService.findRecord(context, best.id) : null;
  }

  async locateCode(anatomiaProject, gameTitle, focusPoints) {
    if (!anatomiaProject) return focusPoints.map((point) => ({ ...point, codeLocations: [], domains: [] }));
    if (!this.anatomiaClient) {
      throw insightError(503, 'ANATOMIA_NOT_CONFIGURED', 'Anatomia CLI is not configured');
    }
    const located = [];
    for (const point of focusPoints) {
      const labels = (point.gameContext?.markers || []).map((marker) => marker.label).filter(Boolean);
      const stampWords = Object.keys(point.stampPlayers || {});
      const task = [gameTitle, ...labels, ...stampWords, ...(point.types || [point.type])].join(' ');
      const bundle = await this.anatomiaClient.context(anatomiaProject, task);
      const symbolHits = [];
      for (const token of identifierTokens(labels)) {
        symbolHits.push(...await this.anatomiaClient.findSymbol(anatomiaProject, token));
      }
      const seen = new Set();
      const codeLocations = [...symbolHits, ...bundle.exemplars].filter((location) => {
        const key = `${location.filePath}:${location.startLine}:${location.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      located.push({ ...point, codeLocations, domains: bundle.existingDomains });
    }
    return located;
  }

  async generateWithFrames(context, captureSession, focusPoints, produce) {
    const screen = captureSession?.capture?.screenRecording;
    const wanted = focusPoints.filter((point) => Number.isFinite(point.gameContext?.frameSeconds));
    if (!screen || !this.frameExtractor || wanted.length === 0) {
      return produce(focusPoints.map((point) => ({ ...point, framePath: null })), 0);
    }
    const media = await this.captureSessionService.resolveVideo(context, captureSession.id, 'screen');
    if (!media) return produce(focusPoints.map((point) => ({ ...point, framePath: null })), 0);
    try {
      return await this.frameExtractor.withFrames(
        media.filePath,
        wanted.map((point) => point.gameContext.frameSeconds),
        ({ frames }) => {
          const bySeconds = new Map(frames.map((frame) => [frame.seconds, frame.filePath]));
          const withFrames = focusPoints.map((point) => ({
            ...point,
            framePath: bySeconds.get(point.gameContext?.frameSeconds) || null,
          }));
          return produce(withFrames, frames.length);
        }
      );
    } catch (error) {
      // ffmpeg missing is a configuration gap, not a reason to block the
      // proposal: continue without frames and say so in the record.
      if (error.code !== 'FFMPEG_NOT_AVAILABLE') throw error;
      return produce(focusPoints.map((point) => ({ ...point, framePath: null })), 0);
    }
  }

  async propose(context, insightId, { anatomiaProject = '', captureSessionId = '' } = {}) {
    const record = await this.find(context, insightId);
    if (!this.llmClient?.isConfigured()) {
      throw insightError(503, 'LLM_NOT_CONFIGURED', 'LLM is not configured for game insight proposals');
    }
    const items = await this.sourceItems(context, record.gameTitle);
    if (sourceRevision(items) !== record.sourceRevision) {
      throw insightError(409, 'GAME_INSIGHT_STALE',
        'Source emotion curves changed; re-analyze the game insight before proposing');
    }
    const project = String(anatomiaProject || '').trim();
    const captureSession = await this.resolveCaptureSession(context, record, String(captureSessionId || '').trim());
    const focus = attachGameContext(selectFocusPoints(record.analysis), {
      captureSession,
      referenceLengthSeconds: record.analysis.referenceLengthSeconds,
    });
    const located = await this.locateCode(project, record.gameTitle, focus);
    const { text, model, frameCount } = await this.generateWithFrames(
      context,
      captureSession,
      located,
      async (focusPoints, count) => {
        const prompt = buildImprovementPrompt({
          gameTitle: record.gameTitle,
          analysis: record.analysis,
          focusPoints,
          anatomiaProject: project,
          captureSessionId: captureSession?.id || '',
        });
        const generated = await this.llmClient.generate({
          system: SYSTEM_PROMPT,
          prompt,
          imagePaths: focusPoints.map((point) => point.framePath).filter(Boolean),
        });
        return { ...generated, frameCount: count };
      }
    );
    const proposal = {
      schemaVersion: 1,
      extractor: 'llm',
      model,
      text,
      generatedAt: this.now().toISOString(),
      sourceRevision: record.sourceRevision,
      anatomiaProject: project || null,
      captureSessionId: captureSession?.id || null,
      frameCount,
      codeLocationCount: located.reduce((sum, point) => sum + (point.codeLocations?.length || 0), 0),
      focusCount: located.length,
    };
    const { record: saved } = await this.insightStore.write({
      ...context,
      data: { ...record, proposal },
    });
    return saved;
  }
}

module.exports = {
  GameInsightService,
  INSIGHT_EXTRACTOR,
  insightRecordId,
  sourceRevision,
};
