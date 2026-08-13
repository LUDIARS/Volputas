// Resolves the configured local-mode context ({ config, gitAuthor }) shared by
// every /api/local router. Extracted from localRoutes so additional routers
// (capture sessions) reuse the exact same configuration contract instead of
// growing a second, drifting copy.
const { AppError } = require('../middleware/errorHandler');

function createConfiguredContext({ configStore, gitAuthorReader }) {
  return async function configuredContext() {
    const storedConfig = await configStore.read();
    if (!storedConfig) {
      throw new AppError(
        409,
        'LOCAL_CONFIG_REQUIRED',
        'Set the data repository and GitHub name in Settings first'
      );
    }
    const gitAuthor = await gitAuthorReader.read(storedConfig.dataRepositoryPath);
    const config = storedConfig.name === gitAuthor.name
      ? storedConfig
      : await configStore.write({ ...storedConfig, name: gitAuthor.name });
    return { config, gitAuthor };
  };
}

// The record stores address data by repository root plus respondent name; this
// narrows the full context to exactly that pair.
function storeContext({ config, gitAuthor }) {
  return { repositoryRoot: gitAuthor.repositoryRoot, name: config.name };
}

// Wraps a validated evidence input with the respondent identity every local
// profile record carries (shared by localRoutes and the capture-analysis
// emotion-curve draft route).
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function profileRecord(input, config, gitAuthor) {
  return {
    ...input,
    respondent: {
      name: config.name,
      gitAuthor: {
        name: gitAuthor.name,
        email: gitAuthor.email,
      },
    },
    dataRepository: { remoteUrl: gitAuthor.remoteUrl },
  };
}

module.exports = { createConfiguredContext, profileRecord, storeContext };
