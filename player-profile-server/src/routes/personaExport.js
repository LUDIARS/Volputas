const { Router } = require('express');
const config = require('../config');
const db = require('../config/database');
const { getProfileEvidenceStore } = require('../integrations/cernere/createProfileEvidenceStore');
const { createPersonaExportAuth } = require('../middleware/personaExportAuth');
const { toJsonLines } = require('../services/personaExport');
const { PersonaExportService } = require('../services/personaExportService');
const { OnlinePopulationReportService } = require('../services/populationReport');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw Object.assign(new Error('cursor must be a UUID'), {
      code: 'INVALID_EXPORT_CURSOR',
      statusCode: 400,
    });
  }
  return value;
}

function createPersonaExportRouter({
  authenticateMiddleware = createPersonaExportAuth(),
  service = new PersonaExportService({ secret: config.pseudoIdSecret }),
  populationService = new OnlinePopulationReportService({
    database: db,
    evidenceStore: getProfileEvidenceStore(),
    secret: config.pseudoIdSecret,
  }),
} = {}) {
  const router = Router();
  router.use(authenticateMiddleware);
  router.get('/export', async (req, res, next) => {
    try {
      const result = await service.listPage({
        cursor: parseCursor(req.query.cursor),
        limit: req.query.limit,
      });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="personas.jsonl"',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      });
      if (result.nextCursor) res.set('X-Next-Cursor', result.nextCursor);
      return res.status(200).send(toJsonLines(result.personas));
    } catch (error) {
      return next(error);
    }
  });
  router.post('/population-report', async (req, res, next) => {
    try {
      const result = await populationService.import(req.body);
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ ok: true, data: result });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = {
  createPersonaExportRouter,
  parseCursor,
  router: createPersonaExportRouter(),
};
