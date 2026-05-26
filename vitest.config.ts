import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      $engine: path.resolve(__dirname, './src/engine'),
      $lib: path.resolve(__dirname, './src/lib'),
      $routes: path.resolve(__dirname, './src/routes'),
      $storage: path.resolve(__dirname, './src/storage'),
      $state: path.resolve(__dirname, './src/state'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/engine/betting/**/*.ts'],
      exclude: ['src/engine/betting/__tests__/**'],
    },
  },
})
