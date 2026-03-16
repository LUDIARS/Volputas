const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

async function runMigrations() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationsDir = path.join(__dirname);
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await db.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await db.query(sql);
      await db.query(
        'INSERT INTO _migrations (name) VALUES ($1)',
        [file]
      );
      console.log(`Applied ${file}`);
    }

    console.log('All migrations applied.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

runMigrations();
