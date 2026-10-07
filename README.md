# express-request-limiter

**Super light, super fast concurrency limiter for Express.** Cap how many requests run *at the same time*, globally, per route, or per user/IP. Reject the rest with `429`, or queue them until a slot frees.

[![npm](https://img.shields.io/npm/v/express-request-limiter.svg)](https://www.npmjs.com/package/express-request-limiter)
[![CI](https://github.com/yzhbankov/express-request-limiter/actions/workflows/ci.yml/badge.svg)](https://github.com/yzhbankov/express-request-limiter/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen.svg)](vitest.config.ts)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![size](https://img.shields.io/badge/size-20%20kB-blue.svg)](#light-fast-tested)
[![node](https://img.shields.io/node/v/express-request-limiter.svg)](package.json)
[![license](https://img.shields.io/npm/l/express-request-limiter.svg)](LICENSE)

```js
import express from 'express';
import requestLimiter from 'express-request-limiter';

const app = express();
app.use(requestLimiter({ max: 20 })); // never more than 20 requests in flight
```

## Light, fast, tested

| | express-request-limiter | express-rate-limit |
|---|---|---|
| Overhead per request | **~240 ns** | ~1070 ns |
| Runtime dependencies | **0** | 2 |
| Package size | **20 kB** packed, 9 files | ~150 kB unpacked |
| Test coverage | **100%** lines, 166 tests, Express 5 and 4, Node 20/22/24 | |
| Limits | concurrent in-flight requests | requests per time window |

Measured with `npm run bench:compare` on the same mock objects, Node 20. The two libraries solve different problems and stack well together; the table shows cost, not a replacement. Coverage thresholds are enforced in CI.

## Install

```sh
npm install express-request-limiter
```

Node 20+. ESM and CommonJS. Types included. Express is an optional peer dependency; the middleware also runs on Connect and plain `http.createServer`.

## Use

```js
// Only some routes
app.use(requestLimiter({ max: 10, routes: [{ path: '/api/*' }, { path: '/users/:id', methods: ['DELETE'] }] }));

// One route
app.post('/export', requestLimiter({ max: 2 }), exportHandler);

// Per user or IP
app.use(requestLimiter({ max: 4, keyGenerator: (req) => req.user?.id ?? req.ip }));

// Different limits per client
app.use(requestLimiter({ max: (req) => (req.user?.plan === 'pro' ? 50 : 5), keyGenerator: (req) => req.ip }));

// Queue instead of rejecting
app.use('/render', requestLimiter({ max: 4, queue: { maxSize: 100, timeout: 15000 } }));

// Exempt health checks
app.use(requestLimiter({ max: 20, skip: (req) => req.path === '/healthz' }));
```

Rejected requests get:

```http
HTTP/1.1 429 Too Many Requests
X-Concurrency-Limit: 20
X-Concurrency-Remaining: 0
Retry-After: 1
```

Downstream handlers can read `req.requestLimit` as `{ key, limit, current, remaining }`.

## Options

All optional. Unknown names throw at startup. Full reference: [docs/api.md](docs/api.md).

| Option | Default | What it does |
|---|---|---|
| `max` | `100` | Concurrent requests per key. Number or `(req, res) => number`. |
| `routes` | all | `[{ path, methods }]`. Exact, `:param`, `*`, or RegExp paths. |
| `keyGenerator` | one shared key | `(req, res) => string` to partition counters. |
| `skip` | | `(req, res) => boolean` to bypass. |
| `queue` | `false` | `true` or `{ maxSize, timeout }` to wait instead of reject. |
| `statusCode` | `429` | Rejection status. |
| `message` | text | String, JSON object, or `(req, res, info) => body`. |
| `retryAfter` | `1` | Seconds for `Retry-After`; `false` to omit. |
| `headers` | `true` | `X-Concurrency-*` headers, `'draft-8'` for IETF `RateLimit` fields, `false` for none. |
| `handler` | built-in | `(req, res, next, info)` to customise the rejection. |
| `onLimitReached` | | Observe rejections. |
| `store` | in-memory | Share counts across processes. See [docs/stores.md](docs/stores.md). |
| `requestPropertyName` | `'requestLimit'` | Where to expose the state on `req`; `false` to skip. |
| `passOnStoreError` | `false` | Admit (`true`) or fail (`false`) when the store errors. |

Also: `caseSensitive`, `legacyHeaders`, `onQueued`. The middleware exposes `store`, `options`, `resetKey(key)`, `resetAll()`, `getQueueSize(key?)`.

## TypeScript and CommonJS

```ts
import requestLimiter, { type Options, type Store } from 'express-request-limiter';
app.get('/jobs', (req, res) => res.json(req.requestLimit)); // typed on Express's Request
```

```js
const { requestLimiter } = require('express-request-limiter');
```

## When to use it

Protecting a database pool, a slow upstream, a CPU-heavy endpoint, or a render farm from being flooded. Backpressure, load shedding, the bulkhead pattern, per-tenant fairness. Pair it with a time-window rate limiter such as express-rate-limit when you need both "not too many at once" and "not too many per minute".

## More

- [API reference](docs/api.md), [recipes](docs/recipes.md), [custom stores and Redis](docs/stores.md), [migrating from 0.x](docs/migration.md)
- [`llms.txt`](llms.txt) for AI agents, [`AGENTS.md`](AGENTS.md) for contributors
- `npm run check` runs lint, types, build, and the suite on Express 5 and 4; `npm run bench` and `npm run bench:compare` reproduce the numbers

MIT © Iaroslav Zhbankov
