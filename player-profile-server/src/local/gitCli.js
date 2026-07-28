const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function defaultGitRunner(args) {
  return execFileAsync('git', args, {
    encoding: 'utf8',
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
}

module.exports = { GitCli, defaultGitRunner };
