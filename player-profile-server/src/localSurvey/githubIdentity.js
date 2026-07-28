'use strict';

const { createProcessRunner } = require('./processRunner');

const GITHUB_LOGIN_PATTERN = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_ID_PATTERN = /^[1-9]\d{0,19}$/;
const GITHUB_IDENTITY_QUERY = '{id: (.id | tostring), login: .login}';

class GithubIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GithubIdentityError';
    this.code = 'GITHUB_IDENTITY_UNAVAILABLE';
  }
}

function normalizeGithubIdentity(identity) {
  if (!isPlainObject(identity)) {
    throw new TypeError('GitHub identity must be a plain object');
  }

  const login = requireBoundedString(identity.login, 'GitHub login', 39);
  if (!GITHUB_LOGIN_PATTERN.test(login)) {
    throw new TypeError('GitHub login is invalid');
  }

  let id;
  if (Number.isSafeInteger(identity.id) && identity.id > 0) {
    id = String(identity.id);
  } else if (typeof identity.id === 'string' && GITHUB_ID_PATTERN.test(identity.id)) {
    id = identity.id;
  } else {
    throw new TypeError('GitHub id must be a positive numeric id');
  }

  return { id, login };
}

function resolveGithubIdentity({
  cwd,
  runner = createProcessRunner(),
  githubCommand = 'gh',
} = {}) {
  validateRunner(runner);
  validateCommand(githubCommand, 'githubCommand');

  let output;
  try {
    output = runner.run(
      githubCommand,
      ['api', 'user', '--jq', GITHUB_IDENTITY_QUERY],
      { cwd }
    ).stdout;
  } catch {
    throw new GithubIdentityError(
      'Unable to read the authenticated GitHub identity with GitHub CLI.'
    );
  }

  try {
    return normalizeGithubIdentity(JSON.parse(output));
  } catch {
    // Do not attach the raw API response: it may contain profile data.
    throw new GithubIdentityError(
      'GitHub CLI returned an invalid authenticated identity.'
    );
  }
}

function validateRunner(runner) {
  if (!runner || typeof runner.run !== 'function') {
    throw new TypeError('runner must expose a run function');
  }
}

function validateCommand(command, label) {
  if (
    typeof command !== 'string'
    || command.length === 0
    || /[\0\r\n]/.test(command)
  ) {
    throw new TypeError(`${label} must be a non-empty executable`);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireBoundedString(value, label, maximumLength) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximumLength
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

module.exports = {
  GithubIdentityError,
  normalizeGithubIdentity,
  resolveGithubIdentity,
};
