import type { IncomingMessage, ServerResponse } from 'node:http';

export type MaybePromise<T> = T | Promise<T>;

/** Express-style request fields that callbacks often read. All optional, so plain Node requests still fit. */
export interface ExpressRequestLike {
  ip?: string;
  path?: string;
  baseUrl?: string;
  originalUrl?: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  get?(name: string): string | undefined;
}

/** Default request type: Node's `IncomingMessage` plus optional Express fields. Pass Express's `Request` explicitly for full typing. */
export type DefaultRequest = IncomingMessage & ExpressRequestLike;

/** Express/Connect-style continuation. */
export type NextFunction = (err?: unknown) => void;

/** Why a request was rejected. */
export type RejectReason =
  /** The limit was reached and queueing is off. */
  | 'limit'
  /** Queueing is on but the queue for this key is already full. */
  | 'queue-full'
  /** The request waited in the queue for longer than `queue.timeout`. */
  | 'queue-timeout';

/** Passed to `handler`, `onLimitReached` and `message` functions. */
export interface LimitInfo {
  /** The key the request was counted under (`'global'` unless `keyGenerator` is set). */
  key: string;
  /** The limit that applied to this request. */
  limit: number;
  reason: RejectReason;
  /** Requests waiting for this key. Present only when queueing is enabled. */
  queueSize?: number;
}

/** Passed to `onQueued`. */
export interface QueuedInfo {
  key: string;
  limit: number;
  /** Position of this request in the queue, 1-based. */
  queueSize: number;
}

/** Attached to the request as `req[requestPropertyName]` on admission. */
export interface RequestLimitState {
  key: string;
  limit: number;
  /** In-flight count for the key, including this request. */
  current: number;
  /** Free slots left for the key after this request. */
  remaining: number;
}

export interface RouteRule {
  /**
   * Exact path (`'/api/items'`), Express-style pattern (`'/users/:id'`, `'/api/*'`) or RegExp.
   * Trailing slashes are ignored; matching is case-insensitive unless `caseSensitive` is set.
   */
  path: string | RegExp;
  /** HTTP methods, any case. Omit, or use `'*'`/`'all'`, to match every method. */
  methods?: string | readonly string[];
  /** @deprecated Use `methods`. */
  method?: string;
}

export interface QueueOptions {
  /** Maximum waiting requests per key before new ones are rejected. Default 100. */
  maxSize?: number;
  /** Milliseconds a request may wait before being rejected. 0 waits forever. Default 10000. */
  timeout?: number;
}

/**
 * Storage contract. `MemoryStore` is the synchronous default; implement this
 * (optionally returning promises) to share counts across processes, e.g. with Redis.
 */
export interface Store {
  /** Reserve one slot for `key` if fewer than `limit` are in use. Returns the new count, or `false` at the limit. */
  acquire(key: string, limit: number): MaybePromise<number | false>;
  /** Free one slot for `key`. Must tolerate unknown keys. */
  release(key: string): MaybePromise<number | void>;
  get?(key: string): MaybePromise<number>;
  /** Used by `middleware.resetKey()`. */
  resetKey?(key: string): MaybePromise<void>;
  /** Used by `middleware.resetAll()`. */
  resetAll?(): MaybePromise<void>;
}

export interface Options<Req extends IncomingMessage = DefaultRequest, Res extends ServerResponse = ServerResponse> {
  /** Maximum concurrent requests per key, or a function returning it per request. Default 100. `0` rejects everything. */
  max?: number | ((req: Req, res: Res) => MaybePromise<number>);
  /** Limit only requests matching one of these rules. Omit or leave empty to limit every request. */
  routes?: readonly RouteRule[];
  /** Match route paths case-sensitively. Default false (like Express). */
  caseSensitive?: boolean;
  /** Group requests into independent counters, e.g. by IP or user id. Default: one shared counter. */
  keyGenerator?: (req: Req, res: Res) => MaybePromise<string | number>;
  /** Return true to let a request through without counting it. */
  skip?: (req: Req, res: Res) => MaybePromise<boolean>;
  /**
   * `true`: send `X-Concurrency-Limit`, `X-Concurrency-Remaining` and, on rejection, `Retry-After`.
   * `'draft-8'`: send the IETF RateLimit header fields instead (`RateLimit-Policy`, `RateLimit`, `Retry-After`).
   * `false`: send nothing. Default true.
   */
  headers?: boolean | 'draft-8';
  /** Also send the 0.x `X-RequestLimit-Limit` / `X-RequestLimit-Usage` headers. Default false. */
  legacyHeaders?: boolean;
  /** Status code for rejected requests, 400-599. Default 429. */
  statusCode?: number;
  /** Body for rejected requests: strings as text/plain, objects as JSON, or a (possibly async) function returning either. */
  message?: string | object | ((req: Req, res: Res, info: LimitInfo) => MaybePromise<string | object>);
  /** Seconds for the `Retry-After` header on rejections; `false` omits it. Default 1. */
  retryAfter?: number | false;
  /** Replace the default rejection response. Headers are already set. Call `next()` to let the request through. */
  handler?: (req: Req, res: Res, next: NextFunction, info: LimitInfo) => unknown;
  /** Observe rejections (metrics, logging). Runs before `handler`. */
  onLimitReached?: (req: Req, res: Res, info: LimitInfo) => void;
  /** Observe requests entering the queue. */
  onQueued?: (req: Req, res: Res, info: QueuedInfo) => void;
  /** Hold excess requests in a per-key FIFO queue until a slot frees up. `true` uses the defaults. */
  queue?: boolean | QueueOptions;
  /** Custom store. Default: a new `MemoryStore`. */
  store?: Store;
  /** Request property that receives `RequestLimitState`; `false` disables it. Default `'requestLimit'`. */
  requestPropertyName?: string | false;
  /** On store errors, admit the request (`true`) or pass the error to `next` (`false`). Default false. */
  passOnStoreError?: boolean;

  /** @deprecated Use `max`. */
  maxRequests?: number;
  /** @deprecated Use `routes`. */
  routesList?: readonly RouteRule[];
  /** @deprecated Omit `routes` to limit every request. `false` ignores `routes`. */
  global?: boolean;
}

type Callbacks = 'keyGenerator' | 'skip' | 'handler' | 'onLimitReached' | 'onQueued';

/** Options after validation and defaulting (`middleware.options`). Unset callbacks are `null`. */
export type ResolvedOptions<Req extends IncomingMessage = DefaultRequest, Res extends ServerResponse = ServerResponse> = Readonly<{
  [K in Exclude<keyof Options<Req, Res>, 'maxRequests' | 'routesList' | 'global'>]-?: K extends 'queue'
    ? Readonly<Required<QueueOptions>> | null
    : K extends 'retryAfter'
      ? number
      : K extends 'requestPropertyName'
        ? string | null
        : K extends Callbacks
          ? Exclude<Options<Req, Res>[K], undefined> | null
          : Exclude<Options<Req, Res>[K], undefined>;
}>;

export interface Middleware<Req extends IncomingMessage = DefaultRequest, Res extends ServerResponse = ServerResponse> {
  (req: Req, res: Res, next: NextFunction): void;
  /** The store in use. */
  readonly store: Store;
  /** Frozen, validated options. */
  readonly options: ResolvedOptions<Req, Res>;
  /** Forget the count for one key. In-flight requests for it release harmlessly. */
  resetKey(key: string): MaybePromise<void> | undefined;
  /** Forget every count. */
  resetAll(): MaybePromise<void> | undefined;
  /** Requests waiting for `key`, or for every key when omitted. Always 0 without queueing. */
  getQueueSize(key?: string): number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by express-request-limiter on admitted requests (unless `requestPropertyName` is changed). */
      requestLimit?: RequestLimitState;
    }
  }
}
