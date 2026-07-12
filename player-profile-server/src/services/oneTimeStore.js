const Redis = require('ioredis');

class MemoryOneTimeStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.records = new Map();
  }

  async put(namespace, key, value, ttlSeconds) {
    const storageKey = `${namespace}:${key}`;
    const existing = this.records.get(storageKey);
    if (existing && existing.expiresAt > this.now()) return false;
    this.records.set(storageKey, {
      value,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return true;
  }

  async consume(namespace, key) {
    const storageKey = `${namespace}:${key}`;
    const record = this.records.get(storageKey);
    this.records.delete(storageKey);
    if (!record || record.expiresAt <= this.now()) return null;
    return record.value;
  }
}

class RedisOneTimeStore {
  constructor(redis) {
    this.redis = redis;
  }

  async put(namespace, key, value, ttlSeconds) {
    await this.ensureConnected();
    const result = await this.redis.set(
      `${namespace}:${key}`,
      JSON.stringify(value),
      'EX',
      ttlSeconds,
      'NX'
    );
    return result === 'OK';
  }

  async consume(namespace, key) {
    await this.ensureConnected();
    const raw = await this.redis.call('GETDEL', `${namespace}:${key}`);
    return raw ? JSON.parse(raw) : null;
  }

  async ensureConnected() {
    if (this.redis.status === 'wait') await this.redis.connect();
  }
}

class ResilientOneTimeStore {
  constructor(primary, fallback, warn) {
    this.primary = primary;
    this.fallback = fallback;
    this.warn = warn;
    this.didWarn = false;
  }

  async put(namespace, key, value, ttlSeconds) {
    try {
      return await this.primary.put(namespace, key, value, ttlSeconds);
    } catch (error) {
      this.warnOnce(error);
      return this.fallback.put(namespace, key, value, ttlSeconds);
    }
  }

  async consume(namespace, key) {
    try {
      return await this.primary.consume(namespace, key);
    } catch (error) {
      this.warnOnce(error);
      return this.fallback.consume(namespace, key);
    }
  }

  warnOnce(error) {
    if (this.didWarn) return;
    this.didWarn = true;
    this.warn(`Redis one-time store unavailable; using process-local fallback: ${error.message}`);
  }
}

function createOneTimeStore({ redisUrl = '', warn = console.warn, now = Date.now } = {}) {
  const fallback = new MemoryOneTimeStore({ now });
  if (!redisUrl) {
    warn('REDIS_URL is not configured; OAuth state and login tickets are process-local');
    return fallback;
  }
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', () => {
    // Command failures are logged once by ResilientOneTimeStore without leaking the URL.
  });
  return new ResilientOneTimeStore(new RedisOneTimeStore(redis), fallback, warn);
}

module.exports = {
  MemoryOneTimeStore,
  RedisOneTimeStore,
  ResilientOneTimeStore,
  createOneTimeStore,
};
