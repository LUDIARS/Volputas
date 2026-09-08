const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const REPOSITORY_VISIBILITY_QUERY = (
  '{fullName: .full_name, private: .private, visibility: .visibility}'
);

// Long enough that a burst of local API calls costs one `gh` invocation, short enough
// that a repository flipped to public is refused within minutes rather than only after
// the app is restarted. A desktop app can stay open for days, so a result cached for
// the whole process run would not be the "verified before processing starts" the data
// schema spec promises.
const VERIFICATION_TTL_MS = 5 * 60 * 1000;

async function defaultGithubRunner(args) {
  return execFileAsync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

class DataRepositoryVisibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataRepositoryVisibilityError';
    this.code = 'DATA_REPOSITORY_NOT_PRIVATE';
    this.statusCode = 422;
  }
}

// @implements SPEC-LOCAL-DATA-REPOSITORY-VISIBILITY (Visibility verification interface)
//   spec/interface/local-data-repository-visibility.md
//
// A company points Local Settings at their own data repository (evidence, personas,
// survey responses — all real player data). That repository must be private: a public
// or internal repository would expose respondents' data to everyone, or to the whole
// GitHub enterprise, well beyond what anyone consented to. This is checked when the
// configuration is saved and again before any local route is allowed to read or write
// through it (see localRoutes.js), so a company can never silently end up processing
// data against a public repository.
//
// `private` and `visibility` are both checked because they come from different
// generations of the GitHub API and an internal repository reports `private: true`
// with `visibility: "internal"` — that is not the private repository this flow
// requires.
class DataRepositoryVisibilityChecker {
  constructor({
    runGithub = defaultGithubRunner,
    now = Date.now,
    ttlMs = VERIFICATION_TTL_MS,
  } = {}) {
    if (typeof runGithub !== 'function') {
      throw new TypeError('runGithub must be a function');
    }
    this.runGithub = runGithub;
    this.now = now;
    this.ttlMs = ttlMs;
    // Verifying is a network call; memoize the result for a short window so a burst of
    // routes touching the same repository does not re-hit the GitHub API, while a
    // repository that later turns public is still caught. A failed check is evicted
    // immediately so the next request can retry once the company fixes the repository
    // (or `gh` auth) without restarting the app.
    this.verifiedRepositories = new Map();
  }

  assertPrivate(ownerRepo) {
    const cacheKey = ownerRepo.toLowerCase();
    const cached = this.verifiedRepositories.get(cacheKey);
    if (cached && this.now() - cached.startedAt < this.ttlMs) return cached.verification;

    const entry = { startedAt: this.now(), verification: null };
    entry.verification = this.#verify(ownerRepo).catch((error) => {
      if (this.verifiedRepositories.get(cacheKey) === entry) {
        this.verifiedRepositories.delete(cacheKey);
      }
      throw error;
    });
    this.verifiedRepositories.set(cacheKey, entry);
    return entry.verification;
  }

  async #verify(ownerRepo) {
    let stdout;
    try {
      ({ stdout } = await this.runGithub([
        'api',
        `repos/${ownerRepo}`,
        '--jq',
        REPOSITORY_VISIBILITY_QUERY,
      ]));
    } catch {
      throw new DataRepositoryVisibilityError(
        `Unable to verify the visibility of the data repository "${ownerRepo}" via the ` +
        'GitHub CLI ("gh"). Confirm "gh" is installed and authenticated ' +
        '(gh auth login) for a user with read access to that repository, then retry.'
      );
    }

    let metadata;
    try {
      metadata = JSON.parse(stdout);
    } catch {
      throw new DataRepositoryVisibilityError(
        `GitHub CLI returned invalid repository visibility metadata for "${ownerRepo}".`
      );
    }

    if (
      typeof metadata?.fullName !== 'string'
      || metadata.fullName.toLowerCase() !== ownerRepo.toLowerCase()
      || metadata.private !== true
      || metadata.visibility !== 'private'
    ) {
      throw new DataRepositoryVisibilityError(
        `The data repository "${ownerRepo}" is not private (visibility: ` +
        `${typeof metadata?.visibility === 'string' ? metadata.visibility : 'unknown'}). ` +
        'Create or use a private repository for player data before saving Local Settings.'
      );
    }

    return Object.freeze({
      fullName: metadata.fullName,
      isPrivate: true,
      visibility: 'private',
    });
  }
}

module.exports = {
  DataRepositoryVisibilityChecker,
  DataRepositoryVisibilityError,
  VERIFICATION_TTL_MS,
  defaultGithubRunner,
};
