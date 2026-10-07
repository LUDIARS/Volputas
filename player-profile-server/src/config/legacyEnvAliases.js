// 旧綴り VOLPUTAS_* の env を VOLUPTAS_* として読めるようにする互換層。
// Excubitor が配る VOLPUTAS_URL や Vault の VOLPUTAS_DATABASE_URL などが新しい綴りへ
// 切り替わるまでの間だけ使う。新しい名前が既にあればそちらを優先し、上書きしない。
const LEGACY_PREFIX = 'VOLPUTAS_';
const PREFIX = 'VOLUPTAS_';

function applyLegacyEnvAliases(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_PREFIX)) continue;
    const name = PREFIX + key.slice(LEGACY_PREFIX.length);
    if (env[name] === undefined) env[name] = value;
  }
  return env;
}

applyLegacyEnvAliases();

module.exports = { applyLegacyEnvAliases };
