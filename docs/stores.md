# Stores

A store holds the in-flight count per key. The limiter calls it twice per
admitted request: `acquire` when the request arrives and `release` when the
response finishes or the connection closes.

## Contract

```ts
interface Store {
  /** Reserve one slot for `key` if fewer than `limit` are in use.
   *  Return the new count, or `false` when the key is at (or above) the limit. */
  acquire(key: string, limit: number): number | false | Promise<number | false>;

  /** Free one slot. Must tolerate keys it has never seen and never go negative. */
  release(key: string): number | void | Promise<number | void>;

  get?(key: string): number | Promise<number>;        // optional, for introspection
  resetKey?(key: string): void | Promise<void>;       // optional, used by limiter.resetKey()
  resetAll?(): void | Promise<void>;                  // optional, used by limiter.resetAll()
}
```

Rules the limiter relies on:

1. `acquire` must be atomic per key: two concurrent calls at `limit - 1` must not both succeed.
2. `release` is called at most once per successful `acquire`.
3. Returning a promise is fine; the limiter detects thenables per call, so a store may even be synchronous for some calls and asynchronous for others.
4. Errors thrown or rejected from `acquire` are routed by `passOnStoreError`. Errors from `release` are swallowed.

## MemoryStore (default)

```js
import { MemoryStore } from 'express-request-limiter';
const store = new MemoryStore();
store.acquire('k', 2); // 1
store.acquire('k', 2); // 2
store.acquire('k', 2); // false
store.release('k');    // 1
store.get('k');        // 1
store.snapshot();      // { k: 1 }
store.size;            // 1
```

Fully synchronous, keeps a `Map<string, number>`, deletes keys at zero. Share one instance between several limiters to make them draw from the same pool:

```js
const pool = new MemoryStore();
app.use('/reports', requestLimiter({ max: 5, store: pool }));
app.use('/exports', requestLimiter({ max: 5, store: pool })); // 5 in total across both
```

## Redis

Counts in Redis let every instance behind a load balancer share one limit. The
Lua script keeps the check-and-increment atomic.

```js
// examples/redis-store.js has a runnable version.
const ACQUIRE = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current >= tonumber(ARGV[1]) then return -1 end
  current = redis.call('INCR', KEYS[1])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return current
`;

class RedisStore {
  constructor(redis, { prefix = 'crl:', ttlMs = 60000 } = {}) {
    this.redis = redis;
    this.prefix = prefix;
    this.ttlMs = ttlMs;
  }
  async acquire(key, limit) {
    const n = await this.redis.eval(ACQUIRE, 1, this.prefix + key, limit, this.ttlMs);
    return n < 0 ? false : n;
  }
  async release(key) {
    const n = await this.redis.decr(this.prefix + key);
    if (n <= 0) await this.redis.del(this.prefix + key);
    return Math.max(0, n);
  }
  async get(key) {
    return Number(await this.redis.get(this.prefix + key)) || 0;
  }
  async resetKey(key) {
    await this.redis.del(this.prefix + key);
  }
}
```

Notes for a distributed store:

- Use a TTL as a safety net. If a process dies between `acquire` and `release` the slot would otherwise leak forever. Choose a TTL longer than your slowest legitimate request.
- Queueing is per process. With `queue` enabled, each instance keeps its own FIFO and re-checks the shared count when one of *its* requests finishes. Fairness across instances is approximate.
- Decide on `passOnStoreError`. Failing open keeps the service up when Redis is down; failing closed protects the upstream.

## Testing a custom store

The contract is small enough to unit test directly:

```js
test('acquire is bounded', async () => {
  expect(await store.acquire('k', 1)).toBe(1);
  expect(await store.acquire('k', 1)).toBe(false);
  await store.release('k');
  expect(await store.acquire('k', 1)).toBe(1);
});
```

Then plug it into the limiter with `supertest`, hold a request open, and assert the second one gets `429`. The repository's `test/async-store.test.js` shows the pattern.

In TypeScript, `class RedisStore implements Store` from `'express-request-limiter'` checks the contract at compile time.
