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

/**
 * Node >= 23 recusa `require()` de ESM dentro de um CICLO de dependencias.
 *
 * O `@payloadcms/db-postgres` carrega `drizzle-orm` por um caminho ciclico, e
 * em Node 24 a suite morre na COLECAO: 43 testes "skipped", nenhuma assercao
 * executada, e um verde falso por omissao se alguem so olhar o exit code de
 * outro comando. Inlinar os dois no pipeline do Vite desfaz o `require()`.
 *
 * CONDICIONAL de proposito. O `engines` do repo pede Node 22 e o CI roda 22,
 * onde o caminho externalizado atual funciona e esta provado. Ligar o inline
 * incondicionalmente trocaria o caminho de resolucao do CI por um que ninguem
 * validou naquela versao — consertar a maquina de quem desenvolve nao vale
 * mexer no que o CI ja exercita.
 */
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
const requireEsmCycleWorkaround = nodeMajor >= 23 ? [/drizzle-orm/, /@payloadcms/] : []

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 900_000,
    fileParallelism: false,
    pool: 'forks',
    server: { deps: { inline: requireEsmCycleWorkaround } },
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
