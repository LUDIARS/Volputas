// Default composition of the game-insight service for local mode
// (spec/feature/game-insight.md). Concrete stores and CLI adapters live here so
// localApp stays HTTP wiring only. Anatomia and ffmpeg are optional: an unset
// VOLPUTAS_ANATOMIA_CLI leaves code location off (the service reports it via
// /status), ffmpeg follows the same VOLPUTAS_FFMPEG knob as the capture analysis.
const { ProfileRecordStore } = require('./profileRecordStore');
const { CohortReader } = require('../services/gameInsight/cohortReader');
const { AnatomiaClient } = require('../services/gameInsight/anatomiaClient');
const { FrameExtractor } = require('../services/gameInsight/frameExtractor');
const { GameInsightService } = require('../services/gameInsight/gameInsightService');

/** @implements SPEC-GAME-INSIGHT */
function createGameInsightService({ captureSessionService, llmClient, env = process.env }) {
  return new GameInsightService({
    cohortReader: new CohortReader(),
    insightStore: new ProfileRecordStore('game-insights'),
    captureSessionService,
    anatomiaClient: new AnatomiaClient({ cliPath: env.VOLPUTAS_ANATOMIA_CLI || '' }),
    frameExtractor: new FrameExtractor({ ffmpegPath: env.VOLPUTAS_FFMPEG || 'ffmpeg' }),
    llmClient,
  });
}

module.exports = { createGameInsightService };
