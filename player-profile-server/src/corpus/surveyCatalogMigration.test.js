const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const packageRoot = resolve(__dirname, '..', '..');
const MIGRATION_NAME = '009_corpus_survey_catalog.sql';
const SEED_SURVEY_ID = 'd2c6aca2-e754-4e4a-9f2b-270c85b989e5';

const migrationSql = readFileSync(
  resolve(packageRoot, 'migrations', MIGRATION_NAME),
  'utf8',
);

/**
 * Split SQL into top-level statements while treating `$$ ... $$` (plpgsql DO
 * blocks) and quoted literals as opaque, so a `;` inside a DO block does not
 * look like a statement boundary.
 */
function splitTopLevelStatements(sql) {
  const statements = [];
  let current = '';
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    const lineComment = /^--[^\n]*/.exec(rest);
    if (lineComment) {
      index += lineComment[0].length;
      continue;
    }

    const dollarOpen = /^\$([A-Za-z_]*)\$/.exec(rest);
    if (dollarOpen) {
      const tag = dollarOpen[0];
      const close = sql.indexOf(tag, index + tag.length);
      assert.ok(close > 0, `unterminated dollar-quoted block near offset ${index}`);
      current += sql.slice(index, close + tag.length);
      index = close + tag.length;
      continue;
    }

    if (sql[index] === "'") {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'" && sql[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === "'") break;
        cursor += 1;
      }
      current += sql.slice(index, cursor + 1);
      index = cursor + 1;
      continue;
    }

    if (sql[index] === ';') {
      statements.push(current.trim());
      current = '';
      index += 1;
      continue;
    }

    current += sql[index];
    index += 1;
  }

  if (current.trim()) statements.push(current.trim());
  return statements.filter(Boolean);
}

const statements = splitTopLevelStatements(migrationSql);
const doBlocks = statements.filter((statement) => /^DO\s*\$/i.test(statement));

function isLedgerGuarded(block) {
  return (
    /to_regclass\('_migrations'\)/.test(block)
    && block.includes(MIGRATION_NAME)
    && /IF\s+already_applied\s+THEN[\s\S]*RETURN;/i.test(block)
  );
}

test('blanket visible_to_glab opt-out only runs on first application', () => {
  const blanketResets = [];

  for (const statement of statements) {
    // Unconditional (WHERE-less) resets of the publish flag are the hazard:
    // on a manual re-run they silently unpublish every live survey.
    const bodies = statement.match(
      /UPDATE\s+surveys\s+SET\s+visible_to_glab\s*=\s*false\s*(?:WHERE[^;]*)?/gi,
    ) || [];

    for (const body of bodies) {
      if (!/WHERE/i.test(body)) blanketResets.push(statement);
    }
  }

  assert.ok(
    blanketResets.length > 0,
    'legacy DEFAULT true installations still need a one-time opt-out converge',
  );

  for (const statement of blanketResets) {
    assert.ok(
      /^DO\s*\$/i.test(statement),
      'a WHERE-less visible_to_glab reset must live inside a guarded DO block',
    );
    assert.ok(
      isLedgerGuarded(statement),
      'the one-time opt-out must be skipped when the _migrations ledger already records this migration',
    );
  }
});

test('seed upsert never overwrites live publication flags', () => {
  const seedInsert = statements.find(
    (statement) => /^INSERT\s+INTO\s+surveys/i.test(statement)
      && statement.includes(SEED_SURVEY_ID),
  );
  assert.ok(seedInsert, 'canonical game_review seed row must still be inserted');

  const conflictClause = /ON\s+CONFLICT\s*\(id\)\s*DO\s+UPDATE\s+SET([\s\S]*)$/i
    .exec(seedInsert);
  assert.ok(conflictClause, 'seed must upsert by primary key rather than fail on re-run');

  const assignedColumns = conflictClause[1]
    .split(',')
    .map((assignment) => assignment.split('=')[0].trim())
    .filter(Boolean);

  assert.deepEqual(
    assignedColumns.sort(),
    ['category', 'description', 'questions', 'title'],
    'only catalog definition columns may converge on re-run',
  );
  assert.ok(
    !assignedColumns.includes('visible_to_glab'),
    'visible_to_glab must retain the operator-managed value',
  );
  assert.ok(
    !assignedColumns.includes('is_active'),
    'is_active must retain the operator-managed value',
  );
});

test('seed publication step is confined to first application', () => {
  const publishBlocks = doBlocks.filter(
    (block) => block.includes(SEED_SURVEY_ID) && /visible_to_glab\s*=\s*true/i.test(block),
  );

  assert.equal(
    publishBlocks.length,
    1,
    'first-apply publication of the canonical seed must be a single guarded step',
  );
  assert.ok(
    isLedgerGuarded(publishBlocks[0]),
    'seed publication must be skipped once the ledger records this migration',
  );
});

test('schema convergence statements stay idempotent', () => {
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS category /);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS visible_to_glab BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migrationSql, /ALTER COLUMN visible_to_glab SET DEFAULT false/);
  assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS idx_surveys_glab_catalog/);
  assert.match(
    migrationSql,
    /CHECK \(category IN \('game_review', 'game_survey', 'peer_question'\)\)/,
  );
  // NOT NULL backfill must be narrowed to rows that actually violate it.
  assert.match(
    migrationSql,
    /UPDATE surveys\s+SET visible_to_glab = false\s+WHERE visible_to_glab IS NULL/,
  );
});

/*
 * Behavioural coverage against a real PostgreSQL instance.
 *
 * These assertions execute the migration verbatim twice and check the actual
 * row state, which the static guards above cannot do. They are opt-in because
 * the unit suite must stay hermetic (no service startup, no shared dev DB):
 *
 *   VOLUPTAS_MIGRATION_TEST_DATABASE_URL=postgres://... npm test
 *
 * The test creates and drops a disposable schema, so it never touches
 * application tables even when pointed at a scratch database.
 */
const behaviouralDatabaseUrl = process.env.VOLUPTAS_MIGRATION_TEST_DATABASE_URL;

test('migration 009 behaviour on first apply and manual re-run', {
  skip: behaviouralDatabaseUrl
    ? false
    : 'set VOLUPTAS_MIGRATION_TEST_DATABASE_URL to run migration behaviour tests',
}, async (t) => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: behaviouralDatabaseUrl });
  const schema = `voluptas_mig009_${process.pid}_${Date.now()}`;

  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);

  // Minimal pre-009 shape, mirroring 001_initial_schema.sql.
  await client.query(`
    CREATE TABLE surveys (
      id          UUID          PRIMARY KEY,
      title       VARCHAR(255)  NOT NULL,
      description TEXT,
      questions   JSONB         NOT NULL,
      is_active   BOOLEAN       NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const legacyId = '11111111-1111-4111-8111-111111111111';
  await client.query(
    `INSERT INTO surveys (id, title, description, questions)
     VALUES ($1, 'legacy experimental survey', null, '[]'::jsonb)`,
    [legacyId],
  );

  const readSurvey = async (id) => {
    const { rows } = await client.query(
      'SELECT title, category, visible_to_glab, is_active FROM surveys WHERE id = $1',
      [id],
    );
    return rows[0];
  };

  await t.test('first apply seeds the catalog row in the published state', async () => {
    await client.query(migrationSql);
    // run.js records the ledger entry only after the SQL succeeds.
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [MIGRATION_NAME]);

    const seed = await readSurvey(SEED_SURVEY_ID);
    assert.ok(seed, 'canonical seed row must be created on first apply');
    assert.equal(seed.category, 'game_review');
    assert.equal(seed.visible_to_glab, true);
    assert.equal(seed.is_active, true);

    const legacy = await readSurvey(legacyId);
    assert.equal(
      legacy.visible_to_glab,
      false,
      'pre-existing surveys converge to explicit opt-in on first apply',
    );
    assert.equal(legacy.category, 'game_survey');
  });

  await t.test('manual re-run preserves live publication state', async () => {
    // Operator activity after the migration shipped.
    await client.query(
      'UPDATE surveys SET visible_to_glab = true, is_active = true WHERE id = $1',
      [legacyId],
    );
    await client.query(
      'UPDATE surveys SET visible_to_glab = false, is_active = false WHERE id = $1',
      [SEED_SURVEY_ID],
    );
    await client.query('UPDATE surveys SET title = $2 WHERE id = $1', [
      SEED_SURVEY_ID,
      'operator renamed',
    ]);

    await client.query(migrationSql);

    const legacy = await readSurvey(legacyId);
    assert.equal(
      legacy.visible_to_glab,
      true,
      're-running the migration must not unpublish a live survey',
    );

    const seed = await readSurvey(SEED_SURVEY_ID);
    assert.equal(
      seed.visible_to_glab,
      false,
      're-running the migration must not re-publish a withdrawn seed survey',
    );
    assert.equal(
      seed.is_active,
      false,
      're-running the migration must not reactivate a disabled seed survey',
    );
    assert.equal(
      seed.title,
      'ゲームレビュー投稿',
      'catalog definition columns still converge to the canonical values',
    );
  });

  await t.test('re-run stays safe when the ledger table is absent', async () => {
    await client.query('DROP TABLE _migrations');
    await client.query(
      'UPDATE surveys SET visible_to_glab = true WHERE id = $1',
      [legacyId],
    );

    // Without a ledger the migration cannot know it already ran, so it falls
    // back to first-apply semantics. The seed upsert must still leave the
    // operator-managed flags of untouched rows alone apart from that converge.
    await client.query(migrationSql);

    const legacy = await readSurvey(legacyId);
    assert.equal(legacy.visible_to_glab, false);
    assert.equal(legacy.is_active, true, 'is_active is never mass-reset');
  });
});
