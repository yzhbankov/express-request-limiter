import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.js'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // vitest 4's AST-based v8 coverage counts sub-line statements (short-circuit
      // arms, inline guards) that line-based remapping in vitest 3 could not see.
      thresholds: { statements: 99, branches: 98, functions: 100, lines: 100 },
    },
  },
});
