const db = require('../config/database');

// GLAB へ出す列。 surveyContract の行スキーマは .strict() なので、 ここに
// 足した列はあちらにも宣言が要る (宣言漏れは 500 INVALID_SURVEY_DEFINITION)。
const GLAB_COLUMNS = 'id, title, description, questions, category, game_id, created_at';

// 管理者向けの入口だけが公開フラグまで返す。 学生向けの応答へ混ぜると
// surveyContract の .strict() に弾かれる。
const MANAGED_COLUMNS_SQL = `${GLAB_COLUMNS}, visible_to_glab, is_active`;

// 管理者が更新できる列のホワイトリスト。 入力は surveyDefinitionContract が
// 検証済みなので、 ここで列名を組み立てても任意列には届かない。
const MANAGED_COLUMNS = Object.freeze({
  title: 'title',
  description: 'description',
  questions: 'questions',
  category: 'category',
  gameId: 'game_id',
  visibleToGlab: 'visible_to_glab',
  isActive: 'is_active',
});

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

  async findForGlab(category, gameId = null) {
    const values = [];
    const clauses = [];
    if (category) {
      values.push(category);
      clauses.push(`AND category = $${values.length}`);
    }
    if (gameId) {
      values.push(gameId);
      clauses.push(`AND game_id = $${values.length}`);
    }
    const { rows } = await db.query(
      `SELECT ${GLAB_COLUMNS}
       FROM surveys
       WHERE is_active = true AND visible_to_glab = true ${clauses.join(' ')}
       ORDER BY created_at DESC`,
      values
    );
    return rows;
  },

  async findForGlabById(id) {
    const { rows } = await db.query(
      `SELECT ${GLAB_COLUMNS}
       FROM surveys
       WHERE id = $1 AND is_active = true AND visible_to_glab = true`,
      [id]
    );
    return rows[0] || null;
  },

  // 管理者向け: 公開前 (visible_to_glab = false) の定義も引ける。 学生向けの
  // findForGlabById と混ぜると未公開アンケートが漏れるため、 入口を分ける。
  async findManagedById(id) {
    const { rows } = await db.query(
      `SELECT ${MANAGED_COLUMNS_SQL} FROM surveys WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async createManaged(definition) {
    const { rows } = await db.query(
      `INSERT INTO surveys (title, description, questions, category,
                            game_id, visible_to_glab, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MANAGED_COLUMNS_SQL}`,
      [
        definition.title,
        definition.description,
        JSON.stringify(definition.questions),
        definition.category,
        definition.gameId ?? null,
        definition.visibleToGlab,
        definition.isActive,
      ]
    );
    return rows[0];
  },

  async updateManaged(id, patch) {
    const assignments = [];
    const values = [];
    for (const [key, column] of Object.entries(MANAGED_COLUMNS)) {
      if (!Object.hasOwn(patch, key)) continue;
      values.push(key === 'questions' ? JSON.stringify(patch[key]) : patch[key]);
      assignments.push(`${column} = $${values.length}`);
    }
    if (assignments.length === 0) return this.findManagedById(id);
    values.push(id);
    const { rows } = await db.query(
      `UPDATE surveys SET ${assignments.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${MANAGED_COLUMNS_SQL}`,
      values
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
