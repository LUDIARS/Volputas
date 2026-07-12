const config = require('../src/config');
const db = require('../src/config/database');
const { buildExternalUtterances } = require('../src/services/utteranceExport');

async function main() {
  if (!config.pseudoIdSecret) {
    throw new Error('VOLUPTAS_PSEUDO_ID_SECRET is required');
  }
  const { rows } = await db.query(
    `SELECT sr.id AS response_id, sr.survey_id, sr.user_id, sr.answers, sr.submitted_at,
            s.questions, u.locale
     FROM survey_responses sr
     JOIN surveys s ON s.id = sr.survey_id
     JOIN users u ON u.id = sr.user_id
     WHERE u.is_deleted = false
     ORDER BY sr.submitted_at, sr.id`
  );
  process.stdout.write(`${JSON.stringify(buildExternalUtterances(rows, config.pseudoIdSecret), null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`utterance export failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
