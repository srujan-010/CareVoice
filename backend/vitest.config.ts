import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 60000,
    hookTimeout: 45000,
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
});

