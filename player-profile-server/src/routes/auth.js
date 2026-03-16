const { Router } = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const userModel = require('../models/userModel');
const identityModel = require('../models/identityModel');
const { issueTokens, refreshAccessToken, revokeAllTokens } = require('../services/tokenService');
const { getJWKS } = require('../services/jwks');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = Router();

// In-memory state store (use Redis in production)
const stateStore = new Map();

// GET /auth/login?provider=google
router.get('/login', (req, res) => {
  const { provider } = req.query;
  const providerConfig = config.oauth[provider];

  if (!providerConfig || !providerConfig.authorizationUrl) {
    return res.status(400).json({
      ok: false,
      error: { code: 'INVALID_PROVIDER', message: `Unsupported provider: ${provider}` },
    });
  }

  const state = crypto.randomBytes(32).toString('hex');
  const codeChallenge = req.query.code_challenge;
  const codeChallengeMethod = req.query.code_challenge_method || 'S256';

  stateStore.set(state, {
    provider,
    codeChallenge,
    codeChallengeMethod,
    createdAt: Date.now(),
  });

  // Clean up old states (older than 10 minutes)
  for (const [key, val] of stateStore) {
    if (Date.now() - val.createdAt > 600_000) stateStore.delete(key);
  }

  const params = new URLSearchParams({
    client_id: providerConfig.clientId,
    redirect_uri: providerConfig.callbackUrl,
    response_type: 'code',
    scope: providerConfig.scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  res.json({
    ok: true,
    data: { authorizationUrl: `${providerConfig.authorizationUrl}?${params}` },
  });
});

// GET /auth/callback — IdP callback
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAMS', message: 'code and state are required' },
      });
    }

    const stateData = stateStore.get(state);
    if (!stateData) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_STATE', message: 'Invalid or expired state parameter' },
      });
    }
    stateStore.delete(state);

    const provider = stateData.provider;
    const providerConfig = config.oauth[provider];

    // Exchange authorization code for tokens with IdP
    const tokenResponse = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: providerConfig.clientId,
        client_secret: providerConfig.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: providerConfig.callbackUrl,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: { code: 'IDP_ERROR', message: 'Failed to exchange code with identity provider' },
      });
    }

    // Fetch user info from IdP
    const userinfoResponse = await fetch(providerConfig.userinfoUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userInfo = await userinfoResponse.json();
    if (!userinfoResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: { code: 'IDP_ERROR', message: 'Failed to fetch user info from identity provider' },
      });
    }

    // Resolve provider sub and profile
    const providerSub = resolveProviderSub(provider, userInfo);
    const profileData = resolveProfileData(provider, userInfo);

    // Look up or create user
    let identity = await identityModel.findByProviderSub(provider, providerSub);
    let userId;

    if (identity) {
      userId = identity.user_id;
    } else {
      // Create new user + identity
      const newUserId = uuidv4();
      await userModel.create({
        id: newUserId,
        displayName: profileData.displayName,
        avatarUrl: profileData.avatarUrl,
      });
      await identityModel.create({
        userId: newUserId,
        provider,
        providerSub,
        email: profileData.email,
        rawProfile: userInfo,
      });
      userId = newUserId;
    }

    // Issue service tokens
    const tokens = await issueTokens(userId);

    res.json({
      ok: true,
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: 'Bearer',
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/token — exchange code + code_verifier (PKCE flow for clients)
router.post('/token', async (req, res, next) => {
  try {
    const { code, code_verifier, provider } = req.body;

    if (!code || !code_verifier || !provider) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAMS', message: 'code, code_verifier, and provider are required' },
      });
    }

    const providerConfig = config.oauth[provider];
    if (!providerConfig) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_PROVIDER', message: `Unsupported provider: ${provider}` },
      });
    }

    // Exchange code with IdP using PKCE
    const tokenResponse = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: providerConfig.clientId,
        code,
        code_verifier,
        grant_type: 'authorization_code',
        redirect_uri: providerConfig.callbackUrl,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: { code: 'IDP_ERROR', message: 'Failed to exchange code with identity provider' },
      });
    }

    // Fetch user info
    const userinfoResponse = await fetch(providerConfig.userinfoUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userinfoResponse.json();

    const providerSub = resolveProviderSub(provider, userInfo);
    const profileData = resolveProfileData(provider, userInfo);

    let identity = await identityModel.findByProviderSub(provider, providerSub);
    let userId;

    if (identity) {
      userId = identity.user_id;
    } else {
      const newUserId = uuidv4();
      await userModel.create({
        id: newUserId,
        displayName: profileData.displayName,
        avatarUrl: profileData.avatarUrl,
      });
      await identityModel.create({
        userId: newUserId,
        provider,
        providerSub,
        email: profileData.email,
        rawProfile: userInfo,
      });
      userId = newUserId;
    }

    const tokens = await issueTokens(userId);

    res.json({
      ok: true,
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: 'Bearer',
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', validate({
  body: { refresh_token: { required: true, type: 'string' } },
}), async (req, res, next) => {
  try {
    const tokens = await refreshAccessToken(req.body.refresh_token);
    res.json({
      ok: true,
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: 'Bearer',
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await revokeAllTokens(req.user.id);
    res.json({ ok: true, data: { message: 'Logged out successfully' } });
  } catch (err) {
    next(err);
  }
});

// GET /auth/.well-known/jwks.json
router.get('/.well-known/jwks.json', async (_req, res, next) => {
  try {
    const jwks = await getJWKS();
    res.json(jwks);
  } catch (err) {
    next(err);
  }
});

// GET /auth/.well-known/openid-configuration
router.get('/.well-known/openid-configuration', (req, res) => {
  const baseUrl = config.jwt.issuer;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/auth/login`,
    token_endpoint: `${baseUrl}/auth/token`,
    jwks_uri: `${baseUrl}/auth/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  });
});

// Helper functions
function resolveProviderSub(provider, userInfo) {
  switch (provider) {
    case 'google': return userInfo.sub;
    case 'discord': return userInfo.id;
    case 'steam': return userInfo.steamid;
    default: return userInfo.sub || userInfo.id;
  }
}

function resolveProfileData(provider, userInfo) {
  switch (provider) {
    case 'google':
      return {
        displayName: userInfo.name || 'Player',
        email: userInfo.email,
        avatarUrl: userInfo.picture,
      };
    case 'discord':
      return {
        displayName: userInfo.username || 'Player',
        email: userInfo.email,
        avatarUrl: userInfo.avatar
          ? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png`
          : null,
      };
    case 'steam':
      return {
        displayName: userInfo.personaname || 'Player',
        email: null,
        avatarUrl: userInfo.avatarfull,
      };
    default:
      return { displayName: 'Player', email: null, avatarUrl: null };
  }
}

module.exports = router;
