/**
 * Compile-time checks for the public types. Run with `npm run typecheck`.
 * Lines marked @ts-expect-error must fail to compile.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import requestLimiter, { MemoryStore, compileRoutes, RequestLimiter } from '../../src/index';
import type { LimitInfo, Middleware, Options, Store, RouteRule } from '../../src/index';

// ---- Express 5 ---------------------------------------------------------------
const app = express();
app.use(requestLimiter({ max: 10 }));
app.use('/api', requestLimiter({ max: 2, queue: true }));
app.get('/jobs', requestLimiter({ max: 1, keyGenerator: (req) => req.ip ?? 'unknown' }), (req, res) => {
  const current: number | undefined = req.requestLimit?.remaining; // typed through the global Express augmentation
  res.json({ current });
});
const typed = requestLimiter<express.Request, express.Response>({
  max: (req) => (req.query.fast ? 1 : 5),
  skip: (req) => req.get('x-internal') === '1',
  handler: (req, res, next, info) => (info.reason === 'limit' ? res.status(503).json(info) : next()),
});
app.use(typed);

// Minimal Express-like shapes to prove generics accept subtypes.
interface AppRequest extends IncomingMessage {
  path: string;
  baseUrl: string;
  user?: { id: string; tier: 'free' | 'gold' };
}
interface AppResponse extends ServerResponse {
  status(code: number): this;
  json(body: unknown): this;
}

const routes: RouteRule[] = [
  { path: '/api/items', methods: ['GET', 'POST'] },
  { path: '/users/:id', methods: 'DELETE' },
  { path: /^\/reports/ },
  { path: '/legacy', method: 'GET' },
];

const limiter: Middleware<AppRequest, AppResponse> = requestLimiter<AppRequest, AppResponse>({
  max: (req) => (req.user?.tier === 'gold' ? 20 : 5),
  routes,
  caseSensitive: true,
  keyGenerator: (req) => req.user?.id ?? req.socket.remoteAddress ?? 'anonymous',
  skip: async (req) => req.headers['x-internal'] === '1',
  headers: true,
  legacyHeaders: false,
  statusCode: 503,
  message: (req, res, info) => ({ error: 'busy', key: info.key, reason: info.reason }),
  retryAfter: 2,
  handler: (req, res, next, info) => {
    const reason: LimitInfo['reason'] = info.reason;
    if (reason === 'queue-timeout') {
      return next();
    }
    res.status(503).json({ queued: info.queueSize ?? 0 });
    return undefined;
  },
  onLimitReached: (req, res, info) => void info.limit,
  onQueued: (req, res, info) => void info.queueSize,
  queue: { maxSize: 50, timeout: 2000 },
  requestPropertyName: 'concurrency',
  passOnStoreError: true,
});

limiter({} as AppRequest, {} as AppResponse, () => {});
const size: number = limiter.getQueueSize();
const keyed: number = limiter.getQueueSize('k');
void size;
void keyed;
limiter.resetKey('k');
limiter.resetAll();
const max: number | ((req: AppRequest, res: AppResponse) => number | Promise<number>) = limiter.options.max;
void max;

// Defaults and shorthand forms.
const plain = requestLimiter();
plain({} as IncomingMessage, {} as ServerResponse, (err?: unknown) => void err);
requestLimiter({ keyGenerator: (req) => req.ip ?? req.get?.('x-forwarded-for') ?? 'anonymous' }); // Express fields are optional on the default request type
requestLimiter({ queue: true, retryAfter: false, requestPropertyName: false, message: 'Busy', headers: 'draft-8' });
requestLimiter({ message: async () => ({ error: 'busy' }) });
const legacy = RequestLimiter({ maxRequests: 10, routesList: [{ path: '/a', method: 'GET' }], global: true });
void legacy;

// Stores.
const memory = new MemoryStore();
const acquired: number | false = memory.acquire('k', 3);
const released: number = memory.release('k');
const snapshot: Record<string, number> = memory.snapshot();
void acquired;
void released;
void snapshot;

class RedisLikeStore implements Store {
  async acquire(key: string, limit: number): Promise<number | false> {
    return limit > 0 ? 1 : false;
  }
  async release(key: string): Promise<number> {
    return key.length ? 0 : 0;
  }
}
requestLimiter({ store: new RedisLikeStore() });

const matcher = compileRoutes(routes);
if (matcher !== null) {
  const hit: boolean = matcher('GET', '/api/items');
  void hit;
}

const partial: Options = { max: 1 };
void partial;

// ---- Negative cases ------------------------------------------------------

// @ts-expect-error max must be a number or a function
requestLimiter({ max: 'ten' });

// @ts-expect-error unknown options are rejected
requestLimiter({ maximum: 10 });

// @ts-expect-error statusCode must be a number
requestLimiter({ statusCode: '429' });

// @ts-expect-error routes entries need a path
requestLimiter({ routes: [{ methods: ['GET'] }] });

// @ts-expect-error a store must implement release
requestLimiter({ store: { acquire: () => 1 } });

// @ts-expect-error queue options are typed
requestLimiter({ queue: { size: 1 } });
