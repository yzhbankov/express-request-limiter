import { vi } from 'vitest';
import supertest from 'supertest';
import http from 'node:http';
import requestLimiter from '../src/index';
import { DEFAULT_MESSAGE } from '../src/options';
import { createApp, createGate, fire, listen, sleep, waitUntil, mockReq, mockRes } from './helpers';

describe('admission and release', () => {
  test('admits up to max concurrent requests and rejects the rest with 429', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 2 });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });

    const inFlight = fire(app, '/slow', { count: 2 });
    await gate.waitFor(2);
    expect(limiter.store.get('global')).toBe(2);

    const rejected = await supertest(app).get('/slow');
    expect(rejected.status).toBe(429);
    expect(rejected.text).toBe(DEFAULT_MESSAGE);
    expect(rejected.headers['content-type']).toMatch(/text\/plain/);
    expect(rejected.headers['x-concurrency-limit']).toBe('2');
    expect(rejected.headers['x-concurrency-remaining']).toBe('0');
    expect(rejected.headers['retry-after']).toBe('1');

    gate.releaseAll();
    const responses = await Promise.all(inFlight);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await sleep(0);
    expect(limiter.store.get('global')).toBe(0);
  });

  test('regression: finishing one response frees exactly one slot (no double release)', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 2 });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });

    const [first, second] = fire(app, '/slow', { count: 2 });
    await gate.waitFor(2);

    gate.release(0);
    await first;
    await sleep(0);
    expect(limiter.store.get('global')).toBe(1);

    // Only one slot is free, so one more request fits and the next is rejected.
    const [third] = fire(app, '/slow');
    await gate.waitFor(2);
    expect(limiter.store.get('global')).toBe(2);
    const fourth = await supertest(app).get('/slow');
    expect(fourth.status).toBe(429);

    gate.releaseAll();
    await Promise.all([second, third]);
    await sleep(0);
    expect(limiter.store.get('global')).toBe(0);
  });

  test('releases the slot when the client aborts mid-request', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1 });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const srv = await listen(app);
    try {
      const { req } = srv.rawRequest('/slow');
      await gate.waitFor(1);
      expect(limiter.store.get('global')).toBe(1);
      req.destroy();
      await waitUntil(() => limiter.store.get('global') === 0);
    } finally {
      await srv.close();
    }
  });

  test('a limiter mounted twice counts a request once', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1 });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', limiter, gate.handler);
    });
    const [p] = fire(app, '/slow');
    await gate.waitFor(1);
    expect(limiter.store.get('global')).toBe(1);
    gate.releaseAll();
    expect((await p).status).toBe(200);
    await sleep(0);
    expect(limiter.store.get('global')).toBe(0);
  });

  test('max: 0 rejects everything', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0 }));
      app.get('/', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/')).status).toBe(429);
  });
});

describe('headers', () => {
  test('reports limit and remaining on admitted responses', async () => {
    const gate = createGate();
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 3 }));
      app.get('/slow', gate.handler);
    });
    const [a, b] = fire(app, '/slow', { count: 2 });
    await gate.waitFor(2);
    gate.releaseAll();
    const remaining = (await Promise.all([a, b])).map((r) => r.headers['x-concurrency-remaining']).sort();
    expect(remaining).toEqual(['1', '2']);
    expect((await a).headers['x-concurrency-limit']).toBe('3');
    expect((await a).headers['retry-after']).toBeUndefined();
  });

  test('headers: false sends nothing extra', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, headers: false }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.status).toBe(429);
    expect(res.headers['x-concurrency-limit']).toBeUndefined();
    expect(res.headers['retry-after']).toBeUndefined();
  });

  test('retryAfter: false omits Retry-After; fractional values round up', async () => {
    const app = createApp((app) => {
      app.get('/none', requestLimiter({ max: 0, retryAfter: false }), (req, res) => res.end());
      app.get('/frac', requestLimiter({ max: 0, retryAfter: 2.2 }), (req, res) => res.end());
    });
    expect((await supertest(app).get('/none')).headers['retry-after']).toBeUndefined();
    expect((await supertest(app).get('/frac')).headers['retry-after']).toBe('3');
  });

  test("headers: 'draft-8' sends the IETF RateLimit fields instead of X-Concurrency-*", async () => {
    const gate = createGate();
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 2, headers: 'draft-8', retryAfter: 3 }));
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const [second] = fire(app, '/slow');
    await gate.waitFor(2);
    const rejected = await supertest(app).get('/slow');
    expect(rejected.status).toBe(429);
    expect(rejected.headers['ratelimit-policy']).toBe('"concurrency";q=2;qu="concurrent-requests"');
    expect(rejected.headers['ratelimit']).toBe('"concurrency";r=0;t=3');
    expect(rejected.headers['retry-after']).toBe('3');
    expect(rejected.headers['x-concurrency-limit']).toBeUndefined();
    gate.releaseAll();
    const admitted = (await Promise.all([first, second])).map((r) => r.headers['ratelimit']).sort();
    expect(admitted).toEqual(['"concurrency";r=0', '"concurrency";r=1']);
  });

  test('skips header writes when headers were already sent', () => {
    const limiter = requestLimiter({ max: 1 });
    const res = mockRes();
    res.headersSent = true;
    const next = vi.fn();
    limiter(mockReq(), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.headers).toEqual({});
  });
});

describe('route selection', () => {
  test('only listed routes and methods are limited; others pass through untouched', async () => {
    const limiter = requestLimiter({ max: 0, routes: [{ path: '/limited', methods: ['GET'] }] });
    const app = createApp((app) => {
      app.use(limiter);
      app.all('/limited', (req, res) => res.end('ok'));
      app.get('/free', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/limited')).status).toBe(429);
    expect((await supertest(app).post('/limited')).status).toBe(200);
    const free = await supertest(app).get('/free');
    expect(free.status).toBe(200);
    expect(free.headers['x-concurrency-limit']).toBeUndefined();
  });

  test('query strings and trailing slashes do not bypass the limiter', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, routes: [{ path: '/limited' }] }));
      app.get('/limited', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/limited?x=1')).status).toBe(429);
    expect((await supertest(app).get('/limited/')).status).toBe(429);
    expect((await supertest(app).get('/LIMITED')).status).toBe(429);
  });

  test('patterns and params are supported', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, routes: [{ path: '/users/:id', methods: ['DELETE'] }, { path: '/reports/*' }] }));
      app.use((req, res) => res.end('ok'));
    });
    expect((await supertest(app).delete('/users/7')).status).toBe(429);
    expect((await supertest(app).get('/users/7')).status).toBe(200);
    expect((await supertest(app).get('/reports/2024/q1')).status).toBe(429);
    expect((await supertest(app).get('/reports')).status).toBe(200);
  });

  test('matches against the full path inside a mounted router', async () => {
    const app = createApp((app, express) => {
      const router = express.Router();
      router.use(requestLimiter({ max: 0, routes: [{ path: '/api/items' }] }));
      router.get('/items', (req, res) => res.end('ok'));
      router.get('/other', (req, res) => res.end('ok'));
      app.use('/api', router);
    });
    expect((await supertest(app).get('/api/items')).status).toBe(429);
    expect((await supertest(app).get('/api/other')).status).toBe(200);
  });

  test('can be applied to a single route without a route list', async () => {
    const gate = createGate();
    const app = createApp((app) => {
      app.get('/a', requestLimiter({ max: 1 }), gate.handler);
      app.get('/b', (req, res) => res.end('ok'));
    });
    const [p] = fire(app, '/a');
    await gate.waitFor(1);
    expect((await supertest(app).get('/a')).status).toBe(429);
    expect((await supertest(app).get('/b')).status).toBe(200);
    gate.releaseAll();
    await p;
  });
});

describe('keys and dynamic limits', () => {
  test('keyGenerator isolates counters per key', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1, keyGenerator: (req) => req.headers['x-user'] });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [alice] = fire(app, '/slow', { headers: { 'x-user': 'alice' } });
    await gate.waitFor(1);
    expect((await supertest(app).get('/slow').set('x-user', 'alice')).status).toBe(429);
    const [bob] = fire(app, '/slow', { headers: { 'x-user': 'bob' } });
    await gate.waitFor(2);
    expect(limiter.store.snapshot()).toEqual({ alice: 1, bob: 1 });
    gate.releaseAll();
    await Promise.all([alice, bob]);
  });

  test('non-string keys are stringified', async () => {
    const limiter = requestLimiter({ max: 5, keyGenerator: () => 42 });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/', (req, res) => res.end(JSON.stringify(req.requestLimit)));
    });
    const res = await supertest(app).get('/');
    expect(JSON.parse(res.text)).toEqual({ key: '42', limit: 5, current: 1, remaining: 4 });
  });

  test('async keyGenerator and max are awaited', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ keyGenerator: async (req) => req.headers['x-user'], max: async () => 0 }));
      app.get('/', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/').set('x-user', 'a')).status).toBe(429);
  });

  test('max can depend on the request', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: (req) => (req.headers['x-tier'] === 'gold' ? 5 : 0) }));
      app.get('/', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/').set('x-tier', 'gold')).status).toBe(200);
    expect((await supertest(app).get('/')).status).toBe(429);
  });

  test('a max() that returns garbage becomes an error for the error handler', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: () => 'lots' }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.status).toBe(500);
    expect(res.text).toMatch(/max\(\) must return a number/);
  });

  test('errors thrown by keyGenerator go to next(err)', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ keyGenerator: () => { throw new Error('boom-key'); } }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.status).toBe(500);
    expect(res.text).toBe('error: boom-key');
  });

  test('rejected async keyGenerator goes to next(err)', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ keyGenerator: async () => { throw new Error('boom-async'); } }));
      app.get('/', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/')).text).toBe('error: boom-async');
  });
});

describe('skip', () => {
  test('sync skip bypasses limiting and headers', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, skip: (req) => req.headers['x-admin'] === '1' }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const skipped = await supertest(app).get('/').set('x-admin', '1');
    expect(skipped.status).toBe(200);
    expect(skipped.headers['x-concurrency-limit']).toBeUndefined();
    expect((await supertest(app).get('/')).status).toBe(429);
  });

  test('async skip is awaited', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, skip: async (req) => req.headers['x-admin'] === '1' }));
      app.get('/', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/').set('x-admin', '1')).status).toBe(200);
    expect((await supertest(app).get('/')).status).toBe(429);
  });

  test('skip errors go to next(err)', async () => {
    const app = createApp((app) => {
      app.get('/sync', requestLimiter({ skip: () => { throw new Error('skip-sync'); } }), (req, res) => res.end());
      app.get('/async', requestLimiter({ skip: async () => { throw new Error('skip-async'); } }), (req, res) => res.end());
    });
    expect((await supertest(app).get('/sync')).text).toBe('error: skip-sync');
    expect((await supertest(app).get('/async')).text).toBe('error: skip-async');
  });
});

describe('rejection response', () => {
  test('custom statusCode and string message', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, statusCode: 503, message: 'Busy' }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.status).toBe(503);
    expect(res.text).toBe('Busy');
  });

  test('object messages are sent as JSON', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, message: { error: 'busy', code: 'E_BUSY' } }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'busy', code: 'E_BUSY' });
  });

  test('message functions receive the request and limit info', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, message: (req, res, info) => ({ path: req.path, ...info }) }));
      app.get('/x', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/x');
    expect(res.body).toEqual({ path: '/x', key: 'global', limit: 0, reason: 'limit' });
  });

  test('message functions may be async', async () => {
    const app = createApp((app) => {
      app.get('/ok', requestLimiter({ max: 0, message: async (req, res, info) => ({ reason: info.reason }) }), (req, res) => res.end());
      app.get('/fail', requestLimiter({ max: 0, message: async () => { throw new Error('async-msg'); } }), (req, res) => res.end());
    });
    const ok = await supertest(app).get('/ok');
    expect(ok.status).toBe(429);
    expect(ok.body).toEqual({ reason: 'limit' });
    expect((await supertest(app).get('/fail')).text).toBe('error: async-msg');
  });

  test('message function errors go to next(err)', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, message: () => { throw new Error('msg-boom'); } }));
      app.get('/', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/')).text).toBe('error: msg-boom');
  });

  test('custom handler replaces the default response and receives info', async () => {
    const handler = vi.fn((req, res, next, info) => {
      res.statusCode = 418;
      res.end(info.reason);
    });
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, handler }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.status).toBe(418);
    expect(res.text).toBe('limit');
    expect(handler.mock.calls[0][3]).toEqual({ key: 'global', limit: 0, reason: 'limit' });
  });

  test('a handler may call next() to let the request through', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 0, handler: (req, res, next) => next() }));
      app.get('/', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/')).status).toBe(200);
  });

  test('handler and onLimitReached errors go to next(err)', async () => {
    const app = createApp((app) => {
      app.get('/h', requestLimiter({ max: 0, handler: () => { throw new Error('h-boom'); } }), (req, res) => res.end());
      app.get('/o', requestLimiter({ max: 0, onLimitReached: () => { throw new Error('o-boom'); } }), (req, res) => res.end());
    });
    expect((await supertest(app).get('/h')).text).toBe('error: h-boom');
    expect((await supertest(app).get('/o')).text).toBe('error: o-boom');
  });

  test('onLimitReached is called before the handler with the same info', async () => {
    const calls = [];
    const app = createApp((app) => {
      app.use(requestLimiter({
        max: 0,
        onLimitReached: (req, res, info) => calls.push(['hook', info]),
        handler: (req, res, next, info) => { calls.push(['handler', info]); res.end(); },
      }));
      app.get('/', (req, res) => res.end('ok'));
    });
    await supertest(app).get('/');
    expect(calls.map((c) => c[0])).toEqual(['hook', 'handler']);
    expect(calls[0][1]).toBe(calls[1][1]);
  });

  test('the default handler does nothing if headers were already sent', () => {
    const limiter = requestLimiter({ max: 0, headers: false });
    const res = mockRes();
    res.headersSent = true;
    const next = vi.fn();
    limiter(mockReq(), res, next);
    expect(res.body).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('request property', () => {
  test('exposes key, limit and current count on the request', async () => {
    const app = createApp((app) => {
      app.use(requestLimiter({ max: 4 }));
      app.get('/', (req, res) => res.end(JSON.stringify(req.requestLimit)));
    });
    expect(JSON.parse((await supertest(app).get('/')).text)).toEqual({ key: 'global', limit: 4, current: 1, remaining: 3 });
  });

  test('the property name is configurable and can be disabled', async () => {
    const app = createApp((app) => {
      app.get('/named', requestLimiter({ requestPropertyName: 'cc' }), (req, res) => res.end(String(req.cc.limit)));
      app.get('/off', requestLimiter({ requestPropertyName: false }), (req, res) => res.end(String(req.requestLimit)));
    });
    expect((await supertest(app).get('/named')).text).toBe('100');
    expect((await supertest(app).get('/off')).text).toBe('undefined');
  });
});

describe('administration', () => {
  test('resetKey and resetAll clear counters; later releases stay at zero', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1 });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [p] = fire(app, '/slow');
    await gate.waitFor(1);
    limiter.resetKey('global');
    expect(limiter.store.get('global')).toBe(0);
    const [p2] = fire(app, '/slow');
    await gate.waitFor(2);
    limiter.resetAll();
    expect(limiter.store.size).toBe(0);
    gate.releaseAll();
    await Promise.all([p, p2]);
    await sleep(0);
    expect(limiter.store.get('global')).toBe(0);
  });

  test('exposes frozen resolved options', () => {
    const limiter = requestLimiter({ max: 3, routes: [{ path: '/a' }] });
    expect(limiter.options.max).toBe(3);
    expect(Object.isFrozen(limiter.options)).toBe(true);
    expect(limiter.getQueueSize()).toBe(0);
    expect(limiter.getQueueSize('x')).toBe(0);
  });

  test('rejects bad options at construction time', () => {
    expect(() => requestLimiter({ max: -1 })).toThrow(TypeError);
    expect(() => requestLimiter({ bogus: true })).toThrow(/unknown option/);
  });
});

describe('framework independence', () => {
  test('works with a plain http.createServer handler', async () => {
    const limiter = requestLimiter({ max: 1, routes: [{ path: '/limited', methods: ['GET'] }] });
    let holdRes = null;
    const server = http.createServer((req, res) => {
      limiter(req, res, (err) => {
        if (err) {
          res.statusCode = 500;
          return res.end(err.message);
        }
        if (req.url.startsWith('/limited')) {
          holdRes = res;
          return undefined;
        }
        return res.end('free');
      });
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    const get = (path) => new Promise((resolve) => {
      http.get({ port, path }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
    });
    try {
      const first = get('/limited?x=1');
      await waitUntil(() => holdRes !== null);
      const second = await get('/limited');
      expect(second.status).toBe(429);
      expect(second.headers['x-concurrency-limit']).toBe('1');
      expect((await get('/free')).body).toBe('free');
      holdRes.end('ok');
      expect((await first).status).toBe(200);
      await sleep(0);
      expect(limiter.store.get('global')).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
