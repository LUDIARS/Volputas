'use strict';

function stringifyDeterministicJson(value) {
  return JSON.stringify(canonicalizeJsonValue(value, new WeakSet()), null, 2);
}

function canonicalizeJsonValue(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Authoritative JSON cannot contain non-finite numbers');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Authoritative JSON cannot contain ${typeof value} values`);
  }
  if (ancestors.has(value)) {
    throw new TypeError('Authoritative JSON cannot contain circular references');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalizeJsonValue(entry, ancestors));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Authoritative JSON can contain only plain objects and arrays');
    }

    const enumerableSymbols = Object.getOwnPropertySymbols(value)
      .filter((symbol) => Object.prototype.propertyIsEnumerable.call(value, symbol));
    if (enumerableSymbols.length > 0) {
      throw new TypeError('Authoritative JSON cannot contain symbol keys');
    }

    const result = Object.create(null);
    for (const key of Object.keys(value).sort(compareStrings)) {
      result[key] = canonicalizeJsonValue(value[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

module.exports = { stringifyDeterministicJson };
