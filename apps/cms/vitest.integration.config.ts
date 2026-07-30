import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Testes de INTEGRACAO: sobem Payload real sobre PostgreSQL 16 efemero.
 *
 * `fileParallelism: false` e serie de proposito — cada arquivo inicializa o
 * proprio Postgres, e paralelizar disputaria porta, CPU e disco.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@screena/editorial-contracts': fileURLToPath(
        new URL('../../packages/editorial-contracts/src/index.ts', import.meta.url),
      ),
    },
  },
})
