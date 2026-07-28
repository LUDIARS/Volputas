const { pickProfileFields } = require('../profileFields');

function resolveProviderSub(provider, userInfo) {
  const value = provider === 'google' || provider === 'cernere' ? userInfo.sub : userInfo.id;
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`Identity provider did not return a stable subject for ${provider}`), {
      statusCode: 502,
      code: 'IDP_PROFILE_INVALID',
    });
  }
  return value;
}

function resolveProfile(provider, userInfo) {
  if (provider === 'google' || provider === 'cernere') {
    return {
      displayName: userInfo.name || 'Player',
      email: userInfo.email || null,
      avatarUrl: userInfo.picture || null,
      locale: userInfo.locale || 'ja',
    };
  }
  return {
    displayName: userInfo.username || 'Player',
    email: userInfo.email || null,
    avatarUrl: userInfo.avatar
      ? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png`
      : null,
    locale: userInfo.locale || 'ja',
  };
}

function createOidcSource(key, providerConfig) {
  return {
    key,
    kind: 'oidc',
    providerConfig,

    buildAuthorizationUrl(state) {
      const params = new URLSearchParams({
        client_id: providerConfig.clientId,
        redirect_uri: providerConfig.callbackUrl,
        response_type: 'code',
        scope: providerConfig.scopes.join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
      });
      return `${providerConfig.authorizationUrl}?${params}`;
    },

    async resolveIdentity({ code, codeVerifier, fetchImpl = fetch }) {
      const tokenBody = {
        client_id: providerConfig.clientId,
        code,
        grant_type: 'authorization_code',
        redirect_uri: providerConfig.callbackUrl,
      };
      if (codeVerifier) tokenBody.code_verifier = codeVerifier;
      else tokenBody.client_secret = providerConfig.clientSecret;

      const tokenResponse = await fetchImpl(providerConfig.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenBody),
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || typeof tokenData.access_token !== 'string') {
        throw Object.assign(new Error('Failed to exchange code with identity provider'), {
          statusCode: 502,
          code: 'IDP_ERROR',
        });
      }

      const userinfoResponse = await fetchImpl(providerConfig.userinfoUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userInfo = await userinfoResponse.json();
      if (!userinfoResponse.ok) {
        throw Object.assign(new Error('Failed to fetch user info from identity provider'), {
          statusCode: 502,
          code: 'IDP_ERROR',
        });
      }
      return {
        provider: key,
        providerSub: resolveProviderSub(key, userInfo),
        profile: resolveProfile(key, userInfo),
        rawProfile: pickProfileFields(key, userInfo),
      };
    },
  };
}

module.exports = { createOidcSource, resolveProviderSub, resolveProfile };
