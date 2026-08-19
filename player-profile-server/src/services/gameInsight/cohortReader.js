// Reads emotion-curve records of *every* respondent directory in the data
// repository (spec/feature/game-insight.md §入力). The per-player stores are
// keyed by one name; cross-player statistics need the whole cohort, so this
// reader walks `emotion-curves/<anyone>/*.json` and tags each record with the
// player key it belongs to. Read-only: it never writes into other players'
// directories.
const fs = require('node:fs/promises');
const path = require('node:path');
const { insideRepository } = require('../profileDataPaths');

const COLLECTION = 'emotion-curves';
const MAXIMUM_GAME_TITLE_LENGTH = 200;

/** @implements SPEC-GAME-INSIGHT */
function compareText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

/** @implements SPEC-GAME-INSIGHT */
function normalizeTitle(value) {
  return String(value || '').trim();
}

/** @implements SPEC-GAME-INSIGHT */
function playerKeyOf(record, directoryName) {
  const name = record?.respondent?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : directoryName;
}

/** @implements SPEC-GAME-INSIGHT */
class CohortReader {
  constructor({ collection = COLLECTION } = {}) {
    this.collection = collection;
  }

  async readAll({ repositoryRoot }) {
    const root = insideRepository(repositoryRoot, this.collection);
    let directories;
    try {
      directories = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const results = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const directoryPath = path.join(root, directory.name);
      const files = await fs.readdir(directoryPath, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue;
        const filePath = path.join(directoryPath, file.name);
        let record;
        try {
          record = JSON.parse(await fs.readFile(filePath, 'utf8'));
        } catch (error) {
          throw Object.assign(
            new Error(`Emotion curve record is not valid JSON: ${filePath}`),
            { code: 'INVALID_PROFILE_RECORD' }
          );
        }
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw Object.assign(
            new Error(`Emotion curve record must be a JSON object: ${filePath}`),
            { code: 'INVALID_PROFILE_RECORD' }
          );
        }
        results.push({ playerKey: playerKeyOf(record, directory.name), record });
      }
    }
    return results.sort((left, right) =>
      compareText(left.playerKey, right.playerKey)
      || compareText(left.record.createdAt, right.record.createdAt)
      || compareText(left.record.id, right.record.id)
      || compareText(JSON.stringify(left.record), JSON.stringify(right.record)));
  }

  async readGame({ repositoryRoot }, gameTitle) {
    const title = normalizeTitle(gameTitle);
    const all = await this.readAll({ repositoryRoot });
    return all.filter((item) => normalizeTitle(item.record.gameTitle) === title);
  }

  // Games across all players with player / session counts, most-played first.
  async games({ repositoryRoot }) {
    const all = await this.readAll({ repositoryRoot });
    const byTitle = new Map();
    for (const { playerKey, record } of all) {
      const title = normalizeTitle(record.gameTitle);
      if (!title || title.length > MAXIMUM_GAME_TITLE_LENGTH) continue;
      const entry = byTitle.get(title)
        || { gameTitle: title, sessionCount: 0, players: new Set(), latestAt: null };
      entry.sessionCount += 1;
      entry.players.add(playerKey);
      if (!entry.latestAt || String(record.createdAt || '') > entry.latestAt) {
        entry.latestAt = record.createdAt || entry.latestAt;
      }
      byTitle.set(title, entry);
    }
    return [...byTitle.values()]
      .map(({ players, ...entry }) => ({ ...entry, playerCount: players.size }))
      .sort((left, right) => right.playerCount - left.playerCount
        || right.sessionCount - left.sessionCount
        || left.gameTitle.localeCompare(right.gameTitle));
  }
}

module.exports = { CohortReader, MAXIMUM_GAME_TITLE_LENGTH, normalizeTitle, playerKeyOf };
