/**
 * Per-user limits with queueing: each user may have 2 renders running; up to
 * 10 more wait in line for at most 5 seconds.
 *
 *   npm run build && node examples/per-user-queue.js
 *   for i in $(seq 6); do curl -s -H 'x-user: alice' localhost:3000/render & done; wait
 */

import express from 'express';
import requestLimiter from 'express-request-limiter';

const app = express();

const renderLimiter = requestLimiter({
  max: 2,
  keyGenerator: (req) => req.get('x-user') || req.ip,
  queue: { maxSize: 10, timeout: 5000 },
  statusCode: 503,
  message: (req, res, info) => ({
    error: info.reason === 'queue-timeout' ? 'Timed out waiting for a render slot' : 'Render queue is full',
    key: info.key,
    waiting: info.queueSize,
  }),
  onQueued: (req, res, info) => console.log(`[queue] ${info.key} waiting at position ${info.queueSize}`),
  onLimitReached: (req, res, info) => console.log(`[reject] ${info.key}: ${info.reason}`),
});

app.get('/render', renderLimiter, async (req, res) => {
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  res.json({ user: req.requestLimit.key, tookMs: Date.now() - started });
});

app.get('/stats', (req, res) => {
  res.json({ inFlight: renderLimiter.store.snapshot(), queued: renderLimiter.getQueueSize() });
});

app.listen(3000, () => {
  console.log('listening on http://localhost:3000  (GET /render, GET /stats)');
});
