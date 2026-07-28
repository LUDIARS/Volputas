const { Router } = require('express');
const crypto = require('node:crypto');
const config = require('../config');
const { getIdentitySource } = require('../services/identity-sources');
const identityService = require('../services/identityService');
const { createOneTimeStore } = require('../services/oneTimeStore');
const { issueTokens, refreshAccessToken, revokeAllTokens } = require('../services/tokenService');
const { getJWKS } = require('../services/jwks');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { parseNativeLogin, verifyCodeVerifier } = require('../services/nativeLogin');

const STATE_TTL_SECONDS = 600;
const TICKET_TTL_SECONDS = 60;

function tokenEnvelope(tokens) {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: 'Bearer',
  };
}

async function createUniqueSecret(store, namespace, value, ttlSeconds) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const secret = crypto.randomBytes(32).toString('hex');
    if (await store.put(namespace, secret, value, ttlSeconds)) return secret;
  }
  throw Object.assign(new Error(`Failed to allocate one-time ${namespace}`), {
    statusCode: 503,
    code: 'TEMPORARY_UNAVAILABLE',
  });
}

function createAuthRouter({
  oneTimeStore = createOneTimeStore({ redisUrl: config.redis.url }),
  resolveSource = getIdentitySource,
  findOrCreateUser = identityService.findOrCreateUser,
  issue = issueTokens,
} = {}) {
  const router = Router();

  router.get('/login', async (req, res, next) => {
    try {
      const source = resolveSource(req.query.provider);
      if (!source || source.kind !== 'oidc') {
        return res.status(400).json({
          ok: false,
          error: { code: 'INVALID_PROVIDER', message: `Unsupported provider: ${req.query.provider}` },
        });
      }
      const state = await createUniqueSecret(
        oneTimeStore,
        'oauth_state',
        {
          provider: source.key,
          createdAt: Date.now(),
          nativeLogin: parseNativeLogin(req.query),
        },
        STATE_TTL_SECONDS
      );
      return res.json({ ok: true, data: { authorizationUrl: source.buildAuthorizationUrl(state) } });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/callback', async (req, res, next) => {
    try {
      const { code, state } = req.query;
      if (typeof code !== 'string' || typeof state !== 'string') {
        return res.status(400).json({
          ok: false,
          error: { code: 'MISSING_PARAMS', message: 'code and state are required' },
        });
      }
      const stateData = await oneTimeStore.consume('oauth_state', state);
      if (!stateData) {
        return res.status(400).json({
          ok: false,
          error: { code: 'INVALID_STATE', message: 'Invalid or expired state parameter' },
        });
      }
      const source = resolveSource(stateData.provider);
      if (!source || source.kind !== 'oidc') {
        return res.status(400).json({
          ok: false,
          error: { code: 'INVALID_PROVIDER', message: `Unsupported provider: ${stateData.provider}` },
        });
      }
      const identity = await source.resolveIdentity({ code });
      const userId = await findOrCreateUser(
        identity.provider,
        identity.providerSub,
        identity.profile,
        identity.rawProfile
      );
      const ticket = await createUniqueSecret(
        oneTimeStore,
        'login_ticket',
        { userId, nativeLogin: stateData.nativeLogin || null },
        TICKET_TTL_SECONDS
      );
      if (stateData.nativeLogin) {
        const redirectUrl = new URL(stateData.nativeLogin.redirectUri);
        redirectUrl.searchParams.set('ticket', ticket);
        redirectUrl.searchParams.set('state', stateData.nativeLogin.nonce);
        return res.redirect(302, redirectUrl.toString());
      }
      const completeUrl = new URL('/auth/complete', config.frontendUrl);
      completeUrl.hash = `ticket=${encodeURIComponent(ticket)}`;
      return res.redirect(302, completeUrl.toString());
    } catch (error) {
      return next(error);
    }
  });

  router.post('/ticket', async (req, res, next) => {
    try {
      const ticket = req.body?.ticket;
      if (typeof ticket !== 'string' || ticket.length === 0) {
        return res.status(400).json({
          ok: false,
          error: { code: 'MISSING_PARAMS', message: 'ticket is required' },
        });
      }
      const ticketData = await oneTimeStore.consume('login_ticket', ticket);
      if (!ticketData) {
        return res.status(401).json({
          ok: false,
          error: { code: 'INVALID_TICKET', message: 'Invalid or expired login ticket' },
        });
      }
      if (ticketData.nativeLogin
          && !verifyCodeVerifier(req.body?.code_verifier, ticketData.nativeLogin.codeChallenge)) {
        return res.status(401).json({
          ok: false,
          error: { code: 'INVALID_PKCE_VERIFIER', message: 'Invalid PKCE code verifier' },
        });
      }
      return res.json({ ok: true, data: tokenEnvelope(await issue(ticketData.userId)) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/token', async (req, res, next) => {
    try {
      const { code, code_verifier: codeVerifier, provider } = req.body;
      if (!code || !codeVerifier || !provider) {
        return res.status(400).json({
          ok: false,
          error: { code: 'MISSING_PARAMS', message: 'code, code_verifier, and provider are required' },
        });
      }
      const source = resolveSource(provider);
      if (!source || source.kind !== 'oidc') {
        return res.status(400).json({
          ok: false,
          error: { code: 'INVALID_PROVIDER', message: `Unsupported provider: ${provider}` },
        });
      }
      const identity = await source.resolveIdentity({ code, codeVerifier });
      const userId = await findOrCreateUser(
        identity.provider,
        identity.providerSub,
        identity.profile,
        identity.rawProfile
      );
      return res.json({ ok: true, data: tokenEnvelope(await issue(userId)) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/refresh', validate({
    body: { refresh_token: { required: true, type: 'string' } },
  }), async (req, res, next) => {
    try {
      return res.json({ ok: true, data: tokenEnvelope(await refreshAccessToken(req.body.refresh_token)) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', authenticate, async (req, res, next) => {
    try {
      await revokeAllTokens(req.user.id);
      return res.json({ ok: true, data: { message: 'Logged out successfully' } });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/.well-known/jwks.json', async (_req, res, next) => {
    try {
      return res.json(await getJWKS());
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
module.exports.createUniqueSecret = createUniqueSecret;
