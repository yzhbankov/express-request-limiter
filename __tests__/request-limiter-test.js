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
                routesList: [{ path: '/path_one', method: 'GET' }, { path: 'path_two', method: 'DELETE' }],
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
                routesList: [{ path: '/path_one', method: 'GET' }, { path: 'path_two', method: 'DELETE' }],
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

    describe('It should init server with requestLimiter', () => {
        beforeAll(() => {
            const requestLimiter = RequestLimiter({
                maxRequests: 2,
                headers: true,
                routesList: [{ path: '/path_one', method: 'GET' }, { path: 'path_two', method: 'DELETE' }],
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

        test('It should response with error for requests number more then max', async () => {
            const responseOne = request(server).get('/path_one');
            const responseTwo = request(server).get('/path_one');
            const responseThree = request(server).get('/path_one');
            await Promise.all([responseOne, responseTwo, responseThree]).then(([_resOne, _resTwo, _resThree]) => {
                expect(_resOne.statusCode).toBe(200);
                expect(_resTwo.statusCode).toBe(200);
                expect(_resThree.statusCode).toBe(429);
            });
        });
    });



});

