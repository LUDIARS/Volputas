const { resolveActiveGameTitle } = require('./glabGameSelection');
const { validateGlabVoiceInput } = require('./profileEvidenceSchemas');

function reviewView(record, author) {
  return {
    id: record.id,
    gameTitle: record.gameTitle,
    // マスタ登録前に書かれた感想には無い。 表示は gameTitle が担い、 gameId は
    // ゲーム単位の集計と絞り込みのために付く。
    gameId: record.gameId ?? null,
    recommend: record.recommend,
    polarity: record.polarity,
    comment: record.comment,
    tags: record.tags,
    glabProjectId: record.glabProjectId,
    createdAt: record.createdAt,
    author,
  };
}

function createGlabReviewService({ voiceStore, resolveDisplayName, pseudoId, gameRepository }) {
  if (!voiceStore || !resolveDisplayName || !pseudoId || !gameRepository) {
    throw new TypeError(
      'voiceStore, resolveDisplayName, pseudoId, and gameRepository are required',
    );
  }

  return {
    async list({ glabProjectId = null, limit = 50, offset = 0 } = {}) {
      const records = await voiceStore.listVoices({ glabProjectId, limit, offset });
      const community = records.filter((record) => (
        record.visibility === 'community'
        // Records written before owner stamping carry no author. They cannot be
        // attributed or pseudonymised, so they stay out of the public feed
        // instead of failing the whole request.
        && typeof record.userId === 'string' && record.userId.length > 0
        && (glabProjectId === null || record.glabProjectId === glabProjectId)
      ));
      // One lookup per author, not per record: a single author usually posts
      // several reviews into the same page.
      const names = new Map();
      const displayNameFor = (record) => {
        // A record-level override is per record, so it must not be cached.
        if (record.displayName) return resolveDisplayName(record.userId, record);
        if (!names.has(record.userId)) {
          names.set(record.userId, resolveDisplayName(record.userId, record));
        }
        return names.get(record.userId);
      };
      return Promise.all(community.map(async (record) => reviewView(
        record,
        record.anonymous
          ? { pseudo: pseudoId(record.userId) }
          : { name: await displayNameFor(record) },
      )));
    },

    async create(userId, body) {
      const voice = validateGlabVoiceInput(body);
      return voiceStore.saveVoice({
        userId,
        ...voice,
        gameTitle: await resolveActiveGameTitle(gameRepository, voice),
      });
    },
  };
}

module.exports = { createGlabReviewService, reviewView };
