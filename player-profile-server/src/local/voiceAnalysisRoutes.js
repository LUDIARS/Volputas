const { AppError } = require('../middleware/errorHandler');
const { storeContext } = require('./localContext');
const { createVoiceAnalysisRoutes } = require('../routes/voiceAnalysisRoutes');

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function createLocalVoiceAnalysisRoutes({ service, configuredContext, voiceStore, analysisStore }) {
  return createVoiceAnalysisRoutes({
    service,
    async load(req) {
      const context = storeContext(await configuredContext());
      const record = await voiceStore.read({ ...context, id: req.params.recordId });
      if (!record || record.id !== req.params.recordId || record.respondent?.name !== context.name) {
        throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Voice not found');
      }
      const stored = await analysisStore.read({ ...context, id: record.id });
      return {
        context, record,
        analysis: stored?.id === record.id ? stored.analysis : null,
        requestKey: JSON.stringify([context.repositoryRoot, context.name, record.id]),
      };
    },
    async save(_req, { context, record }, analysis) {
      await analysisStore.write({ ...context, data: { id: record.id, voiceId: record.id, analysis } });
    },
  });
}

module.exports = { createLocalVoiceAnalysisRoutes };
