import { vi } from 'vitest';
import supertest from 'supertest';
import { RequestLimiter } from '../src/index';
import { createApp, createGate, fire } from './helpers';

describe('0.x compatibility', () => {
  test('accepts maxRequests, routesList with method, and legacy headers', async () => {
    const gate = createGate();
    const limiter = RequestLimiter({
      maxRequests: 2,
      headers: true,
      legacyHeaders: true,
      routesList: [{ path: '/path_one', method: 'GET' }, { path: '/path_two', method: 'DELETE' }],
    });
    const app = createApp((app) => {
      app.use(limiter);
      app.get('/path_one', gate.handler);
      app.delete('/path_two', (req, res) => res.status(204).end());
      app.post('/path_one', (req, res) => res.end('ok'));
    });

    const [first] = fire(app, '/path_one');
    await gate.waitFor(1);
    const [second] = fire(app, '/path_one');
    await gate.waitFor(2);
    const third = await supertest(app).get('/path_one');
    expect(third.status).toBe(429);
    expect(third.headers['x-requestlimit-limit']).toBe('2');
    expect(third.headers['x-requestlimit-usage']).toBe('2');

    expect((await supertest(app).post('/path_one')).status).toBe(200);
    expect((await supertest(app).delete('/path_two')).status).toBe(429);

    gate.release(0);
    const r1 = await first;
    expect(r1.headers['x-requestlimit-limit']).toBe('2');
    expect(r1.headers['x-requestlimit-usage']).toBe('0');
    gate.release(0);
    expect((await second).headers['x-requestlimit-usage']).toBe('1');
  });

  test('global: false limits every request and emits a deprecation warning', async () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const app = createApp((app) => {
      app.use(RequestLimiter({ maxRequests: 0, global: false, routesList: [{ path: '/only', method: 'GET' }] }));
      app.get('/other', (req, res) => res.end('ok'));
    });
    expect((await supertest(app).get('/other')).status).toBe(429);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"global" option is deprecated'), expect.objectContaining({ code: 'EXPRESS_REQUEST_LIMITER_GLOBAL' }));
    warn.mockRestore();
  });
});
