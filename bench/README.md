# Benchmarks

## Middleware overhead

`npm run bench` runs `bench/middleware.bench.js`: a micro-benchmark that calls
the middleware directly with mock request/response objects, so it measures
the limiter's own cost and nothing else. Pass an iteration count as the first
argument to change the sample size.

## Against express-rate-limit

`npm run bench:compare` runs `bench/compare.bench.js`: both middlewares on the
same mock objects, admit path only. They limit different things (concurrent
requests vs. requests per window), so this is a cost comparison, not a
feature comparison. Build first.

## End-to-end HTTP

To see the effect inside a real server use [autocannon](https://github.com/mcollina/autocannon):

```sh
node examples/basic.js &            # starts on :3000
npx autocannon -c 100 -d 10 http://localhost:3000/api/items
npx autocannon -c 100 -d 10 http://localhost:3000/free
```

Compare the two endpoints: `/api/items` is limited, `/free` is not. On a
limited endpoint the limiter typically costs well under a microsecond per
request, which is noise next to Express routing and the network stack.
