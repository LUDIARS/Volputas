const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { analyzePersonaV2 } = require('../services/personaEvidence/analyzePersonaV2');
const { appendAnalysisHistory } = require('../services/personaEvidence/analysisHistory');
const { collectionDirectory, insideRepository } = require('../services/profileDataPaths');
const { canonicalize, fingerprintSources } = require('../services/personaFingerprint');

async function readJsonFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const values = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(directory, entry.name);
    try {
      values.push(JSON.parse(await fs.readFile(filePath, 'utf8')));
    } catch (error) {
      throw Object.assign(new Error(`Persona source is not valid JSON: ${filePath}`), {
        code: 'INVALID_PERSONA_SOURCE',
      });
    }
  }
  return values.sort((left, right) => String(left.id || left.survey?.id || '')
    .localeCompare(String(right.id || right.survey?.id || '')));
}

class PersonaService {
  constructor({ gameplayStore, voiceStore, emotionCurveStore, now = () => new Date() }) {
    this.gameplayStore = gameplayStore;
    this.voiceStore = voiceStore;
    this.emotionCurveStore = emotionCurveStore;
    this.now = now;
  }

  async readSources({ repositoryRoot, name }) {
    const [surveys, gameplay, voices, emotionCurves] = await Promise.all([
      readJsonFiles(collectionDirectory(repositoryRoot, 'answers', name)),
      this.gameplayStore.list({ repositoryRoot, name }),
      this.voiceStore.list({ repositoryRoot, name }),
      this.emotionCurveStore.list({ repositoryRoot, name }),
    ]);
    return { surveys, gameplay, voices, emotionCurves };
  }

  analysisPath(repositoryRoot, name) {
    return insideRepository(
      collectionDirectory(repositoryRoot, 'analysis', name),
      'persona.json'
    );
  }

  async readAnalysis(repositoryRoot, name) {
    try {
      return JSON.parse(await fs.readFile(this.analysisPath(repositoryRoot, name), 'utf8'));
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

  async status(context) {
    const sources = await this.readSources(context);
    const sourceFingerprint = fingerprintSources(sources);
    const analysis = await this.readAnalysis(context.repositoryRoot, context.name);
    const evidenceCount = Object.values(sources).reduce((sum, records) => sum + records.length, 0);
    return {
      analysis,
      evidenceCount,
      stale: evidenceCount > 0 && analysis?.sourceFingerprint !== sourceFingerprint,
    };
  }

  async analyze(context) {
    const sources = await this.readSources(context);
    const evidenceCount = Object.values(sources).reduce((sum, records) => sum + records.length, 0);
    if (evidenceCount === 0) {
      throw Object.assign(new Error('Register or answer at least one item before analysis'), {
        code: 'PERSONA_INPUT_REQUIRED',
      });
    }
    const sourceFingerprint = fingerprintSources(sources);
    const existing = await this.readAnalysis(context.repositoryRoot, context.name);
    if (existing?.sourceFingerprint === sourceFingerprint) {
      return { analysis: existing, recomputed: false };
    }

    const analysis = {
      ...analyzePersonaV2(sources, this.now().toISOString()),
      sourceFingerprint,
    };
    const filePath = this.analysisPath(context.repositoryRoot, context.name);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
    await appendAnalysisHistory({
      repositoryRoot: context.repositoryRoot,
      name: context.name,
      analysis,
    });
    return { analysis, recomputed: true, filePath };
  }
}

module.exports = {
  PersonaService,
  canonicalize,
  fingerprintSources,
  readJsonFiles,
};
