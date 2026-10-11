const { AppError } = require('../middleware/errorHandler');
const { createVoiceAnalysisRoutes } = require('./voiceAnalysisRoutes');

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function createOnlineVoiceAnalysisRoutes({ service, model }) {
  return createVoiceAnalysisRoutes({
    service,
    async load(req) {
      const owned = await model.findOwned(req.user.id, req.params.recordId);
      if (!owned || owned.kind !== 'voices') {
        throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Voice not found');
      }
      return {
        record: owned.record, analysis: owned.record.experienceAnalysis ?? null,
        requestKey: JSON.stringify([req.user.id, owned.record.id]),
      };
    },
    async save(req, { record }, analysis) {
      const updated = await model.updateOwned(req.user.id, 'voices', record.id, {
        experienceAnalysis: analysis,
      });
      if (!updated) throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Voice not found');
    },
  });
}

module.exports = { createOnlineVoiceAnalysisRoutes };
