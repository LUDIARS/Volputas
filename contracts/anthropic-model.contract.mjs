import { createRequire } from 'node:module';

const require = createRequire(new URL('../player-profile-server/package.json', import.meta.url));
const { MODEL_ROLES, readRoleMap } = require('@ludiars/one-shot');

export default {
  post(result, model) {
    if (!MODEL_ROLES.claude.includes(model)) return result === model;
    const expected = process.env[`LUDIARS_ONESHOT_MODEL_${model.toUpperCase()}`]
      || readRoleMap()?.claude?.[model];
    return typeof expected === 'string' && expected.startsWith('claude-') && result === expected;
  },
};
