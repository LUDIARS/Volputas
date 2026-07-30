const { validateVoiceInput } = require('./profileEvidenceSchemas');

function reviewView(record, author) {
  return {
    id: record.id,
    gameTitle: record.gameTitle,
    recommend: record.recommend,
    polarity: record.polarity,
    comment: record.comment,
    tags: record.tags,
    glabProjectId: record.glabProjectId,
    createdAt: record.createdAt,
    author,
  };
}

function createGlabReviewService({ voiceStore, resolveDisplayName, pseudoId }) {
  if (!voiceStore || !resolveDisplayName || !pseudoId) {
    throw new TypeError('voiceStore, resolveDisplayName, and pseudoId are required');
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
      const voice = validateVoiceInput(body);
      return voiceStore.saveVoice({ userId, ...voice });
    },
  };
}

module.exports = { createGlabReviewService, reviewView };
