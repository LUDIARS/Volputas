const crypto = require('node:crypto');

function pseudoId(sid, secret) {
  if (!secret) {
    throw Object.assign(new Error('VOLPUTAS_PSEUDO_ID_SECRET is required for utterance export'), {
      code: 'PSEUDO_ID_DISABLED',
    });
  }
  if (typeof sid !== 'string' || sid.length === 0) throw new TypeError('sid must be a non-empty string');
  const digest = crypto.createHmac('sha256', secret).update(sid, 'utf8').digest('hex').slice(0, 16);
  return `ext:voluptas:${digest}`;
}

module.exports = { pseudoId };
