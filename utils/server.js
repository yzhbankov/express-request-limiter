const express = require('express');

function initApp(middlewaresList = []) {
    const app = express();

    if (Array.isArray(middlewaresList) && middlewaresList.length > 0) {
        for (let i = 0; i < middlewaresList.length; i += 1) {
            app.use(middlewaresList[i])
        }
    }

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

    return app;
}


function delayMiddleware(value = 1000) {
    return function(req, res, next) {
        setTimeout(() => {
            next();
        }, value)
    }
}


module.exports.initApp = initApp;
module.exports.delayMiddleware = delayMiddleware;
