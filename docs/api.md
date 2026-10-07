# API reference

```ts
import requestLimiter, { MemoryStore, compileRoutes } from 'express-request-limiter';
import type { Options, Middleware, Store, LimitInfo, RouteRule } from 'express-request-limiter';
// CommonJS: const { requestLimiter, MemoryStore } = require('express-request-limiter');

const limiter = requestLimiter(options);
```

`requestLimiter<Req, Res>()` is generic over the request and response types (defaults: Node's `IncomingMessage`/`ServerResponse`), so Express's `Request`/`Response` can be passed for fully typed callbacks. `req.requestLimit` is declared on Express's `Request` through a global augmentation.

`requestLimiter(options?)` validates `options`, throwing a `TypeError` on the first problem, and returns a middleware function `(req, res, next)`.

Terminology: a request is **in flight** from the moment the limiter admits it until its response emits `finish` or `close`. The **key** is the counter a request is charged to; without `keyGenerator` every request shares the key `'global'`.

## Options

### `max`

`number | (req, res) => number | Promise<number>`, default `100`.

Maximum in-flight requests per key. `0` rejects every in-scope request. A function is called once per request after `skip`; it must return a finite number `>= 0`, otherwise the request fails with a `TypeError` passed to `next`.

With queueing, each waiter remembers its own limit. A waiter is admitted only when the count for its key is below *its* limit, so a request with a low limit may keep waiting while others with a higher limit are served.

### `routes`

`RouteRule[]`, default `[]`.

```ts
interface RouteRule {
  path: string | RegExp;
  methods?: string | string[]; // omit, '*' or 'all' for every method
}
```

When the list is non-empty only matching requests are limited; the rest call `next()` immediately and get no headers. When it is empty every request that reaches the middleware is limited.

Path forms:

| Form | Example | Matches |
|---|---|---|
| exact | `'/api/items'` | `/api/items`, `/api/items/`, `/api/items?x=1`, `/API/ITEMS` |
| param | `'/users/:id'` | exactly one segment in place of `:id` |
| wildcard | `'/api/*'` | anything under `/api/`, any depth; not `/api` itself |
| RegExp | `/^\/v\d+\//` | tested against the normalised path |

The path compared is `req.baseUrl + req.path` when Express populated them, so rules inside a router mounted at `/api` are written with the `/api` prefix. Plain Node requests use `req.url` without the query string. Trailing slashes are ignored on both sides. Methods are compared upper-case. Several rules for the same exact path are merged.

`routes` are compiled once; exact paths live in a `Map`, patterns in a short array that is only scanned when the exact lookup misses.

### `caseSensitive`

`boolean`, default `false`. When `false`, paths and rules are lower-cased before comparison, which matches Express's default router behaviour.

### `keyGenerator`

`(req, res) => string | number | Promise<string | number>`, default a constant key.

Return a stable identifier such as `req.ip`, a user id or a tenant id. Non-string results are stringified. Keep the cardinality bounded: the `MemoryStore` deletes keys when their count drops to zero, so memory use tracks the number of keys currently in flight, not the number ever seen. Errors and rejections are forwarded to `next(err)`.

### `skip`

`(req, res) => boolean | Promise<boolean>`, default none.

Return `true` to let the request through uncounted and without headers. Runs after route matching and before `keyGenerator`/`max`. Errors are forwarded to `next(err)`.

### `queue`

`false | true | { maxSize?: number, timeout?: number }`, default `false`.

| Field | Default | Meaning |
|---|---|---|
| `maxSize` | `100` | Waiting requests allowed per key; beyond that requests are rejected with reason `queue-full`. `Infinity` is accepted. |
| `timeout` | `10000` | Milliseconds a request may wait before rejection with reason `queue-timeout`. `0` waits indefinitely. |

Queues are per key and strictly FIFO: a new request that arrives while others are already waiting for the same key joins the back of the queue even if a slot is momentarily free. When a slot is released the oldest waiter is offered it. A waiter whose client disconnects is removed without taking a slot. If an asynchronous store confirms a slot for a waiter that has already timed out or disconnected, the slot is released again and offered to the next waiter.

Rejected waiters go through the same `headers`, `onLimitReached` and `handler` path as immediate rejections, with `info.reason` telling them apart.

### `statusCode`

`number` 400-599, default `429`.

### `message`

`string | object | (req, res, info) => string | object | Promise<string | object>`, default `'Too many requests, please try again later.'`.

Body of the default rejection response. Strings are sent as `text/plain; charset=utf-8`; anything else is serialised with `JSON.stringify` and sent as `application/json; charset=utf-8`. Functions may return a promise. Ignored when `handler` is set.

### `retryAfter`

`number | false`, default `1`. Seconds to advertise in `Retry-After` on rejection, rounded up to an integer. `false` or `0` omits the header. Only sent when `headers` is `true`.

### `headers`

`boolean | 'draft-8'`, default `true`.

- `true`: `X-Concurrency-Limit` (the limit), `X-Concurrency-Remaining` (free slots after this request, `0` on rejection) and, on rejection, `Retry-After`.
- `'draft-8'`: the IETF RateLimit fields instead, using the `concurrent-requests` quota unit: `RateLimit-Policy: "concurrency";q=<limit>;qu="concurrent-requests"` and `RateLimit: "concurrency";r=<remaining>` with `;t=<retryAfter>` appended on rejection, plus `Retry-After`.
- `false`: nothing.

Headers are never written once `res.headersSent` is true.

### `legacyHeaders`

`boolean`, default `false`. Additionally send the 0.x pair `X-RequestLimit-Limit` (the limit) and `X-RequestLimit-Usage` (in-flight count before this request on admission, the limit on rejection).

### `handler`

`(req, res, next, info) => unknown`, default built-in response.

Called for every rejection after headers are set and `onLimitReached` has run. Must end the response or call `next()`; calling `next()` admits the request *without* counting it. Thrown errors go to `next(err)`.

### `onLimitReached`

`(req, res, info) => void`. Observer for rejections, called before `handler`. Intended for metrics and logging; thrown errors go to `next(err)` and the handler is skipped.

### `onQueued`

`(req, res, { key, limit, queueSize }) => void`. Observer for requests entering the queue; `queueSize` is the request's 1-based position. A thrown error removes the request from the queue and goes to `next(err)`.

### `store`

`Store`, default `new MemoryStore()`. See [stores.md](stores.md). Validation only checks that `acquire` and `release` are functions.

### `passOnStoreError`

`boolean`, default `false`. When the store throws or rejects during `acquire`:

- `false`: the error is passed to `next(err)` (fail closed).
- `true`: the request is admitted uncounted and without headers (fail open).

Errors during `release` are swallowed in both modes because the response is already complete.

### `requestPropertyName`

`string | false`, default `'requestLimit'`. On admission the limiter sets `req[requestPropertyName] = { key, limit, current, remaining }` where `current` includes the request itself and `remaining` is `limit - current` floored at 0. `false` disables it.

### Deprecated 0.x options

| 0.x | 1.x | Notes |
|---|---|---|
| `maxRequests` | `max` | `max` wins when both are present. |
| `routesList` | `routes` | |
| `RouteRule.method` | `RouteRule.methods` | |
| `global: false` | omit `routes` | Emits a `DeprecationWarning` (`EXPRESS_REQUEST_LIMITER_GLOBAL`) and ignores `routes`, as 0.x did. `global: true` is ignored. |

## `info` object

Passed to `handler`, `onLimitReached` and `message` functions.

```ts
interface LimitInfo {
  key: string;
  limit: number;
  reason: 'limit' | 'queue-full' | 'queue-timeout';
  queueSize?: number; // only when queueing is enabled: waiters for this key at rejection time
}
```

## Middleware properties

| Property | Description |
|---|---|
| `limiter.store` | The store instance. |
| `limiter.options` | Frozen, validated options with defaults applied. |
| `limiter.resetKey(key)` | Calls `store.resetKey(key)` if the store has it. In-flight requests for that key later release harmlessly. |
| `limiter.resetAll()` | Calls `store.resetAll()` if available. |
| `limiter.getQueueSize(key?)` | Waiting requests for `key`, or in total when omitted. Always `0` without queueing. |

## Behavioural guarantees

- A slot is released exactly once per admitted request, on whichever of `finish` or `close` fires first.
- A limiter instance mounted more than once in a request's path counts that request once (the request remembers the last instance that counted it).
- Rejected requests never consume a slot.
- Every user-supplied function (`max`, `keyGenerator`, `skip`, `message`, `handler`, `onLimitReached`, `onQueued`) is wrapped: synchronous throws and promise rejections are forwarded to `next(err)`.
- Option validation happens at construction, never on the request path.

## Named exports

- `requestLimiter` / `RequestLimiter`: the factory (also the default export; in CommonJS `require()` itself returns it).
- `MemoryStore`: the default store class.
- `compileRoutes(routes, caseSensitive?)`: returns `(method, path) => boolean`, or `null` for an empty list. Useful for testing rules or reusing the matching semantics.
- Types: `Options`, `ResolvedOptions`, `Middleware`, `Store`, `RouteRule`, `QueueOptions`, `LimitInfo`, `QueuedInfo`, `RequestLimitState`, `RejectReason`, `NextFunction`.
