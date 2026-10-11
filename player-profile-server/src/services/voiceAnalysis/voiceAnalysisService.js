const { randomUUID } = require('node:crypto');
const { ANALYSIS_REVISION, CATALOG_REVISION } = require('./catalog');
const { analysisError, voiceSource, sourceRevision } = require('./source');
const { buildPrompt } = require('./prompt');
const { parseAnalysis } = require('./parseAnalysis');
const { projectAnalysis } = require('./projection');

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
class VoiceAnalysisService {
  constructor({ llmClient, now = () => new Date(), createId = randomUUID }) {
    this.llmClient = llmClient;
    this.now = now;
    this.createId = createId;
    this.pending = new Set();
  }

  current(record, analysis) {
    return Boolean(analysis && analysis.formatVersion === 'vo-experience/1' && analysis.schemaVersion === 1
      && analysis.sourceRevision === sourceRevision(record)
      && analysis.analysisRevision === ANALYSIS_REVISION
      && analysis.catalogRevision === CATALOG_REVISION);
  }

  status(record, analysis) {
    const current = this.current(record, analysis);
    return {
      state: current ? 'complete' : analysis ? 'stale' : 'not_analyzed',
      analysis: current ? analysis : null,
      previousAnalyzedAt: analysis?.analyzedAt ?? null,
    };
  }

  async analyze(record, previous, requestKey) {
    if (this.current(record, previous)) return previous;
    if (this.pending.has(requestKey)) {
      throw analysisError('VOICE_ANALYSIS_BUSY', 'この声は解析中です。完了後に結果を確認してください。', 409);
    }
    if (!this.llmClient.isConfigured()) {
      throw analysisError('LLM_NOT_CONFIGURED', 'AI解析の接続設定がありません。', 503);
    }
    const source = voiceSource(record);
    this.pending.add(requestKey);
    try {
      let response;
      try {
        response = await this.llmClient.generate(buildPrompt(source));
      } catch (error) {
        // Provider messages may contain review excerpts or stderr. Do not
        // expose them through the API or the shared error logger.
        throw analysisError('VOICE_ANALYSIS_GENERATION_FAILED',
          'AI解析に失敗しました。接続設定を確認して再度実行してください。',
          error.statusCode === 503 ? 503 : error.statusCode === 504 ? 504 : 502);
      }
      const parsed = parseAnalysis(response?.text, source.sources);
      const { events, order, ...extracted } = parsed;
      return {
        formatVersion: 'vo-experience/1', schemaVersion: 1,
        id: this.createId(), voiceId: record.id, sourceRevision: sourceRevision(record),
        catalogRevision: CATALOG_REVISION, analysisRevision: ANALYSIS_REVISION,
        analyzedAt: this.now().toISOString(), model: response.model,
        sourceKind: 'self_report', analysisState: 'complete',
        ...extracted, ...projectAnalysis(parsed),
        limitations: ['machine_extraction_unvalidated', 'not_population_statistics', 'causality_not_verified'],
      };
    } finally {
      this.pending.delete(requestKey);
    }
  }
}

module.exports = { VoiceAnalysisService };
