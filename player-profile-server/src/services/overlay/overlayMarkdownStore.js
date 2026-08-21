// Markdown documents the overlay is allowed to read
// (spec/feature/window-overlay-extension.md §表示コンテンツ / Markdown).
// The overlay never receives a caller-supplied filesystem path: documents live
// under <dataRepositoryPath>/overlay-docs and are addressed by their file name,
// so the local app keeps the same data boundary it already has.
const fs = require('node:fs/promises');
const path = require('node:path');

const DIRECTORY = 'overlay-docs';
const EXTENSION = '.md';
const MAXIMUM_BYTES = 512 * 1024;
// Plain file names only: no separator, drive letter or dot segment can pass.
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function overlayError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

// A document id is the bare file name (no separators, no dot segments); this is
// the single place traversal is rejected.
function isSafeDocumentId(value) {
  return Boolean(
    value
    && SAFE_NAME_PATTERN.test(value)
    && !value.startsWith('.')
    && path.basename(value) === value
    && value.toLowerCase().endsWith(EXTENSION)
  );
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
class OverlayMarkdownStore {
  constructor({ directory = DIRECTORY, maximumBytes = MAXIMUM_BYTES } = {}) {
    this.directory = directory;
    this.maximumBytes = maximumBytes;
  }

  rootFor({ repositoryRoot }) {
    return path.join(repositoryRoot, this.directory);
  }

  async list(context) {
    const root = this.rootFor(context);
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const documents = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isSafeDocumentId(entry.name)) continue;
      // lstat を使い、root 外へ向く symlink を通常ファイルとして扱わない。
      const stats = await fs.lstat(path.join(root, entry.name));
      if (!stats.isFile()) continue;
      documents.push({
        id: entry.name,
        name: entry.name.slice(0, -EXTENSION.length),
        bytes: stats.size,
        updatedAt: new Date(stats.mtimeMs).toISOString(),
      });
    }
    return documents.sort((left, right) => left.id.localeCompare(right.id));
  }

  async read(context, documentId) {
    if (!isSafeDocumentId(documentId)) {
      throw overlayError(400, 'INVALID_OVERLAY_DOCUMENT', 'Overlay document id must be a plain .md file name');
    }
    const filePath = path.join(this.rootFor(context), documentId);
    let stats;
    try {
      // stat/readFile は symlink を辿るため、先に lstat で通常ファイルだけに
      // 限定する。documentId の basename 制約と合わせて root 外を読ませない。
      stats = await fs.lstat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw overlayError(404, 'OVERLAY_DOCUMENT_NOT_FOUND', 'Overlay document not found');
      }
      throw error;
    }
    if (!stats.isFile()) {
      throw overlayError(404, 'OVERLAY_DOCUMENT_NOT_FOUND', 'Overlay document not found');
    }
    if (stats.size > this.maximumBytes) {
      throw overlayError(413, 'OVERLAY_DOCUMENT_TOO_LARGE', 'Overlay document is too large to render');
    }
    return {
      id: documentId,
      markdown: await fs.readFile(filePath, 'utf8'),
      updatedAt: new Date(stats.mtimeMs).toISOString(),
    };
  }
}

module.exports = { OverlayMarkdownStore, isSafeDocumentId, OVERLAY_DOCUMENT_DIRECTORY: DIRECTORY };
