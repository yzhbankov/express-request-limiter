import { vi } from 'vitest';
import { normalizeOptions, DEFAULT_MESSAGE, DEFAULT_QUEUE } from '../src/options';
import { MemoryStore } from '../src/memory-store';

describe('normalizeOptions', () => {
  test('fills in defaults', () => {
    const o = normalizeOptions();
    expect(o.max).toBe(100);
    expect(o.routes).toEqual([]);
    expect(o.caseSensitive).toBe(false);
    expect(o.keyGenerator).toBeNull();
    expect(o.skip).toBeNull();
    expect(o.headers).toBe(true);
    expect(o.legacyHeaders).toBe(false);
    expect(o.statusCode).toBe(429);
    expect(o.message).toBe(DEFAULT_MESSAGE);
    expect(o.retryAfter).toBe(1);
    expect(o.handler).toBeNull();
    expect(o.onLimitReached).toBeNull();
    expect(o.onQueued).toBeNull();
    expect(o.queue).toBeNull();
    expect(o.store).toBeInstanceOf(MemoryStore);
    expect(o.requestPropertyName).toBe('requestLimit');
    expect(o.passOnStoreError).toBe(false);
  });

  test('null and undefined mean "use the default", for the whole object and for each option', () => {
    expect(normalizeOptions({ max: null, message: null }).max).toBe(100);
    expect(normalizeOptions(null).max).toBe(100);
    expect(normalizeOptions(undefined).max).toBe(100);
  });

  test('rejects unknown options to catch typos', () => {
    expect(() => normalizeOptions({ maxRequest: 1 })).toThrow(/unknown option "maxRequest"/);
    expect(() => normalizeOptions({ maxRequest: 1 })).toThrow(/Known options: max, routes/);
  });

  test('rejects non-object input', () => {
    expect(() => normalizeOptions(5)).toThrow(/options must be an object/);
  });

  describe('max', () => {
    test.each([-1, NaN, Infinity, '10'])('rejects %p', (max) => {
      expect(() => normalizeOptions({ max })).toThrow(/max must be/);
    });
    test('accepts zero and functions', () => {
      expect(normalizeOptions({ max: 0 }).max).toBe(0);
      const fn = () => 1;
      expect(normalizeOptions({ max: fn }).max).toBe(fn);
    });
    test('prefers max over the legacy maxRequests', () => {
      expect(normalizeOptions({ maxRequests: 5 }).max).toBe(5);
      expect(normalizeOptions({ max: 7, maxRequests: 5 }).max).toBe(7);
    });
  });

  describe('routes', () => {
    test('rejects non-arrays', () => {
      expect(() => normalizeOptions({ routes: {} })).toThrow(/routes must be an array/);
    });
    test('accepts the legacy routesList', () => {
      const routes = [{ path: '/a', method: 'GET' }];
      expect(normalizeOptions({ routesList: routes }).routes).toBe(routes);
    });
    test('legacy global:false drops the route list and warns once', () => {
      const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
      const o1 = normalizeOptions({ global: false, routesList: [{ path: '/a' }] });
      const o2 = normalizeOptions({ global: false, routes: [{ path: '/a' }] });
      expect(o1.routes).toEqual([]);
      expect(o2.routes).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatch(/"global" option is deprecated/);
      spy.mockRestore();
    });
    test('global:true keeps routes and is otherwise ignored', () => {
      const o = normalizeOptions({ global: true, routes: [{ path: '/a' }] });
      expect(o.routes).toHaveLength(1);
    });
  });

  describe('statusCode', () => {
    test.each([200, 399, 600, 429.5, '429'])('rejects %p', (statusCode) => {
      expect(() => normalizeOptions({ statusCode })).toThrow(/statusCode must be an integer between 400 and 599/);
    });
    test('accepts 4xx and 5xx', () => {
      expect(normalizeOptions({ statusCode: 503 }).statusCode).toBe(503);
    });
  });

  describe('message', () => {
    test('accepts strings, objects and functions', () => {
      expect(normalizeOptions({ message: 'x' }).message).toBe('x');
      expect(normalizeOptions({ message: { error: 'x' } }).message).toEqual({ error: 'x' });
      const fn = () => 'x';
      expect(normalizeOptions({ message: fn }).message).toBe(fn);
    });
    test.each([42, true])('rejects %p', (message) => {
      expect(() => normalizeOptions({ message })).toThrow(/message must be/);
    });
  });

  describe('retryAfter', () => {
    test('false disables the header', () => {
      expect(normalizeOptions({ retryAfter: false }).retryAfter).toBe(0);
    });
    test('accepts non-negative numbers', () => {
      expect(normalizeOptions({ retryAfter: 2.5 }).retryAfter).toBe(2.5);
      expect(normalizeOptions({ retryAfter: 0 }).retryAfter).toBe(0);
    });
    test.each([-1, '1', true, NaN])('rejects %p', (retryAfter) => {
      expect(() => normalizeOptions({ retryAfter })).toThrow(/retryAfter must be/);
    });
  });

  describe('requestPropertyName', () => {
    test('false disables the request property; null means default', () => {
      expect(normalizeOptions({ requestPropertyName: false }).requestPropertyName).toBeNull();
      expect(normalizeOptions({ requestPropertyName: null }).requestPropertyName).toBe('requestLimit');
    });
    test('accepts a custom name', () => {
      expect(normalizeOptions({ requestPropertyName: 'limits' }).requestPropertyName).toBe('limits');
    });
    test.each(['', 5, true])('rejects %p', (requestPropertyName) => {
      expect(() => normalizeOptions({ requestPropertyName })).toThrow(/requestPropertyName must be/);
    });
  });

  describe('boolean flags', () => {
    test.each(['caseSensitive', 'legacyHeaders', 'passOnStoreError'])('%s must be boolean', (flag) => {
      expect(() => normalizeOptions({ [flag]: 'yes' })).toThrow(new RegExp(`${flag} must be a boolean`));
      expect(normalizeOptions({ [flag]: true })[flag]).toBe(true);
      expect(normalizeOptions({ [flag]: false })[flag]).toBe(false);
    });
  });

  describe('headers', () => {
    test('accepts booleans and the IETF draft name', () => {
      expect(normalizeOptions().headers).toBe(true);
      expect(normalizeOptions({ headers: false }).headers).toBe(false);
      expect(normalizeOptions({ headers: 'draft-8' }).headers).toBe('draft-8');
    });
    test.each(['yes', 'draft-7', 1])('rejects %p', (headers) => {
      expect(() => normalizeOptions({ headers })).toThrow(/headers must be a boolean or 'draft-8'/);
    });
  });

  describe('function options', () => {
    test.each(['keyGenerator', 'skip', 'handler', 'onLimitReached', 'onQueued'])('%s must be a function', (name) => {
      expect(() => normalizeOptions({ [name]: 'nope' })).toThrow(new RegExp(`${name} must be a function`));
      const fn = () => {};
      expect(normalizeOptions({ [name]: fn })[name]).toBe(fn);
      expect(normalizeOptions({ [name]: null })[name]).toBeNull();
    });
  });

  describe('queue', () => {
    test('false, null and undefined disable queueing', () => {
      expect(normalizeOptions({ queue: false }).queue).toBeNull();
      expect(normalizeOptions({ queue: null }).queue).toBeNull();
    });
    test('true applies the defaults', () => {
      expect(normalizeOptions({ queue: true }).queue).toEqual(DEFAULT_QUEUE);
    });
    test('partial objects are filled in', () => {
      expect(normalizeOptions({ queue: { maxSize: 5 } }).queue).toEqual({ maxSize: 5, timeout: DEFAULT_QUEUE.timeout });
      expect(normalizeOptions({ queue: { timeout: 0 } }).queue).toEqual({ maxSize: DEFAULT_QUEUE.maxSize, timeout: 0 });
      expect(normalizeOptions({ queue: { maxSize: Infinity } }).queue.maxSize).toBe(Infinity);
    });
    test('rejects bad shapes', () => {
      expect(() => normalizeOptions({ queue: 'yes' })).toThrow(/queue must be/);
      expect(() => normalizeOptions({ queue: { maxSize: 0 } })).toThrow(/queue\.maxSize/);
      expect(() => normalizeOptions({ queue: { maxSize: 1.5 } })).toThrow(/queue\.maxSize/);
      expect(() => normalizeOptions({ queue: { timeout: -1 } })).toThrow(/queue\.timeout/);
    });
  });

  describe('store', () => {
    test('requires acquire and release', () => {
      expect(() => normalizeOptions({ store: {} })).toThrow(/store must implement acquire/);
      expect(() => normalizeOptions({ store: { acquire() {} } })).toThrow(/store must implement acquire/);
    });
    test('accepts any object with the contract', () => {
      const store = { acquire() {}, release() {} };
      expect(normalizeOptions({ store }).store).toBe(store);
    });
  });
});
