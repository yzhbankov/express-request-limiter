# Recipes

Short, copy-paste solutions to common needs. All snippets assume:

```js
import express from 'express';
import requestLimiter from 'express-request-limiter';
const app = express();
```

## Protect a database pool

Match the limit to the pool size and leave headroom for background work.

```js
app.use('/api', requestLimiter({ max: POOL_SIZE - 2, queue: { maxSize: 200, timeout: 5000 } }));
```

## Per-IP limit behind a proxy

```js
app.set('trust proxy', 1); // so req.ip is the client, not the load balancer
app.use(requestLimiter({ max: 8, keyGenerator: (req) => req.ip }));
```

## Per-tenant limits from a plan table

```js
const PLAN_LIMITS = { free: 2, pro: 10, enterprise: 50 };

app.use(requestLimiter({
  keyGenerator: (req) => req.tenant.id,
  max: (req) => PLAN_LIMITS[req.tenant.plan] ?? PLAN_LIMITS.free,
}));
```

## One shared pool for several routes

```js
import { MemoryStore } from 'express-request-limiter';
const shared = new MemoryStore();

app.post('/import', requestLimiter({ max: 3, store: shared }), importHandler);
app.post('/export', requestLimiter({ max: 3, store: shared }), exportHandler);
// Imports and exports together never exceed 3 in flight.
```

## Separate pools per route, one middleware

Use the route path as the key so each endpoint gets its own counter:

```js
app.use('/api', requestLimiter({
  max: 5,
  keyGenerator: (req) => `${req.method} ${req.baseUrl}${req.path}`,
}));
```

## Combine with a rate limiter

Concurrency and rate limits answer different questions. Apply both:

```js
import rateLimit from 'express-rate-limit';
app.use(rateLimit({ windowMs: 60_000, limit: 600 }));   // not more than 600/min
app.use(requestLimiter({ max: 25 }));                    // not more than 25 at once
```

## Graceful JSON error that matches your API

```js
app.use(requestLimiter({
  max: 20,
  statusCode: 503,
  message: (req, res, info) => ({
    error: { code: 'OVERLOADED', message: 'Try again shortly', retryAfterSeconds: 2 },
  }),
  retryAfter: 2,
}));
```

## Metrics and logging

```js
app.use(requestLimiter({
  max: 20,
  queue: true,
  onQueued: (req, res, info) => metrics.gauge('limiter.queue', info.queueSize, { key: info.key }),
  onLimitReached: (req, res, info) => {
    metrics.increment('limiter.rejected', { reason: info.reason });
    req.log?.warn({ key: info.key, reason: info.reason }, 'request rejected by concurrency limiter');
  },
}));
```

`req.requestLimit` is available to downstream handlers for per-request load headers or logs.

## Skip health checks and internal traffic

```js
app.use(requestLimiter({
  max: 20,
  skip: (req) => req.path === '/healthz' || req.ip === '127.0.0.1',
}));
```

Or exclude them structurally by listing only the routes to protect in `routes`.

## Shed load under pressure without a limiter per route

Use a dynamic limit based on event-loop lag or memory:

```js
import { monitorEventLoopDelay } from 'node:perf_hooks';
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

app.use(requestLimiter({
  max: () => (lag.mean / 1e6 > 100 ? 5 : 50), // mean lag in ms
}));
```

## Fail open if Redis is unavailable

```js
app.use(requestLimiter({ max: 20, store: new RedisStore(redis), passOnStoreError: true }));
```

## Multiple limiters on one route

Different scopes stack naturally; each instance counts independently:

```js
const global = requestLimiter({ max: 100 });
const perUser = requestLimiter({ max: 3, keyGenerator: (req) => req.user.id });
app.use(global);
app.post('/jobs', perUser, createJob);
```

Mounting the *same* instance twice on a request path counts it once.

## Testing your own app

Hold a request open to create "in flight" state deterministically:

```js
import supertest from 'supertest';

test('third concurrent request is rejected', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  app.get('/slow', requestLimiter({ max: 2 }), async (req, res) => { await gate; res.end('ok'); });

  const a = supertest(app).get('/slow').then((r) => r);
  const b = supertest(app).get('/slow').then((r) => r);
  await new Promise((r) => setTimeout(r, 20));
  const c = await supertest(app).get('/slow');
  expect(c.status).toBe(429);

  release();
  expect((await Promise.all([a, b])).map((r) => r.status)).toEqual([200, 200]);
});
```

Note that `supertest` requests only start when awaited or when `.then` is called.
