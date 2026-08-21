// Orchestrates one emotion-curve evaluation: prompt building + LLM call +
// evaluation payload shaping. Storage of the result stays with the caller
// (local Git store vs Cernere) so both modes share this service.
const { SYSTEM_PROMPT, buildEvaluationPrompt } = require('./emotionCurveEvaluationPrompt');
const { parseJudgmentSections } = require('./emotionJudgment/judgmentSections');

class EmotionCurveEvaluationService {
  constructor({ llmClient, now = () => new Date() }) {
    this.llmClient = llmClient;
    this.now = now;
  }

  isConfigured() {
    return this.llmClient.isConfigured();
  }

  async evaluate({ record, persona, gameLogText }) {
    const prompt = buildEvaluationPrompt({ record, persona, gameLogText });
    const { text, model } = await this.llmClient.generate({
      system: SYSTEM_PROMPT,
      prompt,
    });
    return {
      schemaVersion: 2,
      extractor: 'llm',
      model,
      text,
      judgments: parseJudgmentSections(text),
      evaluatedAt: this.now().toISOString(),
      personaAnalyzedAt: persona?.analyzedAt ?? null,
      usedGameLog: Boolean(gameLogText),
    };
  }
}

module.exports = { EmotionCurveEvaluationService };
