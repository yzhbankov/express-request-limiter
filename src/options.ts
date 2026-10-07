import type { IncomingMessage, ServerResponse } from 'node:http';
import { MemoryStore } from './memory-store';
import type { Options, QueueOptions, ResolvedOptions, Store } from './types';

export const DEFAULT_MESSAGE = 'Too many requests, please try again later.';
export const DEFAULT_QUEUE: Readonly<Required<QueueOptions>> = Object.freeze({ maxSize: 100, timeout: 10000 });
const OPTIONS: readonly string[] = ['max', 'routes', 'caseSensitive', 'keyGenerator', 'skip', 'headers', 'legacyHeaders', 'statusCode', 'message', 'retryAfter', 'handler', 'onLimitReached', 'onQueued', 'queue', 'store', 'requestPropertyName', 'passOnStoreError'];
const LEGACY_OPTIONS: readonly string[] = ['maxRequests', 'routesList', 'global'];
const FLAGS = ['caseSensitive', 'legacyHeaders', 'passOnStoreError'] as const;
const CALLBACKS = ['keyGenerator', 'skip', 'handler', 'onLimitReached', 'onQueued'] as const;

let warnedGlobal = false;

function fail(message: string): never {
  throw new TypeError(`express-request-limiter: ${message}`);
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function normalizeQueue(queue: unknown): Readonly<Required<QueueOptions>> | null {
  if (!queue) return null;
  if (queue === true) return DEFAULT_QUEUE;
  if (typeof queue !== 'object') fail('queue must be false, true or an object like { maxSize, timeout }');
  const maxSize = (queue as QueueOptions).maxSize ?? DEFAULT_QUEUE.maxSize;
  const timeout = (queue as QueueOptions).timeout ?? DEFAULT_QUEUE.timeout;
  if (!(Number.isInteger(maxSize) && maxSize > 0) && maxSize !== Infinity) fail('queue.maxSize must be a positive integer or Infinity');
  if (!isCount(timeout)) fail('queue.timeout must be a number of milliseconds >= 0 (0 disables the timeout)');
  return Object.freeze({ maxSize, timeout });
}

/** Validate options and apply defaults. Throws a descriptive TypeError so misconfiguration fails at startup, not on the first request. */
export function normalizeOptions<Req extends IncomingMessage, Res extends ServerResponse>(input?: Options<Req, Res> | null): ResolvedOptions<Req, Res> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object') fail('options must be an object');
  for (const key of Object.keys(o)) {
    if (!OPTIONS.includes(key) && !LEGACY_OPTIONS.includes(key)) fail(`unknown option "${key}". Known options: ${OPTIONS.join(', ')}`);
  }
  for (const flag of FLAGS) if (o[flag] !== undefined && typeof o[flag] !== 'boolean') fail(`${flag} must be a boolean`);
  for (const name of CALLBACKS) if (o[name] != null && typeof o[name] !== 'function') fail(`${name} must be a function`);

  const max = o.max ?? o.maxRequests ?? 100;
  if (typeof max !== 'function' && !isCount(max)) fail('max must be a finite number >= 0 or a function (req, res) => number');

  let routes = o.routes ?? o.routesList ?? [];
  if (!Array.isArray(routes)) fail('routes must be an array of { path, methods }');
  if (o.global === false && routes.length) {
    // 0.x: `global: false` meant "ignore routesList and limit everything"
    if (!warnedGlobal) process.emitWarning('The "global" option is deprecated. Omit "routes" to limit every request, or list routes to limit only those.', { code: 'EXPRESS_REQUEST_LIMITER_GLOBAL', type: 'DeprecationWarning' });
    warnedGlobal = true;
    routes = [];
  }

  const headers = o.headers ?? true;
  if (typeof headers !== 'boolean' && headers !== 'draft-8') fail("headers must be a boolean or 'draft-8'");

  const statusCode = o.statusCode ?? 429;
  if (!(Number.isInteger(statusCode) && (statusCode as number) >= 400 && (statusCode as number) <= 599)) fail('statusCode must be an integer between 400 and 599');

  const message = o.message ?? DEFAULT_MESSAGE;
  if (!['string', 'object', 'function'].includes(typeof message)) fail('message must be a string, a JSON-serialisable object or a function (req, res, info) => string | object');

  const retryAfter = o.retryAfter ?? 1;
  if (retryAfter !== false && !isCount(retryAfter)) fail('retryAfter must be a number of seconds >= 0, or false to omit the Retry-After header');

  const requestPropertyName = o.requestPropertyName ?? 'requestLimit';
  if (requestPropertyName !== false && !(typeof requestPropertyName === 'string' && requestPropertyName)) fail('requestPropertyName must be a non-empty string or false');

  const store = (o.store ?? new MemoryStore()) as Store;
  if (typeof store.acquire !== 'function' || typeof store.release !== 'function') fail('store must implement acquire(key, limit) and release(key)');

  return {
    max,
    routes,
    statusCode,
    message,
    store,
    caseSensitive: o.caseSensitive === true,
    keyGenerator: o.keyGenerator ?? null,
    skip: o.skip ?? null,
    handler: o.handler ?? null,
    onLimitReached: o.onLimitReached ?? null,
    onQueued: o.onQueued ?? null,
    headers,
    legacyHeaders: o.legacyHeaders === true,
    retryAfter: retryAfter || 0,
    queue: normalizeQueue(o.queue),
    requestPropertyName: requestPropertyName || null,
    passOnStoreError: o.passOnStoreError === true,
  } as ResolvedOptions<Req, Res>;
}
