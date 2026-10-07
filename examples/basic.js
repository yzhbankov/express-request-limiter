/**
 * Minimal example: limit the whole /api prefix to 5 simultaneous requests.
 *
 *   npm run build && node examples/basic.js
 *   # in another terminal, send 20 at once:
 *   seq 20 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/items
 */

import express from 'express';
import requestLimiter from 'express-request-limiter';

const app = express();

app.use('/api', requestLimiter({ max: 5, routes: [{ path: '/api/*' }] }));

app.get('/api/items', async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 500)); // pretend to work
  res.json({ items: [], load: `${req.requestLimit.current}/${req.requestLimit.limit}` });
});

app.get('/free', (req, res) => {
  res.send('not limited');
});

app.listen(3000, () => {
  console.log('listening on http://localhost:3000  (GET /api/items is limited to 5 at once)');
});
