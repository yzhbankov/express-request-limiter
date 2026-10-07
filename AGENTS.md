# Working on express-request-limiter

Guide for coding agents and new contributors. The user-facing API is in
[`llms.txt`](llms.txt) and [`docs/api.md`](docs/api.md); this file is about
the repository itself.

## What this package is

A concurrency limiter middleware (max requests in flight at once), not a
rate limiter. Zero runtime dependencies. TypeScript source, built with tsup
into ESM + CommonJS + declarations under `dist/`. Supports Express 5 and 4,
Connect, plain `http`. Node 20+.

## Layout

```
src/index.ts             entry; default + named exports; `export type *` re-exports src/types.ts
src/types.ts             public types + `declare global { namespace Express { interface Request { requestLimit? } } }`
src/request-limiter.ts   the middleware: matching -> skip -> key/limit -> acquire -> admit|reject|queue; release on finish/close
src/options.ts           option validation + defaults + 0.x aliases; throws TypeError on bad input
src/routes.ts            compileRoutes(), getRequestPath(), normalizePath(), patternToRegExp()
src/memory-store.ts      default synchronous store
dist/                    build output (gitignored; `npm run build`)
tsup.config.ts           ESM + CJS + dts; a CJS footer makes `require()` return the factory itself
vitest.config.ts         globals on, coverage thresholds
test/helpers.js          createApp (Express 5, or 4 via EXPRESS_VERSION=4), createGate, fire, waitUntil, listen/rawRequest, mockReq/mockRes, AsyncStore
test/*.test.js           Vitest suites (ESM); one file per concern; import from ../src
test/types/              compile-only type tests incl. Express 5 `app.use` compatibility (`npm run typecheck`)
test/smoke/              esm.mjs + cjs.cjs import the BUILT package by name (self-reference through the exports map)
bench/                   micro-benchmark against dist; compare.bench.js runs express-rate-limit side by side
docs/                    api.md, stores.md, recipes.md, migration.md
examples/                runnable ESM scripts (build first)
```

## Commands

```
npm install
npm run build            tsup -> dist/
npm test                 Vitest on Express 5
npm run test:express4    same suite on Express 4
npm run test:coverage    thresholds: 95% statements/lines/functions, 90% branches
npm run typecheck        tsc over src and test/types
npm run test:smoke       ESM + CJS imports of the built package (run build first)
npm run lint             eslint + typescript-eslint (flat config)
npm run check            everything above
npm run bench            micro-benchmark (build first)
npm run bench:compare    vs express-rate-limit (build first)
```

CI (`.github/workflows/ci.yml`) runs lint + typecheck + build + smoke once and
Vitest on a Node 20/22/24 x Express 5/4 matrix. Tags `v*` publish to npm with
provenance (`.github/workflows/release.yml`, needs `NPM_TOKEN`).

## Invariants to preserve

1. **Exactly one release per admitted request.** `admit` registers one `release` closure on `finish` and `close`; a `live` flag makes the second event a no-op. Node emits both for a normal response. Any change here needs the regression test in `test/limiter.test.js` ("finishing one response frees exactly one slot") to stay green.
2. **No promises or avoidable allocations on the hot path with MemoryStore.** `acquire`/`admit`/`onDone` are written out with explicit sync and thenable branches; `attempt()` (which allocates closures) is only used off the hot path (`skip`, `drain`). Keep per-request allocations to the state object and the release closure. The `seen` marker is one module-level symbol holding the instance, because per-instance symbols made property ICs megamorphic across limiters (measured: +130 ns per request with several instances).
3. **All user callbacks are wrapped.** Sync throws and rejections go to `next(err)`. New callbacks must follow the same pattern (see how `skip`, `keyGenerator`, `handler`, `onQueued` are handled).
4. **Validation only at construction.** `normalizeOptions` throws descriptive `TypeError`s; the request path assumes valid options. Unknown option names are rejected on purpose, so adding an option means adding it to `OPTIONS`, the docs tables, `src/types.ts`, and the type test.
5. **Queue fairness.** Per-key FIFO; new arrivals join behind existing waiters; a slot acquired for a waiter that has left is released again (`drained`).
6. **Framework independence.** Only use `req.method`, `req.url`/`req.path`/`req.baseUrl`, `res.setHeader`, `res.headersSent`, `res.statusCode`, `res.end`, and response events. No `res.status()`/`res.send()`/`res.json()` in library code.
7. **0.x aliases keep working** (`maxRequests`, `routesList`, `method`, `global`, `RequestLimiter` export, `legacyHeaders`).

## Adding an option (checklist)

- `src/options.ts`: add to `OPTIONS`, validate, default, return.
- `src/request-limiter.ts`: destructure and use; keep sync fast path.
- `src/types.ts`: `Options` (and `ResolvedOptions` if the resolved shape differs).
- `test/options.test.js` (validation), a behaviour test in the relevant suite, `test/types/index.test-d.ts`.
- Run `npm run bench` before and after; the admit path should stay around 200 ns on the reference machine.
- `README.md` options table, `docs/api.md` section, `llms.txt` options list, `CHANGELOG.md`.

## Testing patterns

- Create in-flight requests with `createGate()`: the handler parks `res`, `gate.waitFor(n)` waits until `n` requests reached it, `gate.release(i)` ends one. `waitUntil(predicate)` polls for any other condition.
- `fire(app, path, { count, headers })` starts supertest requests immediately. Plain `supertest(app).get()` is lazy and does nothing until awaited.
- `listen(app)` + `rawRequest()` gives an abortable raw HTTP request for client-disconnect scenarios.
- Prefer deterministic control (gates, controllable stores) over sleeps. Use `sleep(0)` only to let `finish`/`close` handlers run.
- Every `createApp` gets a terminal error handler that responds `500 error: <message>`, so error-propagation tests assert on the body.

## Style

- TypeScript in `src/`, ESM everywhere else; 2-space indent, single quotes, trailing commas; single-line `if` without braces is fine (`curly: multi-line`).
- Small, named inner functions in the middleware; no classes on the request path.
- Comments explain *why*; the code should show *what*.

## Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. `npm run check && npm pack --dry-run` (the tarball should contain only dist/, llms.txt, CHANGELOG.md, README.md, LICENSE, package.json).
3. Tag `vX.Y.Z` and push the tag; the release workflow publishes with provenance.
