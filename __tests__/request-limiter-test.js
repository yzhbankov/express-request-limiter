const request = require('supertest');
const app = require('../utils/server');
let server;


describe('Test the root path', () => {
    beforeAll(() => {
        server = app.listen(3000, () => {
            console.log('Server is listening on port 3000!');
        });
    });

    afterAll(() => {
        if (server) {
            server.close();
            console.log('The server is closed');
        }
    });

    describe('It should response by the CRUD methods from server routes', ()  => {
        test('It should response the GET method from /path_one', async () => {
            const response = await request(app).get('/path_one');
            expect(response.statusCode).toBe(200);
        });

        test('It should response the POST method from /path_one', async () => {
            const response = await request(app).post('/path_one', {});
            expect(response.statusCode).toBe(200);
        });

        test('It should response the PUT method from /path_one', async () => {
            const response = await request(app).put('/path_one', {});
            expect(response.statusCode).toBe(200);
        });

        test('It should response the GET method from /path_two', async () => {
            const response = await request(app).get('/path_two');
            expect(response.statusCode).toBe(200);
        });

        test('It should response the DELETE method from /path_two', async () => {
            const response = await request(app).del('/path_two');
            expect(response.statusCode).toBe(204);
        });
    })


});

