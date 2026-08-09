// GLAB 経由の管理操作 (ゲームマスタ登録・アンケート公開) の認可。
//
// 権限の正本は Cernere の users.role で、 project token の role クレームとして
// 届く。 GLAB 側にも管理者判定 (Corpus の adminIds) はあるが、 それは画面を
// 出すかどうかの判断でしかない。 GLAB を迂回して Volputas を直接叩かれても
// 書けないよう、 サーバ側はトークンのクレームだけで判定する。
const ADMIN_ROLES = Object.freeze(new Set(['admin']));

function isCernereAdmin(user) {
  return typeof user?.role === 'string' && ADMIN_ROLES.has(user.role);
}

/** @implements SPEC-GLAB-ADMIN-AUTHORIZATION */
function requireCernereAdmin(req, res, next) {
  if (isCernereAdmin(req.cernereUser)) return next();
  return res.status(403).json({
    ok: false,
    error: {
      code: 'ADMIN_REQUIRED',
      message: 'This operation requires a Cernere administrator',
    },
  });
}

module.exports = { isCernereAdmin, requireCernereAdmin };
