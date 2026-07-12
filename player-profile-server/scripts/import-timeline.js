const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/config/database');
const { aggregateTimeline, saveTimeline } = require('../src/services/affectTimeline');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: npm run import:timeline -- <file> --game <id> --source-ref <videoId> [--bin-ms 30000]');
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const utterances = Array.isArray(raw) ? raw : raw.utterances;
  const gameId = argument('game') || raw.gameId;
  const sourceRef = argument('source-ref') || raw.sourceRef;
  const binMs = Number(argument('bin-ms') || raw.binMs || 30_000);
  if (!Array.isArray(utterances)) throw new Error('input must be an ExternalUtterance array or { utterances }');
  if (!gameId || !sourceRef) throw new Error('--game and --source-ref are required');
  const aggregated = aggregateTimeline(utterances, binMs);
  const timeline = await saveTimeline({
    gameId,
    sourceKind: 'video_comments',
    sourceRef,
    binMs,
    ...aggregated,
  });
  process.stdout.write(`${JSON.stringify({
    id: timeline.id,
    bins: aggregated.series.length,
    ...aggregated.meta,
  })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`timeline import failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
