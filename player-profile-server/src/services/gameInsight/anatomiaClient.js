// Thin adapter over the Anatomia CLI (`node <anatomia.mjs> context|find`)
// used to locate the code behind a game moment (spec/feature/game-insight.md
// §改善提案 3). The CLI path comes from VOLPUTAS_ANATOMIA_CLI; the project must
// already be registered and analyzed on the Anatomia side. No shell: the
// script path, project name and free-text task are passed as argv entries and
// the project name is restricted to a safe charset.
const { spawn } = require('node:child_process');

const PROJECT_PATTERN = /^[A-Za-z0-9._-]+$/;
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAXIMUM_EXEMPLARS = 6;
const MAXIMUM_FIND_HITS = 4;

/** @implements SPEC-GAME-INSIGHT */
function anatomiaError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @implements SPEC-GAME-INSIGHT */
function assertProjectName(value) {
  const project = String(value || '').trim();
  if (!PROJECT_PATTERN.test(project)) {
    throw anatomiaError(400, 'INVALID_ANATOMIA_PROJECT', 'Anatomia project name contains unsupported characters');
  }
  return project;
}

// Shape reduction of a ContextBundle / find result to what the prompt needs.
/** @implements SPEC-GAME-INSIGHT */
function reduceExemplars(bundle) {
  const exemplars = Array.isArray(bundle?.exemplars) ? bundle.exemplars : [];
  return exemplars.slice(0, MAXIMUM_EXEMPLARS).map((exemplar) => ({
    name: exemplar.name || '',
    filePath: exemplar.sourceRange?.filePath || exemplar.filePath || '',
    startLine: exemplar.sourceRange?.start?.line ?? exemplar.startLine ?? null,
    endLine: exemplar.sourceRange?.end?.line ?? exemplar.endLine ?? null,
    signature: String(exemplar.signature || '').replace(/\s+/g, ' ').slice(0, 160),
  }));
}

/** @implements SPEC-GAME-INSIGHT */
function reduceFindHits(result) {
  const hits = Array.isArray(result?.hits) ? result.hits : [];
  return hits.slice(0, MAXIMUM_FIND_HITS).map((hit) => ({
    name: hit.name || '',
    filePath: hit.filePath || '',
    startLine: hit.startLine ?? null,
    endLine: hit.endLine ?? null,
    signature: String(hit.signature || '').replace(/\s+/g, ' ').slice(0, 160),
  }));
}

/** @implements SPEC-GAME-INSIGHT */
class AnatomiaClient {
  constructor({
    cliPath = process.env.VOLPUTAS_ANATOMIA_CLI || '',
    nodePath = process.execPath,
    spawnImpl = spawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.cliPath = cliPath;
    this.nodePath = nodePath;
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.cliPath);
  }

  run(args) {
    if (!this.isConfigured()) {
      throw anatomiaError(503, 'ANATOMIA_NOT_CONFIGURED',
        'Anatomia CLI is not configured: set VOLPUTAS_ANATOMIA_CLI to the absolute path of anatomia.mjs');
    }
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.nodePath, [this.cliPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => {
        finish(anatomiaError(504, 'ANATOMIA_TIMEOUT', `Anatomia CLI timed out after ${this.timeoutMs}ms`));
        child.kill();
      }, this.timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
      child.on('error', (error) => finish(anatomiaError(502, 'ANATOMIA_SPAWN_FAILED', error.message)));
      child.on('close', (exitCode) => {
        if (exitCode !== 0) {
          finish(anatomiaError(502, 'ANATOMIA_FAILED', `Anatomia CLI exited with ${exitCode}: ${stderr.trim().slice(-300)}`));
          return;
        }
        finish(null, stdout);
      });
    });
  }

  static parseJson(stdout) {
    const text = String(stdout || '').trim();
    if (!text || text === '(no hits)') return null;
    // The CLI may print observability noise before the JSON; start at the first brace.
    const start = text.indexOf('{');
    if (start < 0) return null;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      return null;
    }
  }

  async context(project, task) {
    const name = assertProjectName(project);
    const stdout = await this.run(['context', '--project', name, '--task', String(task || '').slice(0, 300)]);
    const bundle = AnatomiaClient.parseJson(stdout);
    return {
      existingDomains: Array.isArray(bundle?.existingDomains) ? bundle.existingDomains.slice(0, 12) : [],
      exemplars: reduceExemplars(bundle),
    };
  }

  async findSymbol(project, symbol) {
    const name = assertProjectName(project);
    const identifier = String(symbol || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return [];
    const stdout = await this.run(['find', '--project', name, '--symbol', identifier, '--json']);
    return reduceFindHits(AnatomiaClient.parseJson(stdout));
  }
}

module.exports = {
  AnatomiaClient,
  MAXIMUM_EXEMPLARS,
  MAXIMUM_FIND_HITS,
  assertProjectName,
  reduceExemplars,
  reduceFindHits,
};
