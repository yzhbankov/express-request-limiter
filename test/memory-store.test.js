import { MemoryStore } from '../src/memory-store';

describe('MemoryStore', () => {
  let store;
  beforeEach(() => {
    store = new MemoryStore();
  });

  test('starts empty', () => {
    expect(store.get('a')).toBe(0);
    expect(store.size).toBe(0);
    expect(store.snapshot()).toEqual({});
  });

  test('acquire returns the new count while under the limit', () => {
    expect(store.acquire('a', 2)).toBe(1);
    expect(store.acquire('a', 2)).toBe(2);
    expect(store.get('a')).toBe(2);
  });

  test('acquire returns false once the limit is reached', () => {
    store.acquire('a', 1);
    expect(store.acquire('a', 1)).toBe(false);
    expect(store.get('a')).toBe(1);
  });

  test('a limit of zero rejects immediately', () => {
    expect(store.acquire('a', 0)).toBe(false);
    expect(store.get('a')).toBe(0);
  });

  test('keys are independent', () => {
    store.acquire('a', 1);
    expect(store.acquire('b', 1)).toBe(1);
    expect(store.acquire('a', 1)).toBe(false);
    expect(store.size).toBe(2);
  });

  test('release decrements and removes the key at zero', () => {
    store.acquire('a', 5);
    store.acquire('a', 5);
    expect(store.release('a')).toBe(1);
    expect(store.release('a')).toBe(0);
    expect(store.size).toBe(0);
  });

  test('release never goes negative and tolerates unknown keys', () => {
    expect(store.release('missing')).toBe(0);
    store.acquire('a', 1);
    store.release('a');
    expect(store.release('a')).toBe(0);
    expect(store.get('a')).toBe(0);
  });

  test('resetKey clears a single key', () => {
    store.acquire('a', 5);
    store.acquire('b', 5);
    store.resetKey('a');
    expect(store.get('a')).toBe(0);
    expect(store.get('b')).toBe(1);
  });

  test('resetAll clears every key', () => {
    store.acquire('a', 5);
    store.acquire('b', 5);
    store.resetAll();
    expect(store.size).toBe(0);
  });

  test('snapshot is a detached copy', () => {
    store.acquire('a', 5);
    const snap = store.snapshot();
    expect(snap).toEqual({ a: 1 });
    store.acquire('a', 5);
    expect(snap).toEqual({ a: 1 });
  });
});
