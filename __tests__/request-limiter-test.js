const request = require('supertest');
const { initApp, delayMiddleware } = require('../utils/server');
let server;


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
            server = initApp([delayMiddleware(200)]).listen(3000, () => {
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

});

