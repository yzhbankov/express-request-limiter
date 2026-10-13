# Concurrency limiting vs. rate limiting in Node.js and Express

Two different protections that are easy to confuse:

- A **rate limiter** caps requests *per time window*: "no more than 600 requests per minute". It answers *how often*.
- A **concurrency limiter** caps requests *in flight at the same time*: "no more than 25 requests being processed at once". It answers *how many right now*.

express-request-limiter is a concurrency limiter. A rate limiter such as
[express-rate-limit](https://www.npmjs.com/package/express-rate-limit) solves
the other problem, and the two stack well together.

## Why a rate limit alone doesn't protect your server

A rate limit of 600 requests/minute happily admits all 600 in the first
second. If each request holds a database connection for 10 seconds, you now
have 600 concurrent queries against a pool of 20 — the pool is exhausted, every
other endpoint stalls, and memory grows with each parked request. The rate was
respected; the server still fell over.

The inverse is also true: a concurrency limit of 25 lets a client make
millions of fast requests per hour, as long as only 25 run at once. If your
concern is quota or abuse over time, you want a rate limiter.

| Symptom | What you need |
|---|---|
| Database pool exhausted, `TimeoutError: ResourceRequest timed out` | Concurrency limit |
| CPU-heavy endpoint (PDF render, image resize) makes the whole app unresponsive | Concurrency limit |
| Slow upstream API causes requests to pile up and memory to climb | Concurrency limit (with a queue) |
| One tenant's burst starves the others | Concurrency limit per tenant key |
| A client hammers your API thousands of times per hour | Rate limit |
| Enforcing a plan quota ("1000 calls/day") | Rate limit |
| Brute-force login attempts | Rate limit (per IP/account) |
| All of the above on one public API | Both, stacked |

## How to limit concurrent requests in Express

```js
import express from 'express';
import requestLimiter from 'express-request-limiter';

const app = express();

// Never more than 20 requests in flight; the rest get 429 + Retry-After.
app.use(requestLimiter({ max: 20 }));

// Or queue instead of rejecting: wait up to 15 s for a slot.
app.use('/render', requestLimiter({ max: 4, queue: { maxSize: 100, timeout: 15000 } }));

// Or per user/IP, so one heavy client can't occupy every slot.
app.use(requestLimiter({ max: 4, keyGenerator: (req) => req.user?.id ?? req.ip }));
```

This is the **bulkhead pattern**: partition capacity so one overloaded
dependency or one greedy client can't sink everything else. With `queue`
enabled it becomes **backpressure**: excess requests wait their turn (FIFO,
bounded, with a timeout) instead of failing or piling up unboundedly.

## Using both together

```js
import rateLimit from 'express-rate-limit';
import requestLimiter from 'express-request-limiter';

app.use(rateLimit({ windowMs: 60_000, limit: 600 })); // not too many per minute
app.use(requestLimiter({ max: 25 }));                 // not too many at once
```

The rate limiter handles sustained abuse and quotas; the concurrency limiter
handles bursts and slow requests. They share no state and compose cleanly —
option names (`keyGenerator`, `skip`, `handler`, `message`, `statusCode`,
`store`) are deliberately aligned, so moving between them feels familiar.

## Sizing the limit

- **Database-bound routes:** pool size minus headroom for background jobs
  (`max: POOL_SIZE - 2`).
- **CPU-bound routes:** roughly the number of cores available to the process,
  often less.
- **Slow upstreams:** whatever the upstream can take; use `queue` so short
  bursts smooth out instead of failing.
- **Unknown:** start generous, watch the `X-Concurrency-Remaining` response
  header or `req.requestLimit` in your logs, and tighten.

`max` can be a function, so the limit can follow event-loop lag, tenant plan,
or anything else per request — see [recipes](recipes.md).

## Related terms

Load shedding, backpressure, bulkhead isolation, overload protection,
in-flight request limiting, request queueing, `429 Too Many Requests`,
`Retry-After`. If you searched for any of these for an Express, Connect, or
plain `node:http` server, this package is built for that case:
[README](../README.md) · [API reference](api.md) · [recipes](recipes.md) ·
[Redis / multi-process stores](stores.md).
