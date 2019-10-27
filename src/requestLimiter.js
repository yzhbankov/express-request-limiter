const MemoryStore = require('./memoryStore');

function RequestLimiter(_options) {
    const options = Object.assign({
            maxRequests: 100,
            routesList: [],
            global: true,
            headers: true,
            message: "Too many requests, please try again later",
            statusCode: 429,
            skip: function (/*req, res*/) {
                return false;
            },
            handler: function (req, res, next) {
                res.status(options.statusCode).send(options.message);
            },
        },
        _options);

    options.store = options.store || new MemoryStore();

    if (Array.isArray(options.routesList) && options.routesList.length > 0) {
        options.routesList.forEach((route) => {
            if (!options.store.routesTree[route.path]) {
                options.store.routesTree[route.path] = [route.method];
            } else {
                options.store.routesTree[route.path].push(route.method);
            }
        })
    }

    function requestLimit(req, res, next) {
        const method = req.method;
        const url = req.originalUrl;

        if (options.skip(req, res)) {
            return next();
        }

        if (options.global && (!options.store.routesTree[url] || !options.store.routesTree[url].includes(method))) {
            return next();
        }

        if (options.headers && !req.headersSent) {
            res.setHeader("X-RequestLimit-Limit", options.maxRequests);
            res.setHeader("X-RequestLimit-Usage", options.store.concurrent);
        }

        if (options.store.concurrent >= options.maxRequests) {
           return options.handler(req, res, next);
        }

        options.store.increment();

        Promise.resolve(options.store.concurrent).catch(next)
            .then(() => {
                res.on('finish', () => {
                    options.store.decrement();
                });

                res.on('close', () => {
                    options.store.decrement();
                });

                return next();
            });
    }
    return requestLimit;
}

module.exports = RequestLimiter;
