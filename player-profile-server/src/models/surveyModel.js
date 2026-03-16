const db = require('../config/database');

const surveyModel = {
  async findActive() {
    const { rows } = await db.query(
      'SELECT id, title, description, questions, created_at FROM surveys WHERE is_active = true ORDER BY created_at DESC'
    );
    return rows;
  },

  async findById(id) {
    const { rows } = await db.query(
      'SELECT * FROM surveys WHERE id = $1',
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
