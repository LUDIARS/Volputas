const path = require('node:path');
const { defaultGitRunner } = require('./gitCli');

// @implements SPEC-LOCAL-DATA-REPOSITORY-VISIBILITY (Remote identification interface)
//   spec/interface/local-data-repository-visibility.md
//
// Capture groups double as the "is this a GitHub remote" test and the owner/repo
// extraction used by parseGithubOwnerRepo, so the two never drift apart. The segment
// charset is GitHub's own (letters, digits, `-`, `_`, `.`): the extracted owner/repo
// is interpolated into a `gh api repos/<owner>/<repo>` path, so anything that could
// re-point that path (`/`, escapes, whitespace) must not survive parsing.
const OWNER = '[A-Za-z0-9_.-]+';
const REPO = '[A-Za-z0-9_.-]+?';
const GITHUB_REMOTE_PATTERNS = [
  new RegExp(`^git@github\\.com:(${OWNER})/(${REPO})(?:\\.git)?$`, 'i'),
  new RegExp(`^ssh://git@github\\.com/(${OWNER})/(${REPO})(?:\\.git)?$`, 'i'),
  new RegExp(`^https://github\\.com/(${OWNER})/(${REPO})(?:\\.git)?$`, 'i'),
];

// `.` / `..` pass the charset above but would turn `repos/<owner>/<repo>` into a
// different GitHub API path once the URL is normalized, so they are not owner/repo
// names this flow will ever accept.
const RELATIVE_PATH_SEGMENTS = new Set(['.', '..']);

// Accepting a remote and being able to derive its owner/repo are the same question,
// so the check is the parse: a remote the visibility check could not address must not
// be accepted as the data repository in the first place.
function isGitHubRemote(value) {
  try {
    parseGithubOwnerRepo(value);
    return true;
  } catch {
    return false;
  }
}

// The company data repository is identified as "owner/repo" wherever we call the
// GitHub API (visibility check) or GitHub CLI, independent of which remote URL form
// (ssh/ssh-url/https) the local clone happens to use.
function parseGithubOwnerRepo(remoteUrl) {
  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = pattern.exec(remoteUrl);
    if (match && !RELATIVE_PATH_SEGMENTS.has(match[1]) && !RELATIVE_PATH_SEGMENTS.has(match[2])) {
      return `${match[1]}/${match[2]}`;
    }
  }
  throw Object.assign(new Error('The data repository origin must be a GitHub repository'), {
    code: 'GITHUB_REMOTE_REQUIRED',
  });
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

module.exports = {
  GitAuthorReader,
  defaultGitRunner,
  isGitHubRemote,
  parseGithubOwnerRepo,
};
