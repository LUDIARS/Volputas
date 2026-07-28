// Anthropic-backed text generation transport for opt-in LLM features.
// Missing credentials fail fast at call time (no silent stub fallback);
// the server itself starts fine without a key.
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16000;

function configurationError() {
  return Object.assign(
    new Error('LLM is not configured: set ANTHROPIC_API_KEY to enable AI evaluation'),
    { code: 'LLM_NOT_CONFIGURED', statusCode: 503 }
  );
}

class AnthropicTextClient {
  constructor({
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = process.env.VOLPUTAS_LLM_MODEL || DEFAULT_MODEL,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.client = null;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generate({ system, prompt, maxTokens = DEFAULT_MAX_TOKENS }) {
    if (!this.isConfigured()) throw configurationError();
    if (!this.client) {
      // Lazy require: the SDK is only loaded when the feature is actually used.
      const Anthropic = require('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    // Server-side fallbacks: policy declines are retried on Anthropic's
    // recommended substitute model instead of surfacing as empty output.
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'refusal') {
      throw Object.assign(new Error('LLM declined to evaluate this content'), {
        code: 'LLM_REFUSED',
        statusCode: 502,
      });
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!text) {
      throw Object.assign(new Error('LLM returned an empty evaluation'), {
        code: 'LLM_EMPTY_RESPONSE',
        statusCode: 502,
      });
    }
    return { text, model: response.model };
  }
}

module.exports = { AnthropicTextClient, DEFAULT_MODEL };
