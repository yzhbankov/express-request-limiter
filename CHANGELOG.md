# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-07

Complete rewrite. See [docs/migration.md](docs/migration.md) for the upgrade path.

### Fixed
- A slot was released twice per response because both `finish` and `close` decremented the counter. Under staggered load the limit was silently under-enforced.
- Requests with a query string, trailing slash or different letter case bypassed route rules because `req.originalUrl` was compared verbatim.
- Errors thrown by `skip`, `handler` and other callbacks now reach `next(err)` instead of escaping as unhandled rejections.

### Added
- `keyGenerator` for per-key limits (per user, IP, tenant) and `max` as a function for dynamic limits; both may return promises.
- `queue` option: bounded, per-key FIFO queueing with timeout instead of immediate rejection, plus `onQueued` and `limiter.getQueueSize()`.
- Route rules with `:param` segments, `*` wildcards, RegExp paths, per-rule method lists, and mount-point awareness inside routers.
- `Retry-After` header, `message` as object or (async) function, `statusCode` validation, `onLimitReached` hook, `requestPropertyName` for `req.requestLimit` (`{ key, limit, current, remaining }`).
- `headers: 'draft-8'` emits the IETF RateLimit header fields with the `concurrent-requests` quota unit.
- Pluggable store contract (`acquire`/`release`, optional `resetKey`/`resetAll`, sync or async), `passOnStoreError`, `limiter.resetKey()`, `limiter.resetAll()`.
- TypeScript source with generated declarations, dual ESM + CommonJS build, Express 5 support with `req.requestLimit` typed on Express's `Request`, plain `http.createServer` support.
- Option validation with descriptive `TypeError`s at construction; unknown option names are rejected.
- Vitest suite with 160+ tests run on Express 5 and 4, micro-benchmark plus a side-by-side benchmark against express-rate-limit, CI matrix (Node 20/22/24), npm provenance release workflow, ESLint + typescript-eslint config.
- Documentation: README, `docs/api.md`, `docs/stores.md`, `docs/recipes.md`, `docs/migration.md`, `llms.txt`, `AGENTS.md`, runnable examples.

### Changed
- **Breaking:** Express moved from `dependencies` to an optional peer dependency. The package has zero runtime dependencies.
- **Breaking:** response headers are now `X-Concurrency-Limit` and `X-Concurrency-Remaining`. The 0.x pair is available with `legacyHeaders: true`.
- **Breaking:** the store API changed from `increment`/`decrement`/`arrayToTree` to `acquire`/`release`.
- **Breaking:** requires Node 20 or newer.
- Options renamed: `maxRequests` to `max`, `routesList` to `routes`, rule `method` to `methods`; `global` removed. Old names still work; `global: false` emits a deprecation warning.
- Rejection responses are written with `res.statusCode` and `res.end()` so they work without Express.
- The package is ESM-first (`"type": "module"`). `require('express-request-limiter')` still returns the factory; named exports are available on both module systems.
- The default message gained a trailing period.

### Removed
- The `utils/server.js` test helper and the old test suite.

## [0.0.4] - 2019-11-10

Last release of the original implementation.
