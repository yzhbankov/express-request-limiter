import { EventEmitter } from 'node:events';
import http from 'node:http';
import supertest from 'supertest';

/** Express 5 by default; CI also runs the suite with EXPRESS_VERSION=4. */
const { default: express } = await import(process.env.EXPRESS_VERSION === '4' ? 'express4' : 'express');

/**
 * Build an Express app. `setup(app, express)` registers middleware and routes.
 * Every app gets a terminal error handler that surfaces the error message so
 * tests can assert on it.
 */
export function createApp(setup) {
  const app = express();
  setup(app, express);
  app.use((err, req, res, _next) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`error: ${err.message}`);
  });
  return app;
}

/**
 * A route handler that parks responses until the test releases them. This is
 * how tests create "in-flight" requests deterministically.
 */
export function createGate() {
  const pending = [];
  const gate = {
    pending,
    handler(req, res) {
      pending.push({ req, res });
    },
    waitFor(n) {
      return waitUntil(() => pending.length >= n, `${n} requests to reach the gate`);
    },
    release(index = 0, body) {
      const [entry] = pending.splice(index, 1);
      if (!entry) {
        throw new Error(`gate: nothing pending at index ${index}`);
      }
      entry.res.statusCode = 200;
      entry.res.end(body === undefined ? entry.req.headers['x-id'] || 'ok' : body);
    },
    releaseAll() {
      while (pending.length > 0) {
        gate.release(0);
      }
    },
  };
  return gate;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until `predicate()` is true; fails after `timeoutMs`. */
export async function waitUntil(predicate, what = 'condition', timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

/** Fire `count` concurrent requests and return their supertest promises. */
export function fire(app, path, { method = 'get', count = 1, headers = {} } = {}) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    let req = supertest(app)[method](path);
    for (const [k, v] of Object.entries(headers)) {
      req = req.set(k, v);
    }
    // superagent requests are lazy; resolving the thenable starts them now.
    out.push(Promise.resolve(req));
  }
  return out;
}

/**
 * Start a real server and open a raw HTTP request that the test can abort.
 * Returns helpers plus a `close()` to tear the server down.
 */
export function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        rawRequest(path, headers = {}) {
          const req = http.request({ port, path, method: 'GET', headers });
          const done = new Promise((res) => {
            req.on('response', (response) => {
              let body = '';
              response.setEncoding('utf8');
              response.on('data', (chunk) => {
                body += chunk;
              });
              response.on('end', () => res({ status: response.statusCode, headers: response.headers, body }));
            });
            req.on('error', (err) => res({ error: err }));
          });
          req.end();
          return { req, done };
        },
        close() {
          return new Promise((res) => server.close(res));
        },
      });
    });
  });
}

/** Minimal request object for unit tests that bypass HTTP. */
export function mockReq({ method = 'GET', url = '/', path, baseUrl, headers = {} } = {}) {
  return { method, url, path, baseUrl, headers };
}

/** Minimal response object: records headers, emits 'finish' and 'close' on end(). */
export function mockRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = String(value);
  };
  res.getHeader = (name) => res.headers[name.toLowerCase()];
  res.end = (body) => {
    res.body = body;
    res.headersSent = true;
    res.emit('finish');
    res.emit('close');
  };
  return res;
}

/**
 * A promise-based store whose operations the test can delay. `latency` adds a
 * macrotask hop so ordering edge cases are observable.
 */
export class AsyncStore {
  constructor({ latency = 0 } = {}) {
    this.counts = new Map();
    this.latency = latency;
    this.calls = [];
    this.failAcquire = null;
    this.failRelease = null;
  }
  defer(fn) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(fn());
        } catch (err) {
          reject(err);
        }
      }, this.latency);
    });
  }
  acquire(key, limit) {
    this.calls.push(['acquire', key]);
    return this.defer(() => {
      if (this.failAcquire) {
        throw this.failAcquire;
      }
      const current = this.counts.get(key) || 0;
      if (current >= limit) {
        return false;
      }
      this.counts.set(key, current + 1);
      return current + 1;
    });
  }
  release(key) {
    this.calls.push(['release', key]);
    return this.defer(() => {
      if (this.failRelease) {
        throw this.failRelease;
      }
      const current = this.counts.get(key) || 0;
      this.counts.set(key, Math.max(0, current - 1));
      return this.counts.get(key);
    });
  }
  get(key) {
    return this.counts.get(key) || 0;
  }
}

