const express = require('express');


const app = express();

app.get('/path_one', (req, res, next) => {
    res.send('Hello from GET path_one route')
});

app.post('/path_one', (req, res, next) => {
    res.send('Hello from POST path_one route')
});

app.put('/path_one', (req, res, next) => {
    res.send('Hello from PUT path_one route')
});

app.get('/path_two', (req, res, next) => {
    res.send('Hello from GET path_two route')
});

app.del('/path_two', (req, res, next) => {
    res.status(204).send('Hello from DEL path_two route')
});


module.exports = app;
