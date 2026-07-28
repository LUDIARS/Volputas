// Append-only persona analysis history for the Git-backed local mode
// (design §2/§5.3): one snapshot per recompute under
// analysis/<name>/history/, pruned to a bounded count while always keeping
// the oldest entry and the most recent ones.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { collectionDirectory, insideRepository } = require('../profileDataPaths');

const HISTORY_LIMIT = 100;
const RECENT_KEEP = 20;

function historyDirectory(repositoryRoot, name) {
  return insideRepository(
    collectionDirectory(repositoryRoot, 'analysis', name),
    'history'
  );
}

function historyFileName(analyzedAt) {
  return `persona-${String(analyzedAt).replace(/[:.]/g, '-')}.json`;
}

async function appendAnalysisHistory({ repositoryRoot, name, analysis }) {
  const directory = historyDirectory(repositoryRoot, name);
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, historyFileName(analysis.analyzedAt));
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  await pruneHistory(directory);
  return filePath;
}

async function pruneHistory(directory) {
  const entries = (await fs.readdir(directory))
    .filter((file) => file.startsWith('persona-') && file.endsWith('.json'))
    .sort();
  // Timestamped names sort chronologically. Thin from the second-oldest so the
  // very first snapshot and the newest RECENT_KEEP survive every prune.
  let names = entries;
  while (names.length > HISTORY_LIMIT) {
    const removableEnd = names.length - RECENT_KEEP;
    if (removableEnd <= 1) break;
    await fs.unlink(path.join(directory, names[1]));
    names = [names[0], ...names.slice(2)];
  }
}

async function listAnalysisHistory({ repositoryRoot, name }) {
  const directory = historyDirectory(repositoryRoot, name);
  try {
    return (await fs.readdir(directory))
      .filter((file) => file.startsWith('persona-') && file.endsWith('.json'))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Compact per-axis score series for the trend UI (design §5.3). Only v2
// snapshots carry preferenceAxes; anything else in the directory is skipped.
async function readAnalysisHistorySeries({ repositoryRoot, name, limit = 40 }) {
  const directory = historyDirectory(repositoryRoot, name);
  const files = await listAnalysisHistory({ repositoryRoot, name });
  const selected = files.slice(-limit);
  const entries = [];
  for (const file of selected) {
    let snapshot;
    try {
      snapshot = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
    } catch {
      continue; // best-effort: a corrupt history snapshot must not break the trend view
    }
    if (snapshot.schemaVersion !== 2 || !snapshot.preferenceAxes) continue;
    entries.push({
      analyzedAt: snapshot.analyzedAt,
      scores: Object.fromEntries(Object.entries(snapshot.preferenceAxes)
        .map(([axis, value]) => [axis, value.score])),
    });
  }
  return entries;
}

module.exports = {
  HISTORY_LIMIT,
  RECENT_KEEP,
  appendAnalysisHistory,
  listAnalysisHistory,
  readAnalysisHistorySeries,
};
