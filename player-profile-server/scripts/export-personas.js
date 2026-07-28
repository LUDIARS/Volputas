const config = require('../src/config');
const { LocalConfigStore } = require('../src/local/localConfigStore');
const { exportLocalPersona } = require('../src/services/localPersonaExport');

async function main() {
  if (!config.pseudoIdSecret) {
    throw new Error('VOLUPTAS_PSEUDO_ID_SECRET is required');
  }
  const localConfig = await new LocalConfigStore().read();
  if (!localConfig) {
    throw new Error('Configure the local data repository before exporting personas');
  }
  const result = await exportLocalPersona({
    config: localConfig,
    secret: config.pseudoIdSecret,
  });
  process.stdout.write(`${JSON.stringify({
    exported: result.count,
    filePath: result.filePath,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`persona export failed: ${error.message}\n`);
  process.exitCode = 1;
});
