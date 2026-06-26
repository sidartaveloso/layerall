import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/templates/**'],
    },
  },
});