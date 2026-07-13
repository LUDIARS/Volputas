function requireRecentAuthentication({
  maxAgeSeconds = 300,
  nowSeconds = () => Math.floor(Date.now() / 1000),
} = {}) {
  return (req, res, next) => {
    const issuedAt = Number(req.user?.issuedAt);
    const ageSeconds = nowSeconds() - issuedAt;
    if (!Number.isFinite(issuedAt) || ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'RECENT_AUTH_REQUIRED',
          message: `This action requires a token issued within ${maxAgeSeconds} seconds`,
        },
      });
    }
    next();
  };
}

module.exports = { requireRecentAuthentication };
