const express = require('express');
const RequestLimiter = require('./requestLimiter');

const app = express();
const requestLimiter = RequestLimiter({
    maxRequests: 3,
    headers: true,
    routesList: [{ path: '/lim', method: 'GET' }, { path: '/kor', method: 'PUT' }],
});

app.use(requestLimiter);

app.get('/', function(req, res) {
    res.send('Hello world');
});

app.get('/lim', function(req, res) {
    setTimeout(() => {
        res.send('From lim')
    }, 15000)
});

app.put('/kor', function(req, res) {
    setTimeout(() => {
        res.send('From kor')
    }, 15000)
});

app.listen(3000, function () {
    console.log('Server listening on port 3000');
});
