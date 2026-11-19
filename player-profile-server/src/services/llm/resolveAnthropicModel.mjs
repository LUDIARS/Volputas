import { MODEL_ROLES, resolveModel } from '@ludiars/one-shot';

export function resolveAnthropicModel(model) {
  if (!MODEL_ROLES.claude.includes(model)) return model;

  try {
    const resolved = resolveModel(model, 'claude');
    // The shared resolver can return a Claude CLI alias when no mapping exists.
    if (resolved !== model) return resolved;
  } catch (cause) {
    throw configurationError(model, cause);
  }
  throw configurationError(model);
}

function configurationError(model, cause) {
  return Object.assign(
    new Error(`LLM is not configured: set the Concordia model role mapping for ${model}`, { cause }),
    { code: 'LLM_NOT_CONFIGURED', statusCode: 503 },
  );
}
