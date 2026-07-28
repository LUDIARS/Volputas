const path = require('node:path');
const { defaultGitRunner } = require('./gitCli');

function isGitHubRemote(value) {
  return /^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/i.test(value)
    || /^ssh:\/\/git@github\.com\/[^/]+\/[^/]+(?:\.git)?$/i.test(value)
    || /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/i.test(value);
}

class GitAuthorReader {
  constructor(runGit = defaultGitRunner) {
    this.runGit = runGit;
  }

  async read(dataRepositoryPath) {
    const repositoryPath = path.resolve(dataRepositoryPath);
    const repositoryRoot = await this.#readValue(
      ['-C', repositoryPath, 'rev-parse', '--show-toplevel'],
      'The configured data path is not a Git repository'
    );
    const name = await this.#readValue(
      ['-C', repositoryRoot, 'config', '--get', 'user.name'],
      'git user.name is not configured for the data repository'
    );
    const email = await this.#readValue(
      ['-C', repositoryRoot, 'config', '--get', 'user.email'],
      'git user.email is not configured for the data repository'
    );
    const remoteUrl = await this.#readValue(
      ['-C', repositoryRoot, 'config', '--get', 'remote.origin.url'],
      'The data repository has no origin remote'
    );
    if (!isGitHubRemote(remoteUrl)) {
      throw Object.assign(new Error('The data repository origin must be a GitHub repository'), {
        code: 'GITHUB_REMOTE_REQUIRED',
      });
    }

    return {
      repositoryRoot: path.resolve(repositoryRoot),
      name,
      email,
      remoteUrl,
    };
  }

  async #readValue(args, message) {
    try {
      const result = await this.runGit(args);
      const value = result.stdout.trim();
      if (value) return value;
    } catch (error) {
      throw Object.assign(new Error(message), {
        code: 'GIT_AUTHOR_UNAVAILABLE',
        cause: error,
      });
    }

    throw Object.assign(new Error(message), {
      code: 'GIT_AUTHOR_UNAVAILABLE',
    });
  }
}

module.exports = { GitAuthorReader, defaultGitRunner, isGitHubRemote };
