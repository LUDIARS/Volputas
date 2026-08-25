const config = require('../config');
const impressionRepository = require('../models/impressionRepository');
const profileModel = require('../models/profileModel');
const sessionModel = require('../models/sessionModel');
const userModel = require('../models/userModel');
const { getProfileEvidenceStore } = require('../integrations/cernere/createProfileEvidenceStore');
const { AppError } = require('../middleware/errorHandler');
const { buildPersonaExport } = require('./personaExport');
const { DiscutereDiscussionPublisher } = require('./discutereDiscussionPublisher');

const GAME_REVIEW_SOURCE = 'volputas_web_game_review';

/** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
function reviewRating(impression) {
  const rating = Number(impression?.client?.rating);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

/** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
function createImpressionDiscussionService({
  impressions = impressionRepository,
  profiles = profileModel,
  sessions = sessionModel,
  users = userModel,
  evidenceStore = getProfileEvidenceStore(),
  pseudoIdSecret = config.pseudoIdSecret,
  publisher = new DiscutereDiscussionPublisher({
    baseUrl: config.discuterePersonaBridge.baseUrl,
    token: config.discuterePersonaBridge.token,
  }),
} = {}) {
  return {
    /** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
    async start({ impressionId, userId }) {
      const impression = await impressions.getOwned(impressionId, userId);
      if (!impression) throw new AppError(404, 'NOT_FOUND', 'Impression not found');
      if (impression.status !== 'ready') {
        throw new AppError(409, 'IMPRESSION_NOT_READY', 'レビューの処理完了後に議論を開始してください');
      }
      if (impression.client?.source !== GAME_REVIEW_SOURCE) {
        throw new AppError(
          409,
          'GAME_REVIEW_REQUIRED',
          'ゲームレビュー投稿から作成した感想だけを議論に送れます'
        );
      }

      const [user, session, profile] = await Promise.all([
        users.findById(userId),
        sessions.findById(impression.session_id),
        profiles.findByUserId(userId),
      ]);
      if (!user || !session || session.user_id !== userId) {
        throw new AppError(404, 'NOT_FOUND', 'Review session not found');
      }
      if (user.research_export_consent !== true) {
        throw new AppError(
          409,
          'PERSONA_EXPORT_CONSENT_REQUIRED',
          '設定で匿名ペルソナの研究利用に同意してから議論を開始してください'
        );
      }
      if (!pseudoIdSecret) {
        throw new AppError(
          503,
          'PERSONA_EXPORT_UNAVAILABLE',
          '匿名ペルソナの出力が設定されていません'
        );
      }

      const analysis = await evidenceStore.readAnalysis(userId);
      const persona = buildPersonaExport({
        analysis,
        consent: true,
        identity: userId,
        traits: profile?.playstyle_tags,
      }, pseudoIdSecret);
      if (!persona?.affectVector || persona.vectorSpecVersion !== 1) {
        throw new AppError(
          409,
          'PERSONA_ANALYSIS_REQUIRED',
          'プレイヤー分析を完了してから分身との議論を開始してください'
        );
      }

      const rating = reviewRating(impression);
      const gameTitle = typeof session.game_id === 'string' ? session.game_id.trim() : '';
      const text = typeof impression.text === 'string' ? impression.text.trim() : '';
      if (!rating || !gameTitle || !text) {
        throw new AppError(
          409,
          'GAME_REVIEW_REQUIRED',
          'ゲームレビュー投稿から作成した感想だけを議論に送れます'
        );
      }

      return publisher.publish({
        persona,
        review: { gameTitle, rating, text },
      });
    },
  };
}

module.exports = {
  createImpressionDiscussionService,
  reviewRating,
};
