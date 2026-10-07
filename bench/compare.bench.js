/**
 * Per-request overhead of this library next to express-rate-limit, the most
 * used Express limiter, on identical mock request/response objects. The two
 * solve different problems (concurrent vs. per-window limits), so this only
 * shows what each costs on the admit path.
 *
 *   npm run build && node bench/compare.bench.js [iterations]
 */

import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { rateLimit } from 'express-rate-limit';
import requestLimiter from 'express-request-limiter';

const ITERATIONS = Number(process.argv[2]) || 500_000;

class MockRes extends EventEmitter {
  headersSent = false;
  statusCode = 200;
  headers = {};
  setHeader(name, value) {
    this.headers[name] = value;
  }
  getHeader(name) {
    return this.headers[name];
  }
  end() {
    this.headersSent = true;
    this.emit('finish');
    this.emit('close');
  }
}

const makeReq = () => ({ method: 'GET', url: '/api/items', ip: '203.0.113.7', headers: {}, app: { get: () => false } });
const noop = () => {};

async function run(name, fn) {
  for (let i = 0; i < 20_000; i += 1) await fn();
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) await fn();
  const ns = ((performance.now() - start) * 1e6) / ITERATIONS;
  console.log(`${name.padEnd(58)} ${ns.toFixed(0).padStart(5)} ns/req`);
}

console.log(`${ITERATIONS.toLocaleString('en-US')} iterations per scenario, node ${process.version}\n`);

const ours = requestLimiter({ max: 1e9 });
const oursPerIp = requestLimiter({ max: 1e9, keyGenerator: (req) => req.ip });
const oursDraft = requestLimiter({ max: 1e9, keyGenerator: (req) => req.ip, headers: 'draft-8' });
const erl = rateLimit({ windowMs: 60_000, limit: 1e9, validate: false, standardHeaders: 'draft-7', legacyHeaders: false });
const erlDraft8 = rateLimit({ windowMs: 60_000, limit: 1e9, validate: false, standardHeaders: 'draft-8', legacyHeaders: false });
const erlNoHeaders = rateLimit({ windowMs: 60_000, limit: 1e9, validate: false, standardHeaders: false, legacyHeaders: false });

await run('express-request-limiter, global key', () => {
  const res = new MockRes();
  ours(makeReq(), res, noop);
  res.end();
});
await run('express-request-limiter, per-IP key', () => {
  const res = new MockRes();
  oursPerIp(makeReq(), res, noop);
  res.end();
});
await run('express-request-limiter, per-IP key, draft-8 headers', () => {
  const res = new MockRes();
  oursDraft(makeReq(), res, noop);
  res.end();
});
await run('express-rate-limit, per-IP key, draft-7 headers (default)', async () => {
  const res = new MockRes();
  await erl(makeReq(), res, noop);
  res.end();
});
await run('express-rate-limit, per-IP key, draft-8 headers', async () => {
  const res = new MockRes();
  await erlDraft8(makeReq(), res, noop);
  res.end();
});
await run('express-rate-limit, per-IP key, no headers', async () => {
  const res = new MockRes();
  await erlNoHeaders(makeReq(), res, noop);
  res.end();
});
await run('baseline: mock req/res create + end', () => {
  const res = new MockRes();
  makeReq();
  res.end();
});
process.exit(0); // express-rate-limit's MemoryStore keeps an interval alive
