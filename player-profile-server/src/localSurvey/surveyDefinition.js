'use strict';

const SURVEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SURVEY_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function normalizeSurveyDefinition(definition) {
  if (!isPlainObject(definition)) {
    throw new TypeError('Survey definition must be a plain object');
  }

  const id = requireBoundedString(definition.id, 'Survey definition id', 100);
  if (!SURVEY_ID_PATTERN.test(id)) {
    throw new TypeError('Survey definition id must be a lowercase path-safe identifier');
  }

  const version = requireBoundedString(
    definition.version,
    'Survey definition version',
    100
  );
  if (!SURVEY_VERSION_PATTERN.test(version)) {
    throw new TypeError('Survey definition version must be a semantic version');
  }

  const title = requireBoundedString(definition.title, 'Survey definition title', 500);
  const description = requireBoundedString(
    definition.description,
    'Survey definition description',
    10_000
  );

  if (!Array.isArray(definition.questions) || definition.questions.length === 0) {
    throw new TypeError('Survey definition questions must be a non-empty array');
  }

  return {
    id,
    version,
    title,
    description,
    questions: definition.questions,
  };
}

function requireBoundedString(value, label, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (Array.from(value).length > maxLength) {
    throw new TypeError(`${label} exceeds its maximum length`);
  }
  if (hasUnsafeUnicode(value)) {
    throw new TypeError(`${label} contains unsafe Unicode`);
  }
  return value;
}

function hasUnsafeUnicode(value) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    return true;
  }

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xDC00 || nextCodeUnit > 0xDFFF) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return true;
    }
  }

  return false;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = {
  normalizeSurveyDefinition,
  requireBoundedString,
  hasUnsafeUnicode,
  isPlainObject,
};
