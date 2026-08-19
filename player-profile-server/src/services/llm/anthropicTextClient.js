// Anthropic-backed text generation transport for opt-in LLM features.
// Missing credentials fail fast at call time (no silent stub fallback);
// the server itself starts fine without a key.
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16000;

const IMAGE_MEDIA_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

function configurationError() {
  return Object.assign(
    new Error('LLM is not configured: set ANTHROPIC_API_KEY to enable AI evaluation'),
    { code: 'LLM_NOT_CONFIGURED', statusCode: 503 }
  );
}

/** @implements SPEC-GAME-INSIGHT */
async function buildUserContent(prompt, imagePaths) {
  const content = [];
  const supplied = Array.isArray(imagePaths) ? imagePaths.map((imagePath) => String(imagePath)) : [];
  let sanitizedPrompt = String(prompt);
  for (const [index, imagePath] of supplied.entries()) {
    const mediaType = IMAGE_MEDIA_TYPES.get(path.extname(String(imagePath)).toLowerCase());
    if (!mediaType) {
      throw Object.assign(new Error(`Unsupported LLM image type: ${path.extname(String(imagePath))}`), {
        code: 'LLM_IMAGE_UNSUPPORTED',
        statusCode: 400,
      });
    }
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: (await fs.readFile(imagePath)).toString('base64'),
      },
    });
    sanitizedPrompt = sanitizedPrompt.replaceAll(imagePath, `[attached image ${index + 1}]`);
    sanitizedPrompt = sanitizedPrompt.replaceAll(path.resolve(imagePath), `[attached image ${index + 1}]`);
  }
  content.push({ type: 'text', text: sanitizedPrompt });
  return content;
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

  /** @implements SPEC-GAME-INSIGHT */
  async generate({ system, prompt, imagePaths = [], maxTokens = DEFAULT_MAX_TOKENS }) {
    if (!this.isConfigured()) throw configurationError();
    if (!this.client) {
      // Lazy require: the SDK is only loaded when the feature is actually used.
      const Anthropic = require('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    // Server-side fallbacks: policy declines are retried on Anthropic's
    // recommended substitute model instead of surfacing as empty output.
    const content = await buildUserContent(prompt, imagePaths);
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content }],
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

module.exports = { AnthropicTextClient, DEFAULT_MODEL, buildUserContent };
