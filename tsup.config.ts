import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  clean: true,
  // Let `require('express-request-limiter')` return the factory itself, as 0.x did, while keeping the named exports on it.
  footer: ({ format }) => (format === 'cjs' ? { js: 'module.exports = Object.assign(module.exports.default, module.exports);' } : {}),
});
