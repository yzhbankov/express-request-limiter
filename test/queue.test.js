import supertest from 'supertest';
import requestLimiter from '../src/index';
import { createApp, createGate, fire, listen, sleep, waitUntil, AsyncStore } from './helpers';

describe('queueing', () => {
  test('excess requests wait and are admitted in FIFO order as slots free up', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1, queue: true });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });

    const [first] = fire(app, '/slow', { headers: { 'x-id': '1' } });
    await gate.waitFor(1);
    const [second] = fire(app, '/slow', { headers: { 'x-id': '2' } });
    await waitUntil(() => limiter.getQueueSize() === 1);
    const [third] = fire(app, '/slow', { headers: { 'x-id': '3' } });
    await waitUntil(() => limiter.getQueueSize() === 2);
    expect(limiter.getQueueSize('global')).toBe(2);
    expect(gate.pending).toHaveLength(1);

    gate.release(0);
    expect((await first).text).toBe('1');
    await gate.waitFor(1);
    expect(gate.pending[0].req.headers['x-id']).toBe('2');
    expect(limiter.getQueueSize()).toBe(1);

    gate.release(0);
    expect((await second).text).toBe('2');
    await gate.waitFor(1);
    expect(gate.pending[0].req.headers['x-id']).toBe('3');
    expect(limiter.getQueueSize()).toBe(0);

    gate.release(0);
    expect((await third).text).toBe('3');
    await sleep(0);
    expect(limiter.store.get('global')).toBe(0);
  });

  test('queued requests time out with reason queue-timeout', async () => {
    const gate = createGate();
    const infos = [];
    const limiter = requestLimiter({
      max: 1,
      queue: { timeout: 40 },
      handler: (req, res, next, info) => {
        infos.push(info);
        res.statusCode = 429;
        res.end('timeout');
      },
    });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const timedOut = await supertest(app).get('/slow');
    expect(timedOut.status).toBe(429);
    expect(timedOut.text).toBe('timeout');
    expect(infos).toEqual([{ key: 'global', limit: 1, reason: 'queue-timeout', queueSize: 0 }]);
    expect(limiter.getQueueSize()).toBe(0);
    gate.releaseAll();
    await first;
  });

  test('a full queue rejects with reason queue-full and the current queue size', async () => {
    const gate = createGate();
    const infos = [];
    const limiter = requestLimiter({
      max: 1,
      queue: { maxSize: 1, timeout: 0 },
      onLimitReached: (req, res, info) => infos.push(info),
    });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const [second] = fire(app, '/slow');
    await waitUntil(() => limiter.getQueueSize() === 1);
    const third = await supertest(app).get('/slow');
    expect(third.status).toBe(429);
    expect(infos).toEqual([{ key: 'global', limit: 1, reason: 'queue-full', queueSize: 1 }]);
    gate.release(0);
    await first;
    await gate.waitFor(1);
    gate.release(0);
    await second;
  });

  test('timeout: 0 waits indefinitely', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1, queue: { timeout: 0 } });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const [second] = fire(app, '/slow');
    await waitUntil(() => limiter.getQueueSize() === 1);
    await sleep(60);
    expect(limiter.getQueueSize()).toBe(1);
    gate.release(0);
    await first;
    await gate.waitFor(1);
    gate.release(0);
    expect((await second).status).toBe(200);
  });

  test('a client that disconnects while queued is dropped without taking a slot', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1, queue: { timeout: 0 } });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const srv = await listen(app);
    try {
      const held = srv.rawRequest('/slow');
      await gate.waitFor(1);
      const queued = srv.rawRequest('/slow');
      await waitUntil(() => limiter.getQueueSize() === 1);
      queued.req.destroy();
      await waitUntil(() => limiter.getQueueSize() === 0);

      gate.release(0);
      expect((await held.done).status).toBe(200);
      await sleep(0);
      expect(limiter.store.get('global')).toBe(0);
    } finally {
      await srv.close();
    }
  });

  test('onQueued fires with the queue position', async () => {
    const gate = createGate();
    const queued = [];
    const limiter = requestLimiter({ max: 1, queue: true, onQueued: (req, res, info) => queued.push(info) });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const rest = fire(app, '/slow', { count: 2 });
    await waitUntil(() => limiter.getQueueSize() === 2);
    expect(queued).toEqual([
      { key: 'global', limit: 1, queueSize: 1 },
      { key: 'global', limit: 1, queueSize: 2 },
    ]);
    gate.release(0);
    await first;
    for (const p of rest) {
      await gate.waitFor(1);
      gate.release(0);
      await p;
    }
  });

  test('an onQueued error removes the waiter and reaches the error handler', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1, queue: true, onQueued: () => { throw new Error('q-boom'); } });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const res = await supertest(app).get('/slow');
    expect(res.text).toBe('error: q-boom');
    expect(limiter.getQueueSize()).toBe(0);
    gate.releaseAll();
    await first;
  });

  test('queues are per key', async () => {
    const gate = createGate();
    const limiter = requestLimiter({ max: 1, queue: true, keyGenerator: (req) => req.headers['x-user'] });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [a1] = fire(app, '/slow', { headers: { 'x-user': 'a', 'x-id': 'a1' } });
    const [b1] = fire(app, '/slow', { headers: { 'x-user': 'b', 'x-id': 'b1' } });
    await gate.waitFor(2);
    const [a2] = fire(app, '/slow', { headers: { 'x-user': 'a', 'x-id': 'a2' } });
    await waitUntil(() => limiter.getQueueSize('a') === 1);
    expect(limiter.getQueueSize('b')).toBe(0);
    expect(limiter.getQueueSize()).toBe(1);

    const bIndex = gate.pending.findIndex((e) => e.req.headers['x-user'] === 'b');
    gate.release(bIndex);
    await b1;
    await sleep(10);
    expect(limiter.getQueueSize('a')).toBe(1);

    gate.release(0);
    await a1;
    await gate.waitFor(1);
    gate.release(0);
    expect((await a2).text).toBe('a2');
  });

  test('new arrivals join behind existing waiters even if a slot opens asynchronously', async () => {
    const gate = createGate();
    const store = new AsyncStore({ latency: 5 });
    const limiter = requestLimiter({ max: 1, queue: true, store });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow', { headers: { 'x-id': '1' } });
    await gate.waitFor(1);
    const [second] = fire(app, '/slow', { headers: { 'x-id': '2' } });
    await waitUntil(() => limiter.getQueueSize() === 1);

    // Free the slot; the async release/acquire is in flight when a third request arrives.
    gate.release(0);
    await first;
    const [third] = fire(app, '/slow', { headers: { 'x-id': '3' } });

    await gate.waitFor(1);
    expect(gate.pending[0].req.headers['x-id']).toBe('2');
    gate.release(0);
    expect((await second).text).toBe('2');
    await gate.waitFor(1);
    expect(gate.pending[0].req.headers['x-id']).toBe('3');
    gate.release(0);
    expect((await third).text).toBe('3');
    await waitUntil(() => store.get('global') === 0);
  });

  test.each(['async', 'sync'])('a slot acquired for a waiter that already left is returned (%s release)', async (mode) => {
    const gate = createGate();
    // A store whose acquire() can be held open so the test controls when it resolves.
    const store = {
      counts: new Map(),
      hold: false,
      pending: [],
      releases: 0,
      acquire(key, limit) {
        return new Promise((resolve) => {
          const run = () => {
            const current = this.counts.get(key) || 0;
            if (current >= limit) {
              return resolve(false);
            }
            this.counts.set(key, current + 1);
            return resolve(current + 1);
          };
          if (this.hold) {
            this.pending.push(run);
          } else {
            run();
          }
        });
      },
      release(key) {
        this.releases += 1;
        this.counts.set(key, Math.max(0, (this.counts.get(key) || 0) - 1));
        return mode === 'async' ? Promise.resolve(this.counts.get(key)) : this.counts.get(key);
      },
      get(key) {
        return this.counts.get(key) || 0;
      },
    };
    const limiter = requestLimiter({ max: 1, queue: { timeout: 20 }, store });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const [second] = fire(app, '/slow');
    await waitUntil(() => limiter.getQueueSize() === 1);

    // Free the slot while holding the re-acquire for the waiter open...
    store.hold = true;
    gate.release(0);
    await first;
    await waitUntil(() => store.pending.length === 1);
    // ...so the waiter times out while its acquire is still in flight.
    expect((await second).status).toBe(429);
    expect(limiter.getQueueSize()).toBe(0);

    // Now the acquire resolves for a waiter that is gone: the slot must be handed back.
    store.pending.shift()();
    await waitUntil(() => store.get('global') === 0);
    expect(store.releases).toBe(2);
  });

  test('a waiter with a lower per-request limit stays queued until enough slots free up', async () => {
    const gate = createGate();
    const limiter = requestLimiter({
      max: (req) => Number(req.headers['x-max']),
      queue: { timeout: 0 },
    });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const wide = fire(app, '/slow', { count: 2, headers: { 'x-max': '2' } });
    await gate.waitFor(2);
    const [narrow] = fire(app, '/slow', { headers: { 'x-max': '1', 'x-id': 'narrow' } });
    await waitUntil(() => limiter.getQueueSize() === 1);

    gate.release(0);
    await wide[0];
    await sleep(10);
    // One slot is free but the waiter only tolerates one in-flight request, so it keeps waiting.
    expect(limiter.getQueueSize()).toBe(1);
    expect(limiter.store.get('global')).toBe(1);

    gate.release(0);
    await wide[1];
    await gate.waitFor(1);
    expect(gate.pending[0].req.headers['x-id']).toBe('narrow');
    gate.release(0);
    expect((await narrow).text).toBe('narrow');
  });

  test('store errors while draining reach the waiting request', async () => {
    const gate = createGate();
    const store = new AsyncStore();
    const limiter = requestLimiter({ max: 1, queue: true, store });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const [second] = fire(app, '/slow');
    await waitUntil(() => limiter.getQueueSize() === 1);
    store.failAcquire = new Error('redis down');
    gate.release(0);
    await first;
    expect((await second).text).toBe('error: redis down');
    expect(limiter.getQueueSize()).toBe(0);
  });

  test('a synchronous store error while draining reaches the waiting request', async () => {
    const gate = createGate();
    const store = { counts: 0, acquire(key, limit) { if (this.counts >= limit) { return false; } this.counts += 1; return this.counts; }, release() { this.counts -= 1; return this.counts; } };
    const limiter = requestLimiter({ max: 1, queue: true, store });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/slow', gate.handler);
    });
    const [first] = fire(app, '/slow');
    await gate.waitFor(1);
    const [second] = fire(app, '/slow');
    await waitUntil(() => limiter.getQueueSize() === 1);
    store.acquire = () => { throw new Error('sync down'); };
    gate.release(0);
    await first;
    expect((await second).text).toBe('error: sync down');
  });
});
