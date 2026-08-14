import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      'packages/**/*.test.ts',
      'api-clients/**/*.test.ts',
      'services/**/*.test.ts',
      // apps/** ENTRA na coleta (baseline R-06): antes um teste dentro de
      // apps/web ou apps/admin nunca rodava (falha silenciosa). Cobre .ts e
      // .tsx para nao repetir o mesmo buraco quando surgir teste de componente.
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
    ],
    // Exclui saida de build/deps: o glob apps/** nao pode arrastar .next/ nem
    // node_modules (o default do vitest ja ignora node_modules; .next e dist
    // sao explicitados para o caso de artefatos de build presentes).
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      // A integracao do CMS sobe Payload + PostgreSQL efemero e tem gate
      // proprio (`test:cms:integration`). Deixa-la aqui faria a suite geral
      // levar minutos e depender de binario de banco.
      '**/*.integration.test.ts',
    ],
    environment: 'node',
  },
  // JSX pelo runtime AUTOMATICO — o mesmo do Next. Sem isto o esbuild usa o
  // transform classico e emite `React.createElement` em arquivos que (como todo
  // componente do App Router) nao importam `React`, e um teste de componente
  // morre com "React is not defined" — que parece bug do componente e nao da
  // configuracao de teste. `apps/**/*.test.tsx` ja estava no include; faltava
  // isto para o include valer alguma coisa.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@screena/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)),
      '@screena/schemas': fileURLToPath(
        new URL('./packages/schemas/src/index.ts', import.meta.url),
      ),
      '@screena/seo': fileURLToPath(new URL('./packages/seo/src/index.ts', import.meta.url)),
      '@screena/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
      '@screena/types': fileURLToPath(new URL('./packages/types/src/index.ts', import.meta.url)),
      // ANTES de '@screena/db': o alias de string casa por PREFIXO, e o mais
      // curto sequestraria '@screena/db/server' para o index do pacote. Este
      // subcaminho existe para os testes que exercitam a camada de dados com um
      // cliente Prisma injetado — o modulo so importa o TIPO no caminho deles.
      '@screena/db/server': fileURLToPath(
        new URL('./packages/db/src/server.ts', import.meta.url),
      ),
      '@screena/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@screena/public-contracts': fileURLToPath(
        new URL('./packages/public-contracts/src/index.ts', import.meta.url),
      ),
      '@screena/cinerie-score': fileURLToPath(
        new URL('./packages/cinerie-score/src/index.ts', import.meta.url),
      ),
      '@screena/editorial-contracts': fileURLToPath(
        new URL('./packages/editorial-contracts/src/index.ts', import.meta.url),
      ),
      '@screena/legal': fileURLToPath(new URL('./services/legal/src/index.ts', import.meta.url)),
      '@screena/news-ingestion': fileURLToPath(
        new URL('./services/news-ingestion/src/index.ts', import.meta.url),
      ),
      '@screena/tmdb-client': fileURLToPath(
        new URL('./api-clients/tmdb/src/index.ts', import.meta.url),
      ),
      '@screena/rapidapi-core': fileURLToPath(
        new URL('./api-clients/rapidapi-core/src/index.ts', import.meta.url),
      ),
      '@screena/omdb-client': fileURLToPath(
        new URL('./api-clients/omdb/src/index.ts', import.meta.url),
      ),
      '@screena/film-show-ratings-client': fileURLToPath(
        new URL('./api-clients/film_show_ratings/src/index.ts', import.meta.url),
      ),
      '@screena/streaming-availability-client': fileURLToPath(
        new URL('./api-clients/streaming_availability/src/index.ts', import.meta.url),
      ),
    },
  },
})
