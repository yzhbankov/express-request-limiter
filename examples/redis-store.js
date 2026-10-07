/**
 * Share one limit across several processes with Redis.
 *
 * Requires a Redis client; this example uses ioredis, which is not a
 * dependency of this package:
 *
 *   npm install ioredis
 *   npm run build && REDIS_URL=redis://localhost:6379 node examples/redis-store.js
 *
 * The Lua script makes "check then increment" atomic. The TTL protects
 * against leaked slots if a process dies between acquire and release.
 */

import { pathToFileURL } from 'node:url';
import express from 'express';
import requestLimiter from 'express-request-limiter';

const ACQUIRE = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current >= tonumber(ARGV[1]) then return -1 end
  current = redis.call('INCR', KEYS[1])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return current
`;

export default class RedisStore {
  /**
   * @param {import('ioredis').Redis} redis
   * @param {{ prefix?: string, ttlMs?: number }} [options]
   */
  constructor(redis, { prefix = 'concurrency:', ttlMs = 60000 } = {}) {
    this.redis = redis;
    this.prefix = prefix;
    this.ttlMs = ttlMs;
  }

  async acquire(key, limit) {
    const count = await this.redis.eval(ACQUIRE, 1, this.prefix + key, limit, this.ttlMs);
    return count < 0 ? false : Number(count);
  }

  async release(key) {
    const count = await this.redis.decr(this.prefix + key);
    if (count <= 0) {
      await this.redis.del(this.prefix + key);
      return 0;
    }
    return count;
  }

  async get(key) {
    return Number(await this.redis.get(this.prefix + key)) || 0;
  }

  async resetKey(key) {
    await this.redis.del(this.prefix + key);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  const app = express();
  app.use(requestLimiter({
    max: 10,
    store: new RedisStore(redis),
    passOnStoreError: true, // keep serving if Redis is unavailable
    keyGenerator: (req) => req.ip,
  }));
  app.get('/', async (req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    res.send('ok\n');
  });
  app.listen(3000, () => console.log('listening on http://localhost:3000 with a Redis-backed limiter'));
}
