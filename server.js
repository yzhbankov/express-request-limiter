const express = require('express');
const RequestLimiter = require('./requestLimiter');

const app = express();
const requestLimiter = RequestLimiter({
    maxRequests: 3,
});

app.use(requestLimiter);

app.get('/', function(req, res) {
    setTimeout(() => {
        res.send('Hello world')
    }, 5000)
});

app.listen(3000, function () {
    console.log('Server listening on port 3000');
});
