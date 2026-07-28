// Claude Code CLI (`claude -p`) backed text generation. This is the default
// LLM transport: it needs no API key, only a locally authenticated Claude CLI.
// A missing CLI fails fast at call time (no silent stub fallback).
const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const STDERR_EXCERPT_LIMIT = 500;

function configurationError(detail) {
  return Object.assign(
    new Error(`LLM is not configured: ${detail}`),
    { code: 'LLM_NOT_CONFIGURED', statusCode: 503 }
  );
}

class ClaudeCliTextClient {
  constructor({
    command = process.env.VOLPUTAS_CLAUDE_CLI || 'claude',
    model = process.env.VOLPUTAS_LLM_MODEL || '',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    spawnImpl = spawn,
  } = {}) {
    // The command line is assembled from these two values only (the prompt goes
    // through stdin), so restrict them to safe charsets — on Windows the .cmd
    // shim forces shell spawning.
    if (!/^[A-Za-z0-9._\\/:-]+$/.test(command)) {
      throw configurationError(`VOLPUTAS_CLAUDE_CLI contains unsupported characters: ${command}`);
    }
    if (model && !/^[A-Za-z0-9._-]+$/.test(model)) {
      throw configurationError(`VOLPUTAS_LLM_MODEL contains unsupported characters: ${model}`);
    }
    this.command = command;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.spawnImpl = spawnImpl;
  }

  isConfigured() {
    // CLI presence is only observable by running it; generate() fails fast
    // with LLM_NOT_CONFIGURED when the binary is missing.
    return true;
  }

  async generate({ system, prompt }) {
    const args = ['-p', '--output-format', 'text'];
    if (this.model) args.push('--model', this.model);
    const child = this.spawnImpl(this.command, args, {
      // Windows resolves the CLI through a .cmd shim, which Node only spawns
      // via a shell. Arguments are validated constants; the prompt rides stdin.
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        finish(Object.assign(new Error(`Claude CLI timed out after ${this.timeoutMs}ms`), {
          code: 'LLM_CLI_TIMEOUT',
          statusCode: 504,
        }));
        child.kill();
      }, this.timeoutMs);

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          finish(configurationError(
            `Claude CLI (${this.command}) not found — install Claude Code or set VOLPUTAS_LLM_BACKEND=anthropic with ANTHROPIC_API_KEY`
          ));
          return;
        }
        finish(Object.assign(error, { code: error.code || 'LLM_CLI_FAILED', statusCode: 502 }));
      });
      child.on('close', (exitCode) => {
        if (exitCode !== 0) {
          finish(Object.assign(
            new Error(`Claude CLI exited with ${exitCode}: ${stderr.slice(0, STDERR_EXCERPT_LIMIT)}`),
            { code: 'LLM_CLI_FAILED', statusCode: 502 }
          ));
          return;
        }
        const text = stdout.trim();
        if (!text) {
          finish(Object.assign(new Error('Claude CLI returned an empty evaluation'), {
            code: 'LLM_EMPTY_RESPONSE',
            statusCode: 502,
          }));
          return;
        }
        finish(null, { text, model: this.model || 'claude-cli' });
      });

      child.stdin.on('error', () => { /* close/error races surface via 'error'/'close'; best-effort */ });
      child.stdin.end(`${system}\n\n${prompt}`);
    });
  }
}

module.exports = { ClaudeCliTextClient, DEFAULT_TIMEOUT_MS };
