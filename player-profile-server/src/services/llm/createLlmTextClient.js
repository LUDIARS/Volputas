// Backend selection for LLM text generation. Default is the local Claude Code
// CLI (`claude -p`) so no API key is required; the Anthropic API transport is
// an explicit opt-in via VOLPUTAS_LLM_BACKEND=anthropic.
const { AnthropicTextClient } = require('./anthropicTextClient');
const { ClaudeCliTextClient } = require('./claudeCliTextClient');

const DEFAULT_BACKEND = 'claude-cli';

function createLlmTextClient({ env = process.env } = {}) {
  const backend = (env.VOLPUTAS_LLM_BACKEND || DEFAULT_BACKEND).toLowerCase();
  if (backend === 'claude-cli') return new ClaudeCliTextClient();
  if (backend === 'anthropic') return new AnthropicTextClient();
  throw Object.assign(
    new Error(`Unknown VOLPUTAS_LLM_BACKEND: ${backend} (expected claude-cli or anthropic)`),
    { code: 'LLM_CONFIG_INVALID', statusCode: 503 }
  );
}

module.exports = { DEFAULT_BACKEND, createLlmTextClient };
