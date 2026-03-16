const db = require('../config/database');

const eventModel = {
  async create({ sessionId, eventType, eventData, occurredAt }) {
    const { rows } = await db.query(
      `INSERT INTO play_events (session_id, event_type, event_data, occurred_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sessionId, eventType, JSON.stringify(eventData), occurredAt || new Date()]
    );
    return rows[0];
  },

  async createBatch(sessionId, events) {
    if (events.length === 0) return [];

    const values = [];
    const params = [];
    let idx = 1;

    for (const event of events) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(
        sessionId,
        event.event_type,
        JSON.stringify(event.event_data),
        event.occurred_at || new Date()
      );
    }

    const { rows } = await db.query(
      `INSERT INTO play_events (session_id, event_type, event_data, occurred_at)
       VALUES ${values.join(', ')}
       RETURNING *`,
      params
    );
    return rows;
  },

  async findBySessionId(sessionId, { limit = 100, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT * FROM play_events
       WHERE session_id = $1
       ORDER BY occurred_at ASC
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset]
    );
    return rows;
  },
};

module.exports = eventModel;
