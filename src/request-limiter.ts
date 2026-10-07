import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeOptions } from './options';
import { compileRoutes, getRequestPath } from './routes';
import type { DefaultRequest, LimitInfo, MaybePromise, Middleware, NextFunction, Options, RejectReason } from './types';

const DEFAULT_KEY = 'global';
const seen = Symbol('express-request-limiter'); // set on a request to the instance that counted it, so mounting one instance twice counts once

function noop(): void {}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as PromiseLike<unknown>).then === 'function';
}

/** Call `fn`; pass its result (awaited if it is a promise) to `onOk`, or the error to `onErr`. Stays synchronous when it can. */
function attempt<T>(fn: () => MaybePromise<T>, onOk: (value: T) => unknown, onErr: (err: unknown) => unknown): unknown {
  let value: MaybePromise<T>;
  try {
    value = fn();
  } catch (err) {
    return onErr(err);
  }
  return isThenable(value) ? value.then(onOk, onErr) : onOk(value);
}

/** Create a concurrency-limiting `(req, res, next)` middleware for Express 4/5, Connect or plain `http`. */
export function requestLimiter<Req extends IncomingMessage = DefaultRequest, Res extends ServerResponse = ServerResponse>(
  userOptions?: Options<Req, Res> | null,
): Middleware<Req, Res> {
  interface Waiter {
    req: Req;
    res: Res;
    next: NextFunction;
    key: string;
    limit: number;
    done: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    onClose: () => void;
  }

  const options = normalizeOptions(userOptions);
  const { store, headers, legacyHeaders, statusCode, message, skip, keyGenerator, onLimitReached, onQueued, requestPropertyName, passOnStoreError, queue } = options;
  const match = compileRoutes(options.routes, options.caseSensitive);
  const maxFn = typeof options.max === 'function' ? options.max : null;
  const handler = options.handler ?? defaultHandler;
  const retryAfter = options.retryAfter > 0 ? String(Math.ceil(options.retryAfter)) : null;
  const queues = queue && new Map<string, Waiter[]>(); // key -> FIFO of waiters; a key is present only while its queue is non-empty
  const standard = headers === 'draft-8';

  function middleware(req: Req, res: Res, next: NextFunction): unknown {
    if ((match && !match(req.method ?? '', getRequestPath(req))) || (req as unknown as Record<symbol, unknown>)[seen] === middleware) return next();
    if (skip) return attempt(() => skip(req, res), (skipped) => (skipped ? next() : enter(req, res, next)), next);
    return enter(req, res, next);
  }

  function enter(req: Req, res: Res, next: NextFunction): unknown {
    let key: MaybePromise<string | number> = DEFAULT_KEY;
    let limit: MaybePromise<number> = options.max as number;
    try {
      if (keyGenerator) key = keyGenerator(req, res);
      if (maxFn) limit = maxFn(req, res);
    } catch (err) {
      return next(err);
    }
    if (isThenable(key) || isThenable(limit)) return Promise.all([key, limit]).then(([k, l]) => acquire(req, res, next, k, l), next);
    return acquire(req, res, next, key, limit);
  }

  function acquire(req: Req, res: Res, next: NextFunction, rawKey: string | number, limit: number): unknown {
    const key = typeof rawKey === 'string' ? rawKey : String(rawKey);
    if (typeof limit !== 'number' || !(limit >= 0)) return next(new TypeError('express-request-limiter: max() must return a number >= 0'));
    (req as unknown as Record<symbol, unknown>)[seen] = middleware;
    if (queues && queues.has(key)) return enqueue(req, res, next, key, limit); // others are already waiting: stay in order
    let count: MaybePromise<number | false>;
    try {
      count = store.acquire(key, limit);
    } catch (err) {
      return storeError(err, req, res, next);
    }
    if (isThenable(count)) return count.then((c) => acquired(req, res, next, key, limit, c), (err) => storeError(err, req, res, next));
    return acquired(req, res, next, key, limit, count);
  }

  function acquired(req: Req, res: Res, next: NextFunction, key: string, limit: number, count: number | false): unknown {
    if (count !== false) return admit(req, res, next, key, limit, count);
    return queues ? enqueue(req, res, next, key, limit) : reject(req, res, next, key, limit, 'limit');
  }

  function admit(req: Req, res: Res, next: NextFunction, key: string, limit: number, count: number): unknown {
    const remaining = limit > count ? limit - count : 0;
    setHeaders(res, limit, remaining, count - 1);
    if (requestPropertyName) (req as unknown as Record<string, unknown>)[requestPropertyName] = { key, limit, current: count, remaining };
    let live = true;
    const release = () => {
      if (!live) return;
      live = false;
      onDone(key);
    };
    res.on('finish', release); // Node emits both for a normal response and 'close' alone on abort;
    res.on('close', release); // whichever comes first releases exactly once
    return next();
  }

  function onDone(key: string): void {
    let result: MaybePromise<number | void>;
    try {
      result = store.release(key);
    } catch {
      return; // the response is over; nobody is left to tell
    }
    if (!queues) {
      if (isThenable(result)) result.then(noop, noop);
    } else if (isThenable(result)) {
      result.then(() => drain(key), noop);
    } else {
      drain(key);
    }
  }

  function setHeaders(res: Res, limit: number, remaining: number, usage: number, retry?: string | null): void {
    if (!headers || res.headersSent) return;
    if (standard) {
      res.setHeader('RateLimit-Policy', `"concurrency";q=${limit};qu="concurrent-requests"`);
      res.setHeader('RateLimit', `"concurrency";r=${remaining}${retry ? `;t=${retry}` : ''}`);
    } else {
      res.setHeader('X-Concurrency-Limit', limit);
      res.setHeader('X-Concurrency-Remaining', remaining);
    }
    if (legacyHeaders) {
      res.setHeader('X-RequestLimit-Limit', limit);
      res.setHeader('X-RequestLimit-Usage', usage);
    }
    if (retry) res.setHeader('Retry-After', retry);
  }

  function reject(req: Req, res: Res, next: NextFunction, key: string, limit: number, reason: RejectReason): unknown {
    const info: LimitInfo = { key, limit, reason };
    if (queues) info.queueSize = getQueueSize(key);
    setHeaders(res, limit, 0, limit, retryAfter);
    try {
      if (onLimitReached) onLimitReached(req, res, info);
      return handler(req, res, next, info);
    } catch (err) {
      return next(err);
    }
  }

  function defaultHandler(req: Req, res: Res, next: NextFunction, info: LimitInfo): unknown {
    if (res.headersSent) return;
    const body = typeof message === 'function' ? message(req, res, info) : message;
    return isThenable(body) ? body.then((b) => send(res, b as string | object), next) : send(res, body);
  }

  function send(res: Res, body: string | object): void {
    if (res.headersSent) return;
    const text = typeof body === 'string';
    res.statusCode = statusCode;
    res.setHeader('Content-Type', text ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
    res.end(text ? body : JSON.stringify(body));
  }

  function storeError(err: unknown, req: Req, res: Res, next: NextFunction): void {
    return passOnStoreError ? next() : next(err);
  }

  function enqueue(req: Req, res: Res, next: NextFunction, key: string, limit: number): unknown {
    const q = queues!.get(key) || [];
    if (q.length >= queue!.maxSize) return reject(req, res, next, key, limit, 'queue-full');
    const waiter: Waiter = { req, res, next, key, limit, done: false, timer: null, onClose: () => removeWaiter(waiter) };
    if (queue!.timeout > 0) {
      waiter.timer = setTimeout(() => {
        removeWaiter(waiter);
        reject(req, res, next, key, limit, 'queue-timeout');
      }, queue!.timeout);
    }
    res.on('close', waiter.onClose); // client gave up while waiting
    queues!.set(key, q);
    q.push(waiter);
    if (onQueued) {
      try {
        onQueued(req, res, { key, limit, queueSize: q.length });
      } catch (err) {
        removeWaiter(waiter);
        return next(err);
      }
    }
  }

  function removeWaiter(waiter: Waiter): void {
    if (waiter.done) return;
    waiter.done = true;
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.res.removeListener('close', waiter.onClose);
    const q = queues!.get(waiter.key)!;
    q.splice(q.indexOf(waiter), 1);
    if (!q.length) queues!.delete(waiter.key);
  }

  /** After a release: offer the slot to the oldest waiter for `key`. */
  function drain(key: string): void {
    const q = queues!.get(key);
    if (!q) return;
    const waiter = q[0];
    attempt(() => store.acquire(key, waiter.limit), (count) => {
      if (count === false) return; // still full; the waiter keeps its place
      if (waiter.done) return attempt(() => store.release(key), () => drain(key), noop); // it left while we were acquiring: hand the slot on
      removeWaiter(waiter);
      admit(waiter.req, waiter.res, waiter.next, key, waiter.limit, count);
    }, (err) => {
      removeWaiter(waiter);
      storeError(err, waiter.req, waiter.res, waiter.next);
    });
  }

  function getQueueSize(key?: string): number {
    if (!queues) return 0;
    if (key !== undefined) return (queues.get(key) || []).length;
    let total = 0;
    for (const q of queues.values()) total += q.length;
    return total;
  }

  return Object.assign(middleware, {
    store,
    options: Object.freeze(options),
    resetKey: (key: string) => store.resetKey?.(key),
    resetAll: () => store.resetAll?.(),
    getQueueSize,
  }) as Middleware<Req, Res>;
}
