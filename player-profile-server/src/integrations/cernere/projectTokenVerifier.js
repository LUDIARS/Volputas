const { V4 } = require('paseto');
const { z } = require('zod');
const {
  CernereConfigurationError,
  InvalidCernereTokenError,
} = require('./cernereErrors');

const VOLUPTAS_PROJECT_KEY = 'volputas';
const DEFAULT_REFRESH_COOLDOWN_MS = 30_000;
const SIGNATURE_FAILURE_CODE = 'ERR_PASETO_VERIFICATION_FAILED';

const projectClaimsSchema = z.object({
  sub: z.string().uuid(),
  projectKey: z.literal(VOLUPTAS_PROJECT_KEY),
  kind: z.literal('user_for_project'),
  role: z.string().min(1).optional(),
  displayName: z.string().optional(),
  aud: z.string().min(1),
  iat: z.string().datetime(),
  exp: z.string().datetime(),
  jti: z.string().min(1),
}).passthrough();

class CernereProjectTokenVerifier {
  constructor({
    audience,
    keyProvider,
    now = Date.now,
    refreshCooldownMs = DEFAULT_REFRESH_COOLDOWN_MS,
  }) {
    this.audience = audience;
    this.keyProvider = keyProvider;
    this.now = now;
    this.refreshCooldownMs = refreshCooldownMs;
    this.lastForcedRefreshAt = null;
  }

  async verify(token) {
    if (!this.audience) {
      throw new CernereConfigurationError('VOLPUTAS_AUDIENCE is required for Corpus integration');
    }
    if (typeof token !== 'string' || !token.startsWith('v4.public.')) {
      throw new InvalidCernereTokenError();
    }

    const usedCache = this.keyProvider.hasUsableCache();
    const keys = await this.keyProvider.getKeys();
    const firstResult = await this.verifyWithKeys(token, keys);
    if (firstResult.claims) return firstResult.claims;

    if (usedCache && firstResult.signatureMismatch && this.canForceRefresh()) {
      this.lastForcedRefreshAt = this.now();
      const refreshedKeys = await this.keyProvider.getKeys({ forceRefresh: true });
      const refreshedResult = await this.verifyWithKeys(token, refreshedKeys);
      if (refreshedResult.claims) return refreshedResult.claims;
    }
    throw new InvalidCernereTokenError();
  }

  async verifyWithKeys(token, keys) {
    let signatureMismatch = false;
    for (const { key } of keys) {
      try {
        const verified = await V4.verify(token, key, {
          complete: true,
          audience: this.audience,
        });
        const claims = projectClaimsSchema.safeParse(verified.payload);
        if (claims.success && claims.data.aud === this.audience) {
          return { claims: claims.data, signatureMismatch: false };
        }
        return { claims: null, signatureMismatch: false };
      } catch (error) {
        if (error?.code === SIGNATURE_FAILURE_CODE) {
          signatureMismatch = true;
          continue;
        }
        return { claims: null, signatureMismatch: false };
      }
    }
    return { claims: null, signatureMismatch };
  }

  canForceRefresh() {
    return this.lastForcedRefreshAt === null
      || this.now() - this.lastForcedRefreshAt >= this.refreshCooldownMs;
  }
}

module.exports = {
  CernereProjectTokenVerifier,
  VOLUPTAS_PROJECT_KEY,
};
