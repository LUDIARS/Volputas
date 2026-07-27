'use strict';

const path = require('node:path');
const { spawnSync: nodeSpawnSync } = require('node:child_process');

const DEFAULT_MAX_BUFFER = 1024 * 1024;

class ProcessExecutionError extends Error {
  constructor(message, {
    executable,
    exitCode = null,
    signal = null,
    reason,
  }) {
    super(message);
    this.name = 'ProcessExecutionError';
    this.code = 'PROCESS_EXECUTION_FAILED';
    this.executable = executable;
    this.exitCode = exitCode;
    this.signal = signal;
    this.reason = reason;
  }
}

function createProcessRunner({
  spawnSync = nodeSpawnSync,
  maxBuffer = DEFAULT_MAX_BUFFER,
} = {}) {
  if (typeof spawnSync !== 'function') {
    throw new TypeError('spawnSync must be a function');
  }
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0) {
    throw new TypeError('maxBuffer must be a positive integer');
  }

  return Object.freeze({
    run(executable, args, {
      cwd,
      allowedExitCodes = [0],
    } = {}) {
      validateInvocation(executable, args, cwd, allowedExitCodes);

      let result;
      try {
        result = spawnSync(executable, [...args], {
          cwd,
          shell: false,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          maxBuffer,
        });
      } catch {
        throw createSanitizedError(executable, {
          reason: 'spawn-threw',
        });
      }

      if (!result || typeof result !== 'object') {
        throw createSanitizedError(executable, {
          reason: 'invalid-result',
        });
      }
      if (result.error) {
        throw createSanitizedError(executable, {
          reason: 'spawn-error',
        });
      }

      const exitCode = Number.isInteger(result.status) ? result.status : null;
      if (!allowedExitCodes.includes(exitCode)) {
        throw createSanitizedError(executable, {
          exitCode,
          signal: normalizeSignal(result.signal),
          reason: 'nonzero-exit',
        });
      }

      return Object.freeze({
        status: exitCode,
        signal: normalizeSignal(result.signal),
        stdout: normalizeOutput(result.stdout),
        stderr: normalizeOutput(result.stderr),
      });
    },
  });
}

function validateInvocation(executable, args, cwd, allowedExitCodes) {
  if (
    typeof executable !== 'string'
    || executable.length === 0
    || /[\0\r\n]/.test(executable)
  ) {
    throw new TypeError('executable must be a non-empty command name');
  }
  if (
    !Array.isArray(args)
    || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
  ) {
    throw new TypeError('process arguments must be an array of strings');
  }
  if (typeof cwd !== 'string' || cwd.length === 0 || !path.isAbsolute(cwd)) {
    throw new TypeError('cwd must be an explicit absolute path');
  }
  if (
    !Array.isArray(allowedExitCodes)
    || allowedExitCodes.length === 0
    || allowedExitCodes.some((code) => !Number.isInteger(code))
  ) {
    throw new TypeError('allowedExitCodes must contain integer exit codes');
  }
}

function createSanitizedError(executable, {
  exitCode = null,
  signal = null,
  reason,
}) {
  const displayName = path.basename(executable);
  let outcome = 'failed to start';
  if (exitCode !== null) {
    outcome = `failed with exit code ${exitCode}`;
  } else if (signal) {
    outcome = `was terminated by signal ${signal}`;
  }

  return new ProcessExecutionError(
    `Process "${displayName}" ${outcome}.`,
    {
      executable: displayName,
      exitCode,
      signal,
      reason,
    }
  );
}

function normalizeOutput(output) {
  if (typeof output === 'string') {
    return output;
  }
  if (Buffer.isBuffer(output)) {
    return output.toString('utf8');
  }
  return '';
}

function normalizeSignal(signal) {
  return typeof signal === 'string' && signal.length > 0 ? signal : null;
}

module.exports = {
  ProcessExecutionError,
  createProcessRunner,
};
