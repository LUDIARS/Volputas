const db = require('../src/config/database');
const { createDelegationRepository } = require('../src/models/delegationRepository');

async function main() {
  const repository = createDelegationRepository();
  const purged = await repository.purgeDisposedClaims(new Date());
  process.stdout.write(`${JSON.stringify({ purged })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`delegation claim purge failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
