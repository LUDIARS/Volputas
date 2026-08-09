const { AppError } = require('../middleware/errorHandler');

// GLAB の投稿に gameId がある場合、表示名は必ずゲームマスタから解決する。
// 感想と感情曲線で同じ存在・稼働チェックを共有し、片方だけ任意タイトルを
// 保存できる状態へ戻らないようにする。
/** @implements SPEC-GLAB-GAME-SELECTION */
async function resolveActiveGameTitle(gameRepository, input) {
  if (!input.gameId) return input.gameTitle;
  const game = await gameRepository.findById(input.gameId);
  if (!game) throw new AppError(400, 'GAME_NOT_FOUND', 'The referenced game does not exist');
  if (!game.is_active) {
    throw new AppError(400, 'GAME_INACTIVE', 'This game is no longer accepting submissions');
  }
  return game.title;
}

module.exports = { resolveActiveGameTitle };
