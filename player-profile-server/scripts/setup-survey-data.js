'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(serverRoot, 'private', 'survey-data');
const repositoryUrl = 'https://github.com/LUDIARS/VolputasData.git';

try {
  const targetExists = fs.existsSync(dataRoot);
  const targetIsEmpty = (
    targetExists
    && fs.statSync(dataRoot).isDirectory()
    && fs.readdirSync(dataRoot).length === 0
  );
  if (targetExists && !targetIsEmpty) {
    assertExistingClone(dataRoot);
    process.stdout.write(`VolputasData is already available at ${dataRoot}\n`);
    return;
  }

  fs.mkdirSync(path.dirname(dataRoot), { recursive: true });
  execFileSync('git', [
    'clone',
    '--branch',
    'main',
    '--single-branch',
    repositoryUrl,
    dataRoot,
  ], {
    cwd: serverRoot,
    stdio: 'inherit',
  });
} catch (error) {
  process.stderr.write(
    '[fatal] Unable to prepare the independent VolputasData clone. ' +
    'Remove or move any conflicting directory, then retry.\n'
  );
  process.exitCode = error.status || 1;
}

function assertExistingClone(target) {
  const topLevel = execFileSync(
    'git',
    ['rev-parse', '--show-toplevel'],
    { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();
  const originUrl = execFileSync(
    'git',
    ['remote', 'get-url', 'origin'],
    { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();

  if (path.resolve(topLevel) !== path.resolve(target)) {
    throw new Error('Survey data path is nested inside a different repository');
  }
  if (normalizeRepositoryUrl(originUrl) !== normalizeRepositoryUrl(repositoryUrl)) {
    throw new Error('Survey data origin does not point to VolputasData');
  }
}

function normalizeRepositoryUrl(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}
