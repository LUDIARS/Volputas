const {
  createPrivateKey,
  randomBytes,
  sign,
} = require('node:crypto');

const ASSERTION_AUDIENCE = 'discutere-persona-bridge';
const ASSERTION_TTL_SECONDS = 2 * 60;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{5,24}$/;

/** @implements SPEC-DISCUSSION-RETURN-ASSERTION */
function assertionError(message) {
  return Object.assign(new Error(message), {
    code: 'DISCUTERE_BRIDGE_CONFIG_INVALID',
    statusCode: 503,
  });
}

/** @implements SPEC-DISCUSSION-RETURN-ASSERTION */
function parsePrivateKey(encoded) {
  if (typeof encoded !== 'string' || !BASE64URL_PATTERN.test(encoded)) {
    throw assertionError(
      'Discutere persona bridge assertion private key must be base64url'
    );
  }
  try {
    const key = createPrivateKey({
      key: Buffer.from(encoded, 'base64url'),
      format: 'der',
      type: 'pkcs8',
    });
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('not Ed25519');
    }
    return key;
  } catch {
    throw assertionError(
      'Discutere persona bridge assertion private key must be Ed25519 PKCS8 DER'
    );
  }
}

class DiscussionBridgeAssertionSigner {
  /** @implements SPEC-DISCUSSION-RETURN-ASSERTION */
  constructor({
    privateKey,
    now = () => Date.now(),
    createJti = () => randomBytes(24).toString('base64url'),
  }) {
    this.privateKey = parsePrivateKey(privateKey);
    this.now = now;
    this.createJti = createJti;
  }

  /** @implements SPEC-DISCUSSION-RETURN-ASSERTION */
  signForAuthor(authorId) {
    if (typeof authorId !== 'string' || !DISCORD_SNOWFLAKE_PATTERN.test(authorId)) {
      throw new TypeError('authorId must be a Discord snowflake');
    }
    const jti = this.createJti();
    if (typeof jti !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(jti)) {
      throw new TypeError('assertion jti must be 16-128 base64url characters');
    }
    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new TypeError('assertion clock must return epoch milliseconds');
    }
    const payload = Buffer.from(JSON.stringify({
      authorId,
      aud: ASSERTION_AUDIENCE,
      exp: Math.floor(now / 1_000) + ASSERTION_TTL_SECONDS,
      jti,
    }), 'utf8').toString('base64url');
    const signature = sign(null, Buffer.from(payload, 'utf8'), this.privateKey);
    return `${payload}.${signature.toString('base64url')}`;
  }
}

module.exports = {
  ASSERTION_AUDIENCE,
  ASSERTION_TTL_SECONDS,
  DiscussionBridgeAssertionSigner,
};
