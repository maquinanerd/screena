import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Testes PUROS: sem Payload, sem banco, rapidos. */
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@screena/editorial-contracts': fileURLToPath(
        new URL('../../packages/editorial-contracts/src/index.ts', import.meta.url),
      ),
    },
  },
})
