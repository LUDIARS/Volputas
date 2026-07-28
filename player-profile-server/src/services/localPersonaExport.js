const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ensureSafeRepositoryDirectory } = require('../localSurvey/safeRepositoryPath');
const { collectionDirectory, insideRepository } = require('./profileDataPaths');
const { buildPersonaExport, toJsonLines } = require('./personaExport');

async function readPersonaAnalysis(config) {
  const filePath = insideRepository(
    collectionDirectory(config.dataRepositoryPath, 'analysis', config.name),
    'persona.json'
  );
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error('Persona analysis file is not valid JSON'), {
        code: 'INVALID_PERSONA_ANALYSIS',
      });
    }
    throw error;
  }
}

async function assertReplaceableFile(filePath) {
  try {
    const metadata = await fs.lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw Object.assign(new Error('Persona export target is not a regular file'), {
        code: 'UNSAFE_PERSONA_EXPORT_PATH',
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeAtomically(filePath, text) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await assertReplaceableFile(filePath);
  try {
    await fs.writeFile(temporaryPath, text, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function exportLocalPersona({ config, secret }) {
  const exportDirectory = insideRepository(config.dataRepositoryPath, 'exports');
  ensureSafeRepositoryDirectory(config.dataRepositoryPath, exportDirectory);
  const filePath = insideRepository(exportDirectory, 'personas.jsonl');
  const analysis = config.researchExportConsent
    ? await readPersonaAnalysis(config)
    : null;
  const persona = buildPersonaExport({
    analysis,
    consent: config.researchExportConsent,
    identity: config.name,
    traits: analysis?.classification?.tags,
  }, secret);
  const personas = persona ? [persona] : [];
  await writeAtomically(filePath, toJsonLines(personas));
  return { count: personas.length, filePath };
}

module.exports = {
  assertReplaceableFile,
  exportLocalPersona,
  readPersonaAnalysis,
  writeAtomically,
};
