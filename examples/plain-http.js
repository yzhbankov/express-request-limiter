/**
 * No framework at all: the limiter on a raw http.createServer handler.
 *
 *   npm run build && node examples/plain-http.js
 */

import http from 'node:http';
import requestLimiter from 'express-request-limiter';

const limiter = requestLimiter({ max: 3, routes: [{ path: '/work', methods: ['GET'] }] });

const server = http.createServer((req, res) => {
  limiter(req, res, (err) => {
    if (err) {
      res.statusCode = 500;
      res.end(err.message);
      return;
    }
    if (req.url.startsWith('/work')) {
      setTimeout(() => res.end('done\n'), 300);
      return;
    }
    res.end('hello\n');
  });
});

server.listen(3000, () => {
  console.log('listening on http://localhost:3000  (GET /work is limited to 3 at once)');
});
