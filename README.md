## Express request-limiter
Request limiting middleware for Express applications

``` sh
npm install express-request-limiter --save
```

## Usage
### Globally on application
``` js
var express = require('express');
var RequestLimiter = require('express-request-limiter');

var app = express();

const requestLimiter = RequestLimiter({
    maxRequests: 10,
    headers: true,
    routesList: [{ path: '/api/first', method: 'GET' }, { path: '/api/second', method: 'PUT' }],
});

app.use(requestLimiter);


app.get('/api/first', function (req, res) {
  res.send(200, 'ok')
})
```

### Separately on each route
``` js
var express = require('express');
var RequestLimiter = require('express-request-limiter');

var app = express();

const requestLimiter = RequestLimiter({
    maxRequests: 10,
    global: false,
    headers: true
});


``` js
app.get('/user/first', requestLimiter, function (req, res) {
    // request logic
    ...
})
```

### API options

``` js
RequestLimiter(options)
```

 - `maxRequests`: `Number` the number of maximum concurrent requests at a time. Default to 10.
 - `routesList`: `Array` the list of objects that are specify router path and method which are will
 be monitored.
 - `routesList.path`: `String` router path.
 - `routesList.method`: `String` request method.
 - `global`: `Boolean` the flag that is indicates do the limiter will be global or local for an
 application. Default to `true`.
  - `headers`: `Boolean` the flag that enable headers for request limit (X-RequestLimit-Limit)
   and current usage (X-RequestLimit-Usage) on all responses. Default to `true`.
 - `message`: `String` the error message sent to user when `maxRequests` is exceeded.
Defaults to 'Too many requests, please try again later.'
 - `statusCode`: `Number` HTTP status code returned when `maxRequests` is exceeded.
Defaults to 429.
 - `skip`: `Function` the function used to skip (whitelist) requests.
 Returning true from the function will skip limiting for that request.
Defaults to always false (count all requests):
``` js
 function (/*req, res*/) {
    return false;
 }
```       
 - `handler`: The function to handle requests once the `maxRequests` limit is exceeded. It receives the request and the response objects.
 The "next" param is available if you need to pass to the next middleware.
  
  Defaults to:
  ``` js
  function (req, res, /*next*/) {
      res.status(options.statusCode).send(options.message);
  }
  ```

 - `onRateLimited`: `Function` called when a request exceeds the configured rate limit.


## License MIT

MIT © Iaroslav Zhbankov
