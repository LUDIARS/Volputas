const db = require('../config/database');
const { getProfileEvidenceStore } = require('../integrations/cernere/createProfileEvidenceStore');
const { buildPersonaExport } = require('./personaExport');

const DEFAULT_PAGE_SIZE = 100;
const MAXIMUM_PAGE_SIZE = 500;

function normalizePageSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAXIMUM_PAGE_SIZE);
}

class PersonaExportService {
  constructor({
    database = db,
    evidenceStore = getProfileEvidenceStore(),
    secret,
  }) {
    this.database = database;
    this.evidenceStore = evidenceStore;
    this.secret = secret;
  }

  async listPage({ cursor = null, limit = DEFAULT_PAGE_SIZE } = {}) {
    if (!this.secret) {
      throw Object.assign(new Error('Persona export is not configured'), {
        code: 'PERSONA_EXPORT_UNAVAILABLE',
        statusCode: 503,
      });
    }
    const pageSize = normalizePageSize(limit);
    const { rows } = await this.database.query(
      `SELECT u.id AS user_id, pp.playstyle_tags
         FROM users u
         LEFT JOIN player_profiles pp ON pp.user_id = u.id
        WHERE u.is_deleted = false
          AND u.research_export_consent = true
          AND ($1::uuid IS NULL OR u.id > $1::uuid)
        ORDER BY u.id
        LIMIT $2`,
      [cursor, pageSize + 1]
    );
    const pageRows = rows.slice(0, pageSize);
    const personas = [];
    // Keep pressure on the Cernere project socket bounded: each page is
    // ordered and fetched sequentially instead of opening up to 500 commands.
    for (const row of pageRows) {
      const persona = buildPersonaExport({
        analysis: await this.evidenceStore.readAnalysis(row.user_id),
        consent: true,
        identity: row.user_id,
        traits: row.playstyle_tags,
      }, this.secret);
      if (persona) personas.push(persona);
    }
    return {
      personas,
      nextCursor: rows.length > pageSize
        ? pageRows[pageRows.length - 1].user_id
        : null,
    };
  }
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAXIMUM_PAGE_SIZE,
  PersonaExportService,
  normalizePageSize,
};
