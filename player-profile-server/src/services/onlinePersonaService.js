const { analyzePersonaV2 } = require('./personaEvidence/analyzePersonaV2');
const { fingerprintSources } = require('./personaFingerprint');
const { countUserEvidence } = require('./personaEvidence/evidenceCount');
const { EVIDENCE_MEDIA } = require('./evidenceMedia');
const defaultSteamModel = require('../models/steamModel');

class OnlinePersonaService {
  constructor(model, { steamModel = defaultSteamModel, now = () => new Date() } = {}) {
    this.model = model;
    this.steamModel = steamModel;
    this.now = now;
  }

  // Steam data lives in the Voluptas DB (not the Cernere-owned evidence
  // store); the snapshot carries last_synced_at so the fingerprint goes stale
  // when the library is re-imported (design §3.2).
  async readSteamSnapshot(userId) {
    const profile = await this.steamModel.getProfile(userId);
    if (!profile) return null;
    return {
      fetchedAt: profile.last_synced_at
        ? new Date(profile.last_synced_at).toISOString()
        : null,
      games: await this.steamModel.getOwnedGames(userId),
    };
  }

  async readSources(userId) {
    // Registry-driven for the same reason as the local service: the result keys
    // and the reads are generated from one list instead of two parallel ones.
    const [surveys, surveyDefinitions, steam, ...records] = await Promise.all([
      this.model.listSurveyResponses(userId),
      this.model.listSurveyDefinitions(),
      this.readSteamSnapshot(userId),
      ...EVIDENCE_MEDIA.map(({ kind }) => this.model.list(userId, kind)),
    ]);
    return {
      surveys,
      surveyDefinitions,
      steam,
      ...Object.fromEntries(EVIDENCE_MEDIA.map((medium, index) => [
        medium.sourceKey,
        records[index],
      ])),
    };
  }

  async status(userId) {
    const sources = await this.readSources(userId);
    const sourceFingerprint = fingerprintSources(sources);
    const analysis = await this.model.readAnalysis(userId);
    const evidenceCount = countUserEvidence(sources);
    return {
      analysis,
      evidenceCount,
      stale: evidenceCount > 0 && analysis?.sourceFingerprint !== sourceFingerprint,
    };
  }

  async analyze(userId) {
    const sources = await this.readSources(userId);
    const evidenceCount = countUserEvidence(sources);
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
