// 中継が渡す Cernere の user id を Voluptas の users.id へ結びつける (SPEC-VO-PLAY-STREAM-IDENTITY)。
// federated_identities (provider = 'cernere') で引き、まだ居なければ通常のログインと同じ findOrCreateUser で作る。
// 引いた結果は同じプロセスの間だけ覚える (上限つき、古いものから捨てる)。

const { findOrCreateUser } = require('../services/identityService');

const DISPLAY_NAME = 'Ludellus プレイヤー';
const MAX_CACHED = 256;

function createCernereUserResolver({ findOrCreate = findOrCreateUser } = {}) {
  const cache = new Map();
  return function resolveUserId(cernereSub) {
    const cached = cache.get(cernereSub);
    if (cached) return cached;
    const pending = findOrCreate('cernere', cernereSub, { displayName: DISPLAY_NAME }, {})
      .catch((error) => {
        // 失敗 (DB 不通など) は覚えず、次の要求で引き直す。
        cache.delete(cernereSub);
        throw error;
      });
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
    cache.set(cernereSub, pending);
    return pending;
  };
}

module.exports = { createCernereUserResolver, DISPLAY_NAME };
