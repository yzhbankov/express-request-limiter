import supertest from 'supertest';
import requestLimiter from '../src/index';
import { createApp, createGate, fire, sleep, waitUntil, AsyncStore } from './helpers';

describe('promise-based stores', () => {
  test('admission, rejection and release all work with async acquire/release', async () => {
    const gate = createGate();
    const store = new AsyncStore({ latency: 2 });
    const limiter = requestLimiter({ max: 1, store });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    expect(store.get('global')).toBe(1);
    const rejected = await supertest(app).get('/slow');
    expect(rejected.status).toBe(429);
    expect(rejected.headers['x-concurrency-limit']).toBe('1');
    gate.releaseAll();
    expect((await first).status).toBe(200);
    await waitUntil(() => store.get('global') === 0);
  });

  test('acquire rejections fail closed by default', async () => {
    const store = new AsyncStore();
    store.failAcquire = new Error('store offline');
    const app = createApp((app) => {
      app.use(requestLimiter({ store }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.status).toBe(500);
    expect(res.text).toBe('error: store offline');
  });

  test('passOnStoreError lets requests through uncounted when the store fails', async () => {
    const store = new AsyncStore();
    store.failAcquire = new Error('store offline');
    const app = createApp((app) => {
      app.use(requestLimiter({ store, passOnStoreError: true }));
      app.get('/', (req, res) => res.end('ok'));
    });
    const res = await supertest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['x-concurrency-limit']).toBeUndefined();
  });

  test('synchronous acquire throws are handled the same way', async () => {
    const store = { acquire() { throw new Error('sync offline'); }, release() {} };
    const app = createApp((app) => {
      app.get('/closed', requestLimiter({ store }), (req, res) => res.end('ok'));
      app.get('/open', requestLimiter({ store, passOnStoreError: true }), (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/closed')).text).toBe('error: sync offline');
    expect((await supertest(app).get('/open')).status).toBe(200);
  });

  test('release failures are swallowed because the response is already complete', async () => {
    const asyncStore = new AsyncStore();
    asyncStore.failRelease = new Error('release failed');
    const syncStore = { n: 0, acquire() { this.n += 1; return this.n; }, release() { throw new Error('sync release failed'); } };
    const app = createApp((app) => {
      app.get('/async', requestLimiter({ store: asyncStore }), (req, res) => res.end('ok'));
      app.get('/sync', requestLimiter({ store: syncStore }), (req, res) => res.end('ok'));
      app.get('/async-queue', requestLimiter({ store: asyncStore, queue: true }), (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/async')).status).toBe(200);
    expect((await supertest(app).get('/sync')).status).toBe(200);
    expect((await supertest(app).get('/async-queue')).status).toBe(200);
    await sleep(0);
    await sleep(5);
  });

  test('resetKey and resetAll are no-ops for stores without reset support', () => {
    const store = { acquire() { return 1; }, release() { return 0; } };
    const limiter = requestLimiter({ store });
    expect(limiter.resetKey('x')).toBeUndefined();
    expect(limiter.resetAll()).toBeUndefined();
    expect(limiter.store).toBe(store);
  });

  test('resetKey and resetAll forward to stores that support them', async () => {
    const calls = [];
    const store = { acquire() { return 1; }, release() { return 0; }, resetKey: (k) => calls.push(['resetKey', k]), resetAll: () => calls.push(['resetAll']) };
    const limiter = requestLimiter({ store });
    limiter.resetKey('k');
    limiter.resetAll();
    expect(calls).toEqual([['resetKey', 'k'], ['resetAll']]);
  });
});
