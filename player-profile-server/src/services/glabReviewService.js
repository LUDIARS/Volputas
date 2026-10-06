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

/** 感想書き出しの 1 回あたり上限件数。 */
const IMPRESSION_EXPORT_MAX = 200;
/** 感想書き出しで走査する 1 ページの件数と最大ページ数 (全件走査を避ける)。 */
const IMPRESSION_PAGE_SIZE = 100;
const IMPRESSION_SCAN_PAGES = 20;

function normalizeTitle(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/\s+/g, '') : '';
}

/** ゲーム名の部分一致 (双方向)。略称と正式名のどちらで指定されても拾う。 */
function titleMatches(title, needle) {
  return title.length > 0 && (title.includes(needle) || needle.includes(title));
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

    /**
     * 外部サービス (Discutere) へ渡す「遊んだ感想」。community 公開の感想だけを、書き手の情報
     * (名前・仮名・ID・プロジェクト) を一切含めずに返す。game を渡すとゲーム名の部分一致
     * (大文字小文字・空白を無視、双方向) で絞り込む。
     * @implements SPEC-GLAB-IMPRESSION-EXPORT
     */
    async listImpressions({ game = null, limit = 50 } = {}) {
      const wanted = Math.max(1, Math.min(Number(limit) || 50, IMPRESSION_EXPORT_MAX));
      const needle = normalizeTitle(game);
      const impressions = [];
      for (let page = 0; page < IMPRESSION_SCAN_PAGES && impressions.length < wanted; page += 1) {
        const records = await voiceStore.listVoices({
          glabProjectId: null,
          limit: IMPRESSION_PAGE_SIZE,
          offset: page * IMPRESSION_PAGE_SIZE,
        });
        for (const record of records) {
          if (record.visibility !== 'community') continue;
          if (typeof record.comment !== 'string' || record.comment.trim() === '') continue;
          if (needle && !titleMatches(normalizeTitle(record.gameTitle), needle)) continue;
          impressions.push({
            id: record.id,
            gameTitle: record.gameTitle,
            recommend: record.recommend,
            polarity: record.polarity ?? null,
            comment: record.comment,
            createdAt: record.createdAt,
          });
          if (impressions.length >= wanted) break;
        }
        if (records.length < IMPRESSION_PAGE_SIZE) break;
      }
      return impressions;
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
