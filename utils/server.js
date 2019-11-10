const express = require('express');


function createCRUDForRoute(app, route) {
    if (route && route.path && route.middleware) {
        app.get(route.path, route.middleware, (req, res, next) => {
            res.send(`Hello from method=GET url=${route}`);
        });
        app.post(route.path, route.middleware, (req, res, next) => {
            res.send(`Hello from method=GET url=${route}`);
        });
        app.put(route.path, route.middleware, (req, res, next) => {
            res.send(`Hello from method=GET url=${route}`);
        });
        app.del(route.path, route.middleware, (req, res, next) => {
            res.status(204).send(`Hello from method=GET url=${route}`);
        });
    } else if (route && route.path) {
        app.get(route.path, (req, res, next) => {
            res.send(`Hello from method=GET url=${route}`);
        });
        app.post(route.path, (req, res, next) => {
            res.send(`Hello from method=GET url=${route}`);
        });
        app.put(route.path, (req, res, next) => {
            res.send(`Hello from method=GET url=${route}`);
        });
        app.del(route.path, (req, res, next) => {
            res.status(204).send(`Hello from method=GET url=${route}`);
        });
    }
}

function initApp(globalMiddlewaresList = [], routerList = []) {
    const app = express();

    if (Array.isArray(globalMiddlewaresList) && globalMiddlewaresList.length > 0) {
        for (let i = 0; i < globalMiddlewaresList.length; i += 1) {
            app.use(globalMiddlewaresList[i])
        }
    }

    if (Array.isArray(routerList) && routerList.length > 0) {
        for (let i = 0; i < routerList.length; i += 1) {
            createCRUDForRoute(app, routerList[i])
        }
    }

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
