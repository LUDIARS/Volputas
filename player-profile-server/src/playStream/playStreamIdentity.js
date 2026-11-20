// 固定モードの本人 (SPEC-VO-PLAY-STREAM-IDENTITY)。
// 設定した Cernere の user id (subject) を federated_identities (provider = 'cernere') で Voluptas の
// users.id へ結びつける。まだ居なければ通常のログインと同じ findOrCreateUser で作る。
// 一度引いたら同じプロセスの間は使い回す。

const { findOrCreateUser } = require('../services/identityService');

const HOME_DISPLAY_NAME = 'Ludellus 自宅プレイヤー';

function createFixedUserResolver(cernereSubject, { findOrCreate = findOrCreateUser } = {}) {
  let pending = null;
  return function resolveUserId() {
    if (!pending) {
      pending = findOrCreate('cernere', cernereSubject, { displayName: HOME_DISPLAY_NAME }, {})
        .catch((error) => {
          // 失敗 (DB 不通など) は覚えず、次の接続で引き直す。
          pending = null;
          throw error;
        });
    }
    return pending;
  };
}

module.exports = { createFixedUserResolver, HOME_DISPLAY_NAME };
