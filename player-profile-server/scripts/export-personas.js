const config = require('../src/config');
const db = require('../src/config/database');
const { buildPersonaExports } = require('../src/services/personaExport');

async function main() {
  if (!config.pseudoIdSecret) {
    throw new Error('VOLUPTAS_PSEUDO_ID_SECRET is required');
  }
  const { rows } = await db.query(
    `SELECT pap.user_id,
            pap.vector AS affect_vector,
            pap.vector_spec_version,
            pp.playstyle_tags
       FROM player_affect_profiles pap
       JOIN users u ON u.id = pap.user_id
       LEFT JOIN player_profiles pp ON pp.user_id = pap.user_id
      WHERE u.is_deleted = false
      ORDER BY pap.user_id`
  );
  process.stdout.write(`${JSON.stringify(buildPersonaExports(rows, config.pseudoIdSecret), null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`persona export failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
