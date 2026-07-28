'use strict';

const FRONTMATTER_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function renderYamlFrontmatter(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('YAML frontmatter entries must be a non-empty array');
  }

  const keys = new Set();
  const lines = ['---'];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError('Each YAML frontmatter entry must be a key/value pair');
    }
    const [key, value] = entry;
    if (typeof key !== 'string' || !FRONTMATTER_KEY_PATTERN.test(key)) {
      throw new TypeError('YAML frontmatter keys must be safe strings');
    }
    if (keys.has(key)) {
      throw new TypeError(`Duplicate YAML frontmatter key: ${key}`);
    }
    keys.add(key);

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${quoteYamlString(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${quoteYamlString(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function quoteYamlString(value) {
  if (typeof value !== 'string') {
    throw new TypeError('YAML frontmatter values must be strings or string arrays');
  }
  return JSON.stringify(value);
}

module.exports = { renderYamlFrontmatter };
