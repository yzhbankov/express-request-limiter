import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.js'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { statements: 100, branches: 98, functions: 100, lines: 100 },
    },
  },
});
