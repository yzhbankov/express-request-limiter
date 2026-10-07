import * as pkg from '../src/index';
import requestLimiter, { RequestLimiter, MemoryStore, compileRoutes } from '../src/index';
import manifest from '../package.json' with { type: 'json' };

describe('module exports', () => {
  test('the factory is the default export and is also exported by name', () => {
    expect(typeof requestLimiter).toBe('function');
    expect(pkg.requestLimiter).toBe(requestLimiter);
    expect(RequestLimiter).toBe(requestLimiter);
  });

  test('helpers are exposed', () => {
    expect(typeof MemoryStore).toBe('function');
    expect(typeof compileRoutes).toBe('function');
  });

  test('package.json ships only the build output and has no runtime dependencies', () => {
    expect(manifest.type).toBe('module');
    expect(manifest.files).toEqual(['dist', 'llms.txt', 'CHANGELOG.md']);
    expect(manifest.exports['.'].import.default).toBe('./dist/index.js');
    expect(manifest.exports['.'].require.default).toBe('./dist/index.cjs');
    expect(manifest.dependencies).toBeUndefined();
  });
});
