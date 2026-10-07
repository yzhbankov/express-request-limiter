# Migrating from 0.x to 1.0

Version 1.0 is a rewrite. Existing 0.x configurations keep working thanks to
aliases, but you should move to the new names and review the behavioural
changes below.

## Why upgrade

- **Double release fixed.** 0.x decremented the counter on both `finish` and `close`, which every supported Node version emits for a normal response. Under staggered load the counter under-counted and the limit was not enforced. 1.0 releases exactly once.
- **Query strings no longer bypass the limiter.** 0.x compared `req.originalUrl` verbatim, so `/api/items?x=1` was never limited. 1.0 matches the normalised path.
- **Express is no longer a runtime dependency.** It is an optional peer dependency; the package has zero dependencies.
- **New capabilities:** per-key limits, dynamic limits, queueing, patterns and RegExp routes, async stores, bundled TypeScript types, Express 5 support, ESM and CommonJS builds.

## Option renames

| 0.x | 1.0 |
|---|---|
| `maxRequests: 10` | `max: 10` |
| `routesList: [{ path, method }]` | `routes: [{ path, methods }]` (`methods` accepts a string or array) |
| `global: true` + `routesList` | just `routes` |
| `global: false` | omit `routes` |

The old names still work. `global: false` with a route list emits a `DeprecationWarning` and ignores the list, as 0.x did.

## Behaviour changes to review

| Area | 0.x | 1.0 |
|---|---|---|
| Default `max` | 100 (README said 10) | 100 |
| Route matching | exact `originalUrl` string, case-sensitive, query string included | normalised path, no query, no trailing slash, case-insensitive, `baseUrl` aware |
| Headers | `X-RequestLimit-Limit`, `X-RequestLimit-Usage` | `X-Concurrency-Limit`, `X-Concurrency-Remaining`, `Retry-After`. Set `legacyHeaders: true` to keep sending the old pair as well. |
| Rejection body | `res.status().send()` | `res.statusCode` + `res.end()`, so it also works without Express. Same default text, now with a trailing period. |
| Store API | `concurrent`, `increment()`, `decrement()`, `arrayToTree()`, `routesTree` | `acquire(key, limit)`, `release(key)`, `get`, `resetKey`, `resetAll`, `snapshot`. Route rules are no longer stored in the store. |
| Unknown options | ignored | throw `TypeError` at construction |
| `skip` / `handler` errors | could crash or hang | forwarded to `next(err)` |
| Mounting the same instance twice | counted twice | counted once |
| Node | any | `>= 20` |
| Module format | CommonJS | ESM + CommonJS. `require()` still returns the factory; `import requestLimiter from` or `import { requestLimiter }` in ESM. |

## Step by step

1. `npm install express-request-limiter@^1`.
2. Rename `maxRequests` to `max` and `routesList` to `routes`; change `method` to `methods` in each rule.
3. Remove `global`. If you had `global: false`, delete `routes` too.
4. If clients read `X-RequestLimit-*` headers, add `legacyHeaders: true` and plan to move them to `X-Concurrency-*`.
5. If you wrote a custom store, port it to `acquire`/`release` (see [stores.md](stores.md)).
6. Run your tests. Requests with query strings on limited routes are now limited, which may change test expectations.

## Example

Before:

```js
app.use(RequestLimiter({
  maxRequests: 10,
  headers: true,
  routesList: [{ path: '/api/first', method: 'GET' }, { path: '/api/second', method: 'PUT' }],
}));
```

After:

```js
import requestLimiter from 'express-request-limiter'; // or: const { requestLimiter } = require('express-request-limiter');

app.use(requestLimiter({
  max: 10,
  routes: [{ path: '/api/first', methods: ['GET'] }, { path: '/api/second', methods: ['PUT'] }],
}));
```
