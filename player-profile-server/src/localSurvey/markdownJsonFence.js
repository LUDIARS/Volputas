'use strict';

const { stringifyDeterministicJson } = require('./deterministicJson');

function renderAuthoritativeJsonFence(value) {
  const json = stringifyDeterministicJson(value);
  const longestBacktickRun = Math.max(
    0,
    ...(json.match(/`+/g) || []).map((run) => run.length)
  );
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}json\n${json}\n${fence}`;
}

module.exports = { renderAuthoritativeJsonFence };
