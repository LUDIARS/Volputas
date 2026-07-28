'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const MAX_ANSWERS_FILE_BYTES = 1024 * 1024;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function readAnswersFile(
  filePath,
  {
    cwd = process.cwd(),
    stat = fs.statSync,
    readFile = fs.readFileSync,
    maxBytes = MAX_ANSWERS_FILE_BYTES,
  } = {}
) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError('Answers file path must be a non-empty string');
  }

  const absolutePath = path.resolve(cwd, filePath);
  let metadata;
  try {
    metadata = stat(absolutePath);
  } catch {
    throw new Error('Answers file is unavailable');
  }
  if (!metadata.isFile()) {
    throw new Error('Answers path must identify a regular file');
  }
  if (metadata.size > maxBytes) {
    throw new Error(`Answers file exceeds the ${maxBytes}-byte limit`);
  }

  let answers;
  try {
    const bytes = readFile(absolutePath);
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('Answers reader must return bytes');
    }
    answers = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    // The parser error can echo answer content, so expose only a fixed diagnostic.
    throw new Error('Answers file is not valid UTF-8 JSON');
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('Answers JSON root must be an object keyed by question ID');
  }
  return answers;
}

module.exports = {
  MAX_ANSWERS_FILE_BYTES,
  readAnswersFile,
};
