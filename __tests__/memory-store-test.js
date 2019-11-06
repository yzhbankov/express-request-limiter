const MemoryStore = require('../src/memoryStore');
let store;
describe('Tetsting Memory Store', () => {
    beforeAll(() => {
        store = new MemoryStore();
    });

    test('it should init MemoryStore instance', () => {
        expect(store).toHaveProperty('concurrent', 0);
        expect(store).toHaveProperty('routesTree', {});
        expect(store).toHaveProperty('increment');
        expect(store).toHaveProperty('decrement');
        expect(store).toHaveProperty('arrayToTree');
    });

    test('it should increment concurent count', () => {
        store.increment();
        expect(store).toHaveProperty('concurrent', 1);
        store.increment();
        expect(store).toHaveProperty('concurrent', 2);
    });

    test('it should decrement concurent count', () => {
        store.decrement();
        expect(store).toHaveProperty('concurrent', 1);
        store.decrement();
        expect(store).toHaveProperty('concurrent', 0);
    });

    test('it should not fail when init empty routes list', () => {
        const arrayList = [];
        store.arrayToTree(arrayList);
        expect(store.routesTree).toEqual({});
    });

    test('it should init routes tree from routes list', () => {
        const pathOne = '/path_one';
        const pathTwo = '/path_two';
        const arrayList = [
            {path: pathOne, method: 'GET'}, {path: pathTwo, method: 'POST'},
            {path: pathOne, method: 'POST'}, {path: pathTwo, method: 'PUT'}
        ];
        store.arrayToTree(arrayList);

        expect(Array.isArray(store.routesTree[pathOne])).toBe(true);
        expect(Array.isArray(store.routesTree[pathTwo])).toBe(true);
        expect(store.routesTree[pathOne].length).toEqual(2);
        expect(store.routesTree[pathTwo].length).toEqual(2);
        expect(store.routesTree[pathOne]).toEqual(['GET', 'POST']);
        expect(store.routesTree[pathTwo]).toEqual(['POST', 'PUT']);
    });
});
