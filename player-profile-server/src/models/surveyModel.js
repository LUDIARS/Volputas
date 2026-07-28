const db = require('../config/database');

const GENERAL_CATEGORY = Object.freeze({
  id: 'general',
  label: 'General',
  order: 100,
});

const surveyModel = {
  async findActive() {
    const { rows } = await db.query(
      'SELECT id, title, description, questions, created_at FROM surveys WHERE is_active = true ORDER BY created_at DESC'
    );
    return rows;
  },

  async findActiveForUser(userId) {
    const { rows } = await db.query(
      `SELECT s.id, s.title, s.description, s.questions, s.created_at,
              CASE WHEN sr.id IS NULL THEN 'unanswered' ELSE 'answered' END AS response_status,
              sr.submitted_at AS response_updated_at
       FROM surveys s
       LEFT JOIN survey_responses sr
         ON sr.survey_id = s.id AND sr.user_id = $1
       WHERE s.is_active = true
       ORDER BY s.created_at DESC`,
      [userId]
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      questions: row.questions,
      created_at: row.created_at,
      category: GENERAL_CATEGORY,
      responseStatus: row.response_status,
      responseUpdatedAt: row.response_updated_at,
    }));
  },

  async findById(id) {
    const { rows } = await db.query(
      'SELECT * FROM surveys WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async findForGlab(category) {
    const values = [];
    const categoryClause = category ? ' AND category = $1' : '';
    if (category) values.push(category);
    const { rows } = await db.query(
      `SELECT id, title, description, questions, category, created_at
       FROM surveys
       WHERE is_active = true AND visible_to_glab = true${categoryClause}
       ORDER BY created_at DESC`,
      values
    );
    return rows;
  },

  async findForGlabById(id) {
    const { rows } = await db.query(
      `SELECT id, title, description, questions, category, created_at
       FROM surveys
       WHERE id = $1 AND is_active = true AND visible_to_glab = true`,
      [id]
    );
    return rows[0] || null;
  },

  async create({ title, description, questions }) {
    const { rows } = await db.query(
      `INSERT INTO surveys (title, description, questions)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title, description || null, JSON.stringify(questions)]
    );
    return rows[0];
  },

  async submitResponse({ surveyId, userId, answers }) {
    const { rows } = await db.query(
      `INSERT INTO survey_responses (survey_id, user_id, answers)
       VALUES ($1, $2, $3)
       ON CONFLICT (survey_id, user_id)
       DO UPDATE SET answers = $3, submitted_at = now()
       RETURNING *`,
      [surveyId, userId, JSON.stringify(answers)]
    );
    return rows[0];
  },

  async findUserResponse(surveyId, userId) {
    const { rows } = await db.query(
      'SELECT * FROM survey_responses WHERE survey_id = $1 AND user_id = $2',
      [surveyId, userId]
    );
    return rows[0] || null;
  },
};

module.exports = surveyModel;
