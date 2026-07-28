const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function defaultGitRunner(args) {
  return execFileAsync('git', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

class GitCli {
  constructor(runGit = defaultGitRunner) {
    this.runGit = runGit;
  }

  async inspect() {
    try {
      const result = await this.runGit(['--version']);
      const version = result.stdout.trim();
      if (!version) throw new Error('Git CLI returned an empty version');
      return { available: true, version };
    } catch (error) {
      return {
        available: false,
        version: null,
        error: error.code === 'ENOENT'
          ? 'Git CLI was not found in PATH'
          : `Git CLI could not be executed: ${error.message}`,
      };
    }
  }

  async assertAvailable() {
    const status = await this.inspect();
    if (status.available) return status;
    throw Object.assign(new Error(status.error), {
      code: 'GIT_CLI_UNAVAILABLE',
    });
  }

  async execute(args) {
    if (!Array.isArray(args) || args.length === 0) {
      throw Object.assign(new Error('Git command arguments are required'), {
        code: 'INVALID_GIT_COMMAND',
      });
    }
    return this.runGit(args);
  }
}

module.exports = { GitCli, defaultGitRunner };
