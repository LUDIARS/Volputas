const { z } = require('zod');
const {
  CernereConfigurationError,
  CernereIntegrationError,
} = require('./cernereErrors');

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 4_000;
const RAW_ED25519_PUBLIC_KEY_BYTES = 32;

const publicKeyDocumentSchema = z.object({
  keys: z.array(z.object({
    kid: z.string().trim().min(1).max(200),
    alg: z.literal('EdDSA'),
    public_key: z.string().trim().min(1).max(200),
  }).passthrough()).min(1).max(16),
}).passthrough();

function decodePublicKey(encoded) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('invalid base64 public key');
  }
  const key = Buffer.from(encoded, 'base64');
  if (
    key.length !== RAW_ED25519_PUBLIC_KEY_BYTES
    || key.toString('base64') !== encoded
  ) {
    throw new Error('invalid Ed25519 public key');
  }
  return key;
}

class CernerePublicKeyProvider {
  constructor({
    baseUrl,
    fetchImpl = fetch,
    now = Date.now,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  }) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cacheTtlMs = cacheTtlMs;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.cached = null;
    this.refreshPromise = null;
  }

  hasUsableCache() {
    return Boolean(this.cached && this.cached.expiresAt > this.now());
  }

  async getKeys({ forceRefresh = false } = {}) {
    if (!forceRefresh && this.hasUsableCache()) {
      return this.cached.keys;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.fetchKeys().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async fetchKeys() {
    if (!this.baseUrl) {
      throw new CernereConfigurationError('CERNERE_BASE_URL is required for Corpus integration');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/.well-known/cernere-public-key`,
        {
          signal: controller.signal,
          redirect: 'error',
        },
      );
      if (!response.ok) {
        throw new CernereIntegrationError(
          `Cernere public key request failed (${response.status})`,
        );
      }
      const parsed = publicKeyDocumentSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new CernereIntegrationError('Cernere returned an invalid public key document');
      }
      let keys;
      try {
        keys = parsed.data.keys.map((entry) => ({
          kid: entry.kid,
          key: decodePublicKey(entry.public_key),
        }));
      } catch {
        throw new CernereIntegrationError('Cernere returned an invalid Ed25519 public key');
      }
      this.cached = {
        keys,
        expiresAt: this.now() + this.cacheTtlMs,
      };
      return keys;
    } catch (error) {
      if (error instanceof CernereIntegrationError) throw error;
      throw new CernereIntegrationError('Cernere public key request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  CernerePublicKeyProvider,
  decodePublicKey,
};
