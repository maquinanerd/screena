import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Integracao da PROJECAO EDITORIAL: dois PostgreSQL 16 efemeros ao mesmo tempo
 * (o do Payload, subido pelo harness do CMS, e o do banco publico).
 *
 * O alias `@cms-harness` e a UNICA ponte entre este pacote e `apps/cms`, e ela
 * e de TESTE. Em runtime o worker so fala com o CMS por HTTP: se este alias
 * virasse dependencia de producao, o isolamento do CMS (ADR 0015) teria sido
 * quebrado pela porta dos fundos.
 *
 * `fileParallelism: false`: cada arquivo sobe dois Postgres e um `next build`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 900_000,
    fileParallelism: false,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@cms-harness': fileURLToPath(
        new URL('../../apps/cms/src/__tests__/harness.ts', import.meta.url),
      ),
      '@screena/editorial-contracts': fileURLToPath(
        new URL('../../packages/editorial-contracts/src/index.ts', import.meta.url),
      ),
      '@screena/config': fileURLToPath(
        new URL('../../packages/config/src/index.ts', import.meta.url),
      ),
      '@screena/seo': fileURLToPath(new URL('../../packages/seo/src/index.ts', import.meta.url)),
    },
  },
})
