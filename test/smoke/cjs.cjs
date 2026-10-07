const assert = require('node:assert/strict');
const requestLimiter = require('express-request-limiter');
const { MemoryStore, compileRoutes } = require('express-request-limiter');

assert.equal(typeof requestLimiter, 'function', 'require() returns the factory itself');
assert.equal(requestLimiter.default, requestLimiter);
assert.equal(requestLimiter.requestLimiter, requestLimiter);
assert.equal(requestLimiter.RequestLimiter, requestLimiter);
assert.equal(typeof MemoryStore, 'function');
assert.equal(typeof compileRoutes, 'function');
const limiter = requestLimiter({ max: 1 });
assert.ok(limiter.store instanceof MemoryStore);
console.log('cjs smoke ok');
