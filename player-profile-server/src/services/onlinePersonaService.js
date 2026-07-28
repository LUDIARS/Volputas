const { analyzePersonaV2 } = require('./personaEvidence/analyzePersonaV2');
const { fingerprintSources } = require('./personaFingerprint');

class OnlinePersonaService {
  constructor(model, now = () => new Date()) {
    this.model = model;
    this.now = now;
  }

  async readSources(userId) {
    const [surveys, gameplay, voices, emotionCurves] = await Promise.all([
      this.model.listSurveyResponses(userId),
      this.model.list(userId, 'gameplay'),
      this.model.list(userId, 'voices'),
      this.model.list(userId, 'emotion-curves'),
    ]);
    return { surveys, gameplay, voices, emotionCurves };
  }

  async status(userId) {
    const sources = await this.readSources(userId);
    const sourceFingerprint = fingerprintSources(sources);
    const analysis = await this.model.readAnalysis(userId);
    const evidenceCount = Object.values(sources).reduce((sum, records) => sum + records.length, 0);
    return {
      analysis,
      evidenceCount,
      stale: evidenceCount > 0 && analysis?.sourceFingerprint !== sourceFingerprint,
    };
  }

  async analyze(userId) {
    const sources = await this.readSources(userId);
    const evidenceCount = Object.values(sources).reduce((sum, records) => sum + records.length, 0);
    if (evidenceCount === 0) {
      throw Object.assign(new Error('Register or answer at least one item before analysis'), {
        code: 'PERSONA_INPUT_REQUIRED',
      });
    }
    const sourceFingerprint = fingerprintSources(sources);
    const existing = await this.model.readAnalysis(userId);
    if (existing?.sourceFingerprint === sourceFingerprint) {
      return { analysis: existing, recomputed: false };
    }
    const analysis = {
      ...analyzePersonaV2(sources, this.now().toISOString()),
      sourceFingerprint,
    };
    await this.model.writeAnalysis(userId, analysis);
    return { analysis, recomputed: true };
  }
}

module.exports = { OnlinePersonaService };
