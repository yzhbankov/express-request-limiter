import assert from 'node:assert/strict';
import requestLimiter, { MemoryStore, compileRoutes, requestLimiter as named, RequestLimiter } from 'express-request-limiter';

assert.equal(typeof requestLimiter, 'function');
assert.equal(named, requestLimiter);
assert.equal(RequestLimiter, requestLimiter);
assert.equal(typeof MemoryStore, 'function');
assert.equal(typeof compileRoutes, 'function');
const limiter = requestLimiter({ max: 1 });
assert.ok(limiter.store instanceof MemoryStore);
console.log('esm smoke ok');
