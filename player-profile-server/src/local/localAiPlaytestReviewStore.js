// ローカルモードの AI プレイテスト感想の保存先: データリポジトリの ai-playtests/<id>.json。
// 回答者名 (Git Author) のフォルダには置かない (AI の感想に人の書き手を結び付けない)。
// 同じ ID (run_id 由来) の再送は既存のファイルを返し、上書きしない。
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const COLLECTION = 'ai-playtests';
const ID_PATTERN = /^aipt_[0-9a-f]{24}$/;

function directoryOf(repositoryRoot) {
  return path.join(path.resolve(repositoryRoot), COLLECTION);
}

function fileOf(repositoryRoot, id) {
  if (!ID_PATTERN.test(id)) throw Object.assign(new Error('AI playtest review id is invalid'), { code: 'INVALID_PROFILE_PATH' });
  return path.join(directoryOf(repositoryRoot), `${id}.json`);
}

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
class LocalAiPlaytestReviewStore {
  async save(record, { repositoryRoot }) {
    const filePath = fileOf(repositoryRoot, record.id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    try {
      // link は既存のファイルがあれば失敗する: 先に書いた記録を残し、再送では上書きしない。
      await fs.link(temporaryPath, filePath);
      return { record, created: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { record: JSON.parse(await fs.readFile(filePath, 'utf8')), created: false };
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }

  async list({ limit }, { repositoryRoot }) {
    let entries;
    try {
      entries = await fs.readdir(directoryOf(repositoryRoot), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && ID_PATTERN.test(entry.name.replace(/\.json$/, '')) && entry.name.endsWith('.json'))
      .map(async (entry) => JSON.parse(await fs.readFile(path.join(directoryOf(repositoryRoot), entry.name), 'utf8'))));
    return records
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || String(left.id).localeCompare(String(right.id)))
      .slice(0, limit);
  }
}

module.exports = { LocalAiPlaytestReviewStore, COLLECTION };
