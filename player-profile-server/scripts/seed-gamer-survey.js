const db = require('../src/config/database');
const { SURVEY_TITLE, SURVEY_DESCRIPTION, QUESTIONS } = require('./data/gamer-survey-questions');

async function main() {
  const { rows } = await db.query('SELECT id FROM surveys WHERE title = $1', [SURVEY_TITLE]);

  if (rows[0]) {
    await db.query(
      `UPDATE surveys SET description = $2, questions = $3, is_active = true WHERE id = $1`,
      [rows[0].id, SURVEY_DESCRIPTION, JSON.stringify(QUESTIONS)]
    );
    process.stdout.write(`${JSON.stringify({ action: 'updated', id: rows[0].id, questionCount: QUESTIONS.length })}\n`);
    return;
  }

  const inserted = await db.query(
    `INSERT INTO surveys (title, description, questions) VALUES ($1, $2, $3) RETURNING id`,
    [SURVEY_TITLE, SURVEY_DESCRIPTION, JSON.stringify(QUESTIONS)]
  );
  process.stdout.write(`${JSON.stringify({ action: 'created', id: inserted.rows[0].id, questionCount: QUESTIONS.length })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`gamer survey seed failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
