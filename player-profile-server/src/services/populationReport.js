const { pseudoId } = require('./pseudoId');

const PSEUDO_ID_PATTERN = /^ext:voluptas:[0-9a-f]{16}$/;
const MAX_REPORT_ENTRIES = 5_000;

function invalidReport(message) {
  return Object.assign(new Error(message), {
    code: 'INVALID_POPULATION_REPORT',
    statusCode: 400,
  });
}

function validatePopulationReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidReport('Population report must be an object');
  }
  if (
    typeof value.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.generatedAt))
  ) {
    throw invalidReport('generatedAt must be an ISO date string');
  }
  if (!Number.isInteger(value.realPopulation) || value.realPopulation < 0) {
    throw invalidReport('realPopulation must be a non-negative integer');
  }
  if (!Array.isArray(value.entries) || value.entries.length > MAX_REPORT_ENTRIES) {
    throw invalidReport(`entries must contain at most ${MAX_REPORT_ENTRIES} items`);
  }

  const seen = new Set();
  const entries = value.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidReport(`entries[${index}] must be an object`);
    }
    if (typeof entry.pseudoId !== 'string' || !PSEUDO_ID_PATTERN.test(entry.pseudoId)) {
      throw invalidReport(`entries[${index}].pseudoId is invalid`);
    }
    if (seen.has(entry.pseudoId)) {
      throw invalidReport(`entries contains duplicate pseudoId ${entry.pseudoId}`);
    }
    seen.add(entry.pseudoId);
    if (entry.verdict !== 'major' && entry.verdict !== 'minor') {
      throw invalidReport(`entries[${index}].verdict must be major or minor`);
    }
    if (
      typeof entry.ratio !== 'number'
      || !Number.isFinite(entry.ratio)
      || entry.ratio < 0
      || entry.ratio > 1
    ) {
      throw invalidReport(`entries[${index}].ratio must be between 0 and 1`);
    }
    if (
      !Number.isInteger(entry.nearestClusterSize)
      || entry.nearestClusterSize < 0
      || entry.nearestClusterSize > value.realPopulation
    ) {
      throw invalidReport(
        `entries[${index}].nearestClusterSize must be within the real population`
      );
    }
    return {
      pseudoId: entry.pseudoId,
      verdict: entry.verdict,
      ratio: entry.ratio,
      nearestClusterSize: entry.nearestClusterSize,
    };
  });

  return {
    generatedAt: new Date(value.generatedAt).toISOString(),
    realPopulation: value.realPopulation,
    entries,
  };
}

function populationValue(report, entry) {
  return {
    generatedAt: report.generatedAt,
    realPopulation: report.realPopulation,
    verdict: entry.verdict,
    ratio: entry.ratio,
    nearestClusterSize: entry.nearestClusterSize,
  };
}

function withPopulation(analysis, report, entry) {
  if (!analysis || analysis.schemaVersion !== 2) return null;
  return {
    ...analysis,
    population: populationValue(report, entry),
  };
}

class LocalPopulationReportService {
  constructor({ personaService, secret }) {
    this.personaService = personaService;
    this.secret = secret;
  }

  async import(context, input) {
    const report = validatePopulationReport(input);
    const expectedPseudoId = pseudoId(context.name, this.secret);
    const entry = report.entries.find((item) => item.pseudoId === expectedPseudoId);
    if (!entry) return { matched: false, updated: false };

    const analysis = await this.personaService.readAnalysis(
      context.repositoryRoot,
      context.name
    );
    const updated = withPopulation(analysis, report, entry);
    if (!updated) return { matched: true, updated: false };
    await this.personaService.writeAnalysis(context.repositoryRoot, context.name, updated);
    return { matched: true, updated: true, population: updated.population };
  }
}

class OnlinePopulationReportService {
  constructor({ database, evidenceStore, secret }) {
    this.database = database;
    this.evidenceStore = evidenceStore;
    this.secret = secret;
  }

  async import(input) {
    if (!this.secret) {
      throw Object.assign(new Error('Persona population import is not configured'), {
        code: 'PERSONA_POPULATION_IMPORT_UNAVAILABLE',
        statusCode: 503,
      });
    }
    const report = validatePopulationReport(input);
    const byPseudoId = new Map(report.entries.map((entry) => [entry.pseudoId, entry]));
    const { rows } = await this.database.query(
      `SELECT id AS user_id
         FROM users
        WHERE is_deleted = false
          AND research_export_consent = true
        ORDER BY id`
    );

    let matched = 0;
    let updated = 0;
    for (const row of rows) {
      const entry = byPseudoId.get(pseudoId(row.user_id, this.secret));
      if (!entry) continue;
      matched += 1;
      const analysis = await this.evidenceStore.readAnalysis(row.user_id);
      const next = withPopulation(analysis, report, entry);
      if (!next) continue;
      await this.evidenceStore.writeAnalysis(row.user_id, next);
      updated += 1;
    }
    return { received: report.entries.length, matched, updated };
  }
}

module.exports = {
  LocalPopulationReportService,
  MAX_REPORT_ENTRIES,
  OnlinePopulationReportService,
  PSEUDO_ID_PATTERN,
  populationValue,
  validatePopulationReport,
  withPopulation,
};
