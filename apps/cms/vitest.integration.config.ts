import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Testes de INTEGRACAO: sobem Payload real sobre PostgreSQL 16 efemero.
 *
 * `fileParallelism: false` e serie de proposito — cada arquivo inicializa o
 * proprio Postgres, e paralelizar disputaria porta, CPU e disco.
 */

/**
 * Node >= 23 recusa `require()` de ESM dentro de um CICLO de dependencias.
 *
 * O `@payloadcms/db-postgres` carrega `drizzle-orm` por um caminho ciclico, e em
 * Node 24 a suite morre na COLECAO: todos os testes saem "skipped", nenhuma
 * assercao roda, e o sintoma se parece com sucesso para quem olha so o resumo.
 * Inlinar os dois no pipeline do Vite desfaz o `require()`.
 *
 * CONDICIONAL de proposito, pelo mesmo motivo de
 * `services/news-ingestion/vitest.integration.config.ts`: o `engines` do repo
 * pede Node 22 e o CI roda 22, onde o caminho externalizado atual esta provado.
 * Ligar o inline incondicionalmente trocaria o caminho de resolucao do CI por
 * um que ninguem validou naquela versao.
 */
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
const requireEsmCycleWorkaround = nodeMajor >= 23 ? [/drizzle-orm/, /@payloadcms/] : []

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    pool: 'forks',
    server: { deps: { inline: requireEsmCycleWorkaround } },
  },
  resolve: {
    alias: {
      '@screena/editorial-contracts': fileURLToPath(
        new URL('../../packages/editorial-contracts/src/index.ts', import.meta.url),
      ),
    },
  },
})
