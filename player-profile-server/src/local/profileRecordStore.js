const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { collectionDirectory, recordPath } = require('./profileDataPaths');

class ProfileRecordStore {
  constructor(collection, now = () => new Date()) {
    this.collection = collection;
    this.now = now;
  }

  async list({ repositoryRoot, name }) {
    const directory = collectionDirectory(repositoryRoot, this.collection, name);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        try {
          return JSON.parse(await fs.readFile(filePath, 'utf8'));
        } catch (error) {
          throw Object.assign(
            new Error(`Profile record is not valid JSON: ${filePath}`),
            { code: 'INVALID_PROFILE_RECORD' }
          );
        }
      }));
    return records.sort((left, right) =>
      String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async write({ repositoryRoot, name, data }) {
    const now = this.now().toISOString();
    const id = data.id || randomUUID();
    const filePath = recordPath(repositoryRoot, this.collection, name, id);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let existing = null;
    try {
      existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const record = {
      schemaVersion: 1,
      ...data,
      id,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
    return { filePath, record };
  }
}

module.exports = { ProfileRecordStore };
