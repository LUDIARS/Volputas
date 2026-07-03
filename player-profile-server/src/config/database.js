const { Pool } = require('pg');
const config = require('./index');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

const db = {
  query: (text, params) => pool.query(text, params),

  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  pool,
};

module.exports = db;
