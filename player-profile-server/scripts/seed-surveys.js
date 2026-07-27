const db = require('../src/config/database');
const { SURVEY_DEFINITIONS } = require('../src/surveys/surveyCatalog');

// Seeds every Voluptas-native survey in src/surveys/surveyCatalog.js. Matching is by title
// because `surveys.id` is database-generated: an existing row is updated in place so previously
// collected survey_responses keep pointing at the survey they were answered against.
async function seedSurvey({ definition, category, visibleToGlab }) {
  const { SURVEY_TITLE, SURVEY_DESCRIPTION, QUESTIONS } = definition;
  const questions = JSON.stringify(QUESTIONS);

  const { rows } = await db.query('SELECT id FROM surveys WHERE title = $1', [SURVEY_TITLE]);

  if (rows[0]) {
    await db.query(
      `UPDATE surveys
       SET description = $2, questions = $3, category = $4, visible_to_glab = $5, is_active = true
       WHERE id = $1`,
      [rows[0].id, SURVEY_DESCRIPTION, questions, category, visibleToGlab]
    );
    return { action: 'updated', id: rows[0].id };
  }

  const inserted = await db.query(
    `INSERT INTO surveys (title, description, questions, category, visible_to_glab)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [SURVEY_TITLE, SURVEY_DESCRIPTION, questions, category, visibleToGlab]
  );
  return { action: 'created', id: inserted.rows[0].id };
}

async function main() {
  for (const entry of SURVEY_DEFINITIONS) {
    const result = await seedSurvey(entry);
    process.stdout.write(`${JSON.stringify({
      ...result,
      surveyId: entry.definition.SURVEY_ID,
      questionCount: entry.definition.QUESTIONS.length,
    })}\n`);
  }
}

main()
  .catch((error) => {
    process.stderr.write(`survey seed failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
