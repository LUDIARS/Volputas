const gameModel = require('../models/gameModel');
const { AppError } = require('../middleware/errorHandler');
const {
  gameView,
  validateGameId,
  validateGameInput,
  validateGameUpdate,
} = require('../corpus/gameContract');

// Postgres の一意制約違反。 タイトル重複は運用上ふつうに起きるので、
// 500 ではなく 409 として GLAB のフォームに返す。
const UNIQUE_VIOLATION = '23505';

function asConflict(error) {
  if (error?.code !== UNIQUE_VIOLATION) return error;
  return new AppError(409, 'GAME_TITLE_TAKEN', 'A game with this title is already registered');
}

/** @implements SPEC-GLAB-GAME-CATALOG */
function createGlabGameService({ repository = gameModel } = {}) {
  return {
    // 一般ユーザには公開中のゲームだけを見せる。 管理者は停止済みも含めて
    // 一覧できないと復帰させられないので、 includeInactive を分岐に使う。
    async listGames({ includeInactive = false } = {}) {
      const rows = await repository.list({ includeInactive });
      return rows.map(gameView);
    },

    async registerGame(registeredBy, body) {
      const input = validateGameInput(body);
      try {
        return gameView(await repository.create(input, registeredBy));
      } catch (error) {
        throw asConflict(error);
      }
    },

    async updateGame(gameIdValue, body) {
      const gameId = validateGameId(gameIdValue);
      const patch = validateGameUpdate(body);
      try {
        const row = await repository.update(gameId, patch);
        return row ? gameView(row) : null;
      } catch (error) {
        throw asConflict(error);
      }
    },
  };
}

module.exports = { createGlabGameService };
