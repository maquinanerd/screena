import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
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
