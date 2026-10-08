const db = require('../config/database');

function mapRow(row) {
  return row ? { requestId: row.request_id, theme: row.theme, status: row.status, acceptedAt: row.accepted_at } : null;
}

/** 依頼元と依頼 ID を一意に保存する。競合時も既存テーマを書き換えない。 */
function createImpressionRequestRepository(database = db) {
  const find = async (requester, requestId) => {
    const { rows } = await database.query('SELECT * FROM impression_collection_requests WHERE requester=$1 AND request_id=$2', [requester, requestId]);
    return mapRow(rows[0]);
  };
  return {
    find,
    async accept(requester, requestId, theme) {
      const { rows } = await database.query(
        `INSERT INTO impression_collection_requests (requester, request_id, theme)
         VALUES ($1,$2,$3) ON CONFLICT (requester, request_id) DO NOTHING RETURNING *`,
        [requester, requestId, theme],
      );
      return { created: rows.length > 0, request: rows[0] ? mapRow(rows[0]) : await find(requester, requestId) };
    },
    async list(requester) {
      const { rows } = await database.query('SELECT * FROM impression_collection_requests WHERE requester=$1 ORDER BY accepted_at DESC LIMIT 100', [requester]);
      return rows.map(mapRow);
    },
  };
}

module.exports = { createImpressionRequestRepository };
