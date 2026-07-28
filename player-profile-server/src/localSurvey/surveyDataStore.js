'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ensureSafeRepositoryDirectory } = require('./safeRepositoryPath');

function validateIdentityId(identityId) {
  const value = String(identityId);
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('GitHub identity ID must be a positive decimal integer');
  }
  return value;
}

function validateSurveyId(surveyId) {
  if (typeof surveyId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(surveyId)) {
    throw new Error('Survey ID must be a lowercase kebab-case identifier');
  }
  return surveyId;
}

function surveyArtifactPaths({ surveyId, identityId }) {
  const safeSurveyId = validateSurveyId(surveyId);
  const safeIdentityId = validateIdentityId(identityId);
  return Object.freeze({
    definition: `surveys/${safeSurveyId}.md`,
    response: `responses/github-${safeIdentityId}/${safeSurveyId}.md`,
  });
}

function normalizeDocument(document, label) {
  if (typeof document !== 'string' || document.trim() === '') {
    throw new Error(`${label} document must be a non-empty string`);
  }
  return `${document.replace(/\r\n?/g, '\n').replace(/\n*$/, '')}\n`;
}

function atomicWrite(targetPath, content, {
  repositoryRoot,
  mkdir = fs.mkdirSync,
  lstat = fs.lstatSync,
  realpath = fs.realpathSync.native,
  open = fs.openSync,
  write = fs.writeFileSync,
  close = fs.closeSync,
  rename = fs.renameSync,
  unlink = fs.unlinkSync,
  randomId = crypto.randomUUID,
} = {}) {
  const directory = path.dirname(targetPath);
  ensureSafeRepositoryDirectory(repositoryRoot, directory, {
    lstat,
    mkdir,
    realpath,
  });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomId()}.tmp`
  );

  let descriptor;
  try {
    descriptor = open(temporaryPath, 'wx', 0o600);
    write(descriptor, content, { encoding: 'utf8' });
    close(descriptor);
    descriptor = undefined;
    ensureSafeRepositoryDirectory(repositoryRoot, directory, {
      lstat,
      mkdir,
      realpath,
    });
    rename(temporaryPath, targetPath);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        close(descriptor);
      } catch (closeError) {
        error.closeError = closeError;
      }
    }
    try {
      unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        error.cleanupError = cleanupError;
      }
    }
    throw error;
  }
}

function writeSurveyArtifacts({
  root,
  surveyId,
  identity,
  definitionDocument,
  responseDocument,
  writeAtomic = atomicWrite,
  ensureDirectory = ensureSafeRepositoryDirectory,
}) {
  if (typeof root !== 'string' || root.trim() === '' || !path.isAbsolute(root)) {
    throw new Error('Survey data repository root must be an absolute path');
  }
  const relativePaths = surveyArtifactPaths({
    surveyId,
    identityId: identity?.id,
  });

  const definitionTarget = path.join(
    root,
    ...relativePaths.definition.split('/')
  );
  const responseTarget = path.join(root, ...relativePaths.response.split('/'));
  ensureDirectory(root, path.dirname(definitionTarget));
  ensureDirectory(root, path.dirname(responseTarget));

  writeAtomic(
    definitionTarget,
    normalizeDocument(definitionDocument, 'Survey definition'),
    { repositoryRoot: root }
  );
  writeAtomic(
    responseTarget,
    normalizeDocument(responseDocument, 'Survey response'),
    { repositoryRoot: root }
  );

  return Object.freeze({
    relativePaths: Object.freeze([
      relativePaths.definition,
      relativePaths.response,
    ]),
    ...relativePaths,
  });
}

module.exports = {
  atomicWrite,
  surveyArtifactPaths,
  writeSurveyArtifacts,
};
