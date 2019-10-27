const error = require('http-errors');

const store = {
    total: 0,
    increment: function() {
        this.total += 1;
        console.log('[increment] total  requests ', this.total);
    },
    decrement: function() {
        if (this.total > 0) {
            this.total -= 1;
            console.log('[decrement] total  requests ', this.total);
        }
    }
};

function RequestLimiter(_options) {
    const options = Object.assign({
            maxRequests: 10,
            list: [],
            headers: true,
            message: "Too many requests, try again later",
            status: 429,
            skip: function (/*req, res*/) {
                return false;
            },
            handler: function (req, res /*, next*/) {
                res.status(options.statusCode).send(options.message);
            },
        },
        _options);

    function requestLimit(req, res, next) {
        if (options.skip(req, res)) {
            return next();
        }

        if (store.total >= options.maxRequests) {
            const err = new error(429, 'Try again latter');
            next(err);
        }
        store.increment();

        Promise.resolve(store.total).catch(next)
            .then(() => {
                res.on('finish', () => {
                    store.decrement();
                });

                res.on('close', () => {
                    store.decrement();
                });

                next();
            });
    }

    return requestLimit;
}

module.exports = RequestLimiter;
