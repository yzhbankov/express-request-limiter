const request = require('supertest');
const { initApp, delayMiddleware } = require('../utils/server');
const RequestLimiter = require('../index');

let server;
const delay = 500; // ms

describe('Test the root path', () => {
    describe('It should init server and check all routes', () => {
        beforeAll(() => {
            server = initApp().listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should response the GET method from /path_one', async () => {
            const response = await request(server).get('/path_one');
            expect(response.statusCode).toBe(200);
        });

        test('It should response the POST method from /path_one', async () => {
            const response = await request(server).post('/path_one', {});
            expect(response.statusCode).toBe(200);
        });

        test('It should response the PUT method from /path_one', async () => {
            const response = await request(server).put('/path_one', {});
            expect(response.statusCode).toBe(200);
        });

        test('It should response the GET method from /path_two', async () => {
            const response = await request(server).get('/path_two');
            expect(response.statusCode).toBe(200);
        });

        test('It should response the DELETE method from /path_two', async () => {
            const response = await request(server).del('/path_two');
            expect(response.statusCode).toBe(204);
        });
    });

    describe('It should init server with delay middleware and check all routes', () => {
        beforeAll(() => {
            server = initApp([delayMiddleware(delay)]).listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should response the GET method from /path_one', async () => {
            const response = await request(server).get('/path_one');
            expect(response.statusCode).toBe(200);
        });

        test('It should response the POST method from /path_one', async () => {
            const response = await request(server).post('/path_one', {});
            expect(response.statusCode).toBe(200);
        });

        test('It should response the PUT method from /path_one', async () => {
            const response = await request(server).put('/path_one', {});
            expect(response.statusCode).toBe(200);
        });

        test('It should response the GET method from /path_two', async () => {
            const response = await request(server).get('/path_two');
            expect(response.statusCode).toBe(200);
        });

        test('It should response the DELETE method from /path_two', async () => {
            const response = await request(server).del('/path_two');
            expect(response.statusCode).toBe(204);
        });
    });

    describe('It should init server with requestLimiter and add Response headers', () => {
        let maxRequests = 2;
        beforeAll(() => {
            const requestLimiter = RequestLimiter({
                maxRequests,
                headers: true,
                routesList: [{ path: '/path_one', method: 'GET' }, { path: '/path_two', method: 'DELETE' }],
            });

            server = initApp([requestLimiter]).listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should response with additional headers', async () => {
            const response = await request(server).get('/path_one');
            expect(response.headers).toHaveProperty('x-requestlimit-limit');
            expect(response.headers).toHaveProperty('x-requestlimit-usage');
            expect(response.headers['x-requestlimit-limit']).toEqual(maxRequests.toString());
            expect(response.headers['x-requestlimit-usage']).toEqual('0');
            expect(response.statusCode).toBe(200);
        });
    });

    describe('It should init server with requestLimiter and not add Response headers', () => {
        let maxRequests = 2;
        beforeAll(() => {
            const requestLimiter = RequestLimiter({
                maxRequests,
                headers: false,
                routesList: [{ path: '/path_one', method: 'GET' }, { path: '/path_two', method: 'DELETE' }],
            });

            server = initApp([requestLimiter]).listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should response with no additional headers', async () => {
            const response = await request(server).get('/path_one');
            expect(response.headers).not.toHaveProperty('x-requestlimit-limit');
            expect(response.headers).not.toHaveProperty('x-requestlimit-usage');
            expect(response.statusCode).toBe(200);
        });
    });

    describe('It should init server with requestLimiter and run unsuccessful tests', () => {
        beforeAll(() => {
            const requestLimiter = RequestLimiter({
                maxRequests: 2,
                headers: true,
                routesList: [{ path: '/path_one', method: 'GET' }, { path: '/path_two', method: 'DELETE' }],
            });

            server = initApp([requestLimiter, delayMiddleware(delay)]).listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should response with error for big number requests on one route', async () => {
            const responseOne = request(server).get('/path_one');
            const responseTwo = request(server).get('/path_one');
            const responseThree = request(server).get('/path_one');
            const responseFour = request(server).get('/path_one');
            await Promise.all([responseOne, responseTwo, responseThree, responseFour])
                .then(([_resOne, _resTwo, _resThree, _resFour]) => {
                    expect(_resOne.statusCode).toBe(200);
                    expect(_resTwo.statusCode).toBe(200);
                    expect(_resThree.statusCode).toBe(429);
                    expect(_resFour.statusCode).toBe(429);
                });
        });

        test('It should allow requests after previous were resolved', async () => {
            const responseOne = await request(server).get('/path_one');
            const responseTwo = await request(server).get('/path_one');
            expect(responseOne.statusCode).toBe(200);
            expect(responseTwo.statusCode).toBe(200);
        });

        test('It should response with error for big number requests on different routes specified on the list', async () => {
            const responseOne = request(server).get('/path_one');
            const responseTwo = request(server).del('/path_two');
            const responseThree = request(server).get('/path_one');
            const responseFour = request(server).get('/path_one');
            await Promise.all([responseOne, responseTwo, responseThree, responseFour])
                .then(([_resOne, _resTwo, _resThree, _resFour]) => {
                    expect(_resOne.statusCode).toBe(200);
                    expect(_resTwo.statusCode).toBe(204);
                    expect(_resThree.statusCode).toBe(429);
                    expect(_resFour.statusCode).toBe(429);
                });
        });

        test('It should ignore limitation for requests with routes and methods not on the limit list', async () => {
            const responseOne = request(server).get('/path_one');
            const responseTwo = request(server).del('/path_two');
            const responseThree = request(server).get('/path_one');
            const responseFour = request(server).get('/path_two');
            const responseFive = request(server).get('/path_one');
            const responseSix = request(server).post('/path_one', {});

            await Promise.all([responseOne, responseTwo, responseThree, responseFour, responseFive, responseSix])
                .then(([_resOne, _resTwo, _resThree, _resFour, _resFive, _resSix]) => {
                    expect(_resOne.statusCode).toBe(200);
                    expect(_resTwo.statusCode).toBe(204);
                    expect(_resThree.statusCode).toBe(429);
                    expect(_resFour.statusCode).toBe(200);
                    expect(_resFive.statusCode).toBe(429);
                    expect(_resSix.statusCode).toBe(200);
                });
        });
    });

    describe('It should init server with requestLimiter and use specific error status code and message', () => {
        let message = "Some custom message";
        let statusCode = 422;

        beforeAll(() => {
            const requestLimiter = RequestLimiter({
                maxRequests: 2,
                message,
                statusCode,
                headers: true,
                routesList: [{ path: '/path_one', method: 'GET' }, { path: '/path_two', method: 'DELETE' }],
            });

            server = initApp([requestLimiter, delayMiddleware(delay)]).listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should response with error for big number requests on one route', async () => {
            const responseOne = request(server).get('/path_one');
            const responseTwo = request(server).get('/path_one');
            const responseThree = request(server).get('/path_one');
            const responseFour = request(server).get('/path_one');
            await Promise.all([responseOne, responseTwo, responseThree, responseFour])
                .then(([_resOne, _resTwo, _resThree, _resFour]) => {
                    expect(_resOne.statusCode).toBe(200);
                    expect(_resTwo.statusCode).toBe(200);
                    expect(_resThree.statusCode).toBe(statusCode);
                    expect(_resThree.text).toEqual(message);
                    expect(_resFour.statusCode).toBe(statusCode);
                });
        });
    });

    describe('It should specify skip function', () => {
        beforeAll(() => {
            const requestLimiter = RequestLimiter({
                maxRequests: 2,
                skip: function (req, res) {
                    if (req.url === '/path_one') {
                        return true;
                    }
                },
                headers: true,
                routesList: [{ path: '/path_one', method: 'GET' }, { path: '/path_two', method: 'DELETE' }],
            });

            server = initApp([requestLimiter, delayMiddleware(delay)]).listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should allow all requests for route "/path_one" due to "skip" method', async () => {
            const responseOne = request(server).get('/path_one');
            const responseTwo = request(server).get('/path_one');
            const responseThree = request(server).get('/path_one');
            const responseFour = request(server).get('/path_one');
            await Promise.all([responseOne, responseTwo, responseThree, responseFour])
                .then(([_resOne, _resTwo, _resThree, _resFour]) => {
                    expect(_resOne.statusCode).toBe(200);
                    expect(_resTwo.statusCode).toBe(200);
                    expect(_resThree.statusCode).toBe(200);
                    expect(_resFour.statusCode).toBe(200);
                });
        });
    });

    describe('It should specify handler function', () => {
        let statusCode = 422;
        let message = 'From handler function';
        beforeAll(() => {
            const requestLimiter = RequestLimiter({
                maxRequests: 2,
                handler: function (req, res, next) {
                    res.status(statusCode).send(message);
                },
                headers: true,
                routesList: [{ path: '/path_one', method: 'GET' }, { path: '/path_two', method: 'DELETE' }],
            });

            server = initApp([requestLimiter, delayMiddleware(delay)]).listen(3000, () => {
                console.log('Server is listening on port 3000!');
            });
        });

        afterAll(() => {
            if (server) {
                server.close();
                console.log('The server is closed');
            }
        });

        test('It should response with specified in "handler" way ', async () => {
            const responseOne = request(server).get('/path_one');
            const responseTwo = request(server).get('/path_one');
            const responseThree = request(server).get('/path_one');
            const responseFour = request(server).get('/path_one');
            await Promise.all([responseOne, responseTwo, responseThree, responseFour])
                .then(([_resOne, _resTwo, _resThree, _resFour]) => {
                    expect(_resOne.statusCode).toBe(200);
                    expect(_resTwo.statusCode).toBe(200);
                    expect(_resThree.statusCode).toBe(statusCode);
                    expect(_resThree.text).toBe(message);
                    expect(_resFour.statusCode).toBe(statusCode);
                    expect(_resFour.text).toBe(message);
                });
        });
    });

});

