/**
 * Micro-benchmark of the middleware's own overhead, with mock request and
 * response objects so no network or Express routing is involved.
 *
 *   npm run build && node bench/middleware.bench.js [iterations]
 *
 * Each scenario reports nanoseconds per request and requests per second.
 * For an end-to-end HTTP benchmark see bench/README.md.
 */

import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import requestLimiter from 'express-request-limiter';

const ITERATIONS = Number(process.argv[2]) || 2_000_000;

function makeReq(method, url, headers = {}) {
  return { method, url, headers };
}

class MockRes extends EventEmitter {
  constructor() {
    super();
    this.headersSent = false;
    this.statusCode = 200;
    this.headers = {};
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  end() {
    this.headersSent = true;
    this.emit('finish');
    this.emit('close');
  }
}

function noop() {}

function run(name, fn, iterations = ITERATIONS) {
  // Warm up so V8 optimises before we measure.
  for (let i = 0; i < 50_000; i += 1) {
    fn();
  }
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  const elapsedMs = performance.now() - start;
  const nsPerOp = (elapsedMs * 1e6) / iterations;
  const opsPerSec = Math.round(iterations / (elapsedMs / 1000));
  console.log(`${name.padEnd(46)} ${nsPerOp.toFixed(0).padStart(6)} ns/req ${opsPerSec.toLocaleString('en-US').padStart(14)} req/s`);
  return { name, nsPerOp, opsPerSec };
}

console.log(`express-request-limiter micro-benchmark, ${ITERATIONS.toLocaleString('en-US')} iterations per scenario, node ${process.version}\n`);

{
  const limiter = requestLimiter({ max: 1000 });
  run('admit + release (global key, headers on)', () => {
    const res = new MockRes();
    limiter(makeReq('GET', '/api/items'), res, noop);
    res.end();
  });
}

{
  const limiter = requestLimiter({
    max: 1000,
    keyGenerator: (req) => req.headers['x-user'],
    routes: [{ path: '/api/items', methods: ['GET', 'POST'] }, { path: '/health' }],
  });
  const headers = { 'x-user': 'user-42' };
  run('admit + release (per-key, exact route match)', () => {
    const res = new MockRes();
    limiter(makeReq('GET', '/api/items?page=2', headers), res, noop);
    res.end();
  });
}

{
  const limiter = requestLimiter({ max: 1000, routes: [{ path: '/users/:id/orders/*', methods: ['GET'] }] });
  run('admit + release (pattern route match)', () => {
    const res = new MockRes();
    limiter(makeReq('GET', '/users/42/orders/2024/01'), res, noop);
    res.end();
  });
}

{
  const limiter = requestLimiter({ max: 1000, routes: [{ path: '/api/items' }] });
  run('pass-through (route not limited)', () => {
    limiter(makeReq('GET', '/static/app.js'), new MockRes(), noop);
  });
}

{
  const limiter = requestLimiter({ max: 0 });
  run('reject with default 429 response', () => {
    limiter(makeReq('GET', '/api/items'), new MockRes(), noop);
  });
}

{
  const limiter = requestLimiter({ max: 1000, queue: true });
  run('admit + release (queue enabled, never queued)', () => {
    const res = new MockRes();
    limiter(makeReq('GET', '/api/items'), res, noop);
    res.end();
  });
}

{
  const baseline = () => {
    const res = new MockRes();
    res.end();
  };
  run('baseline: mock res create + end only', baseline);
}
