import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      'packages/**/*.test.ts',
      'api-clients/**/*.test.ts',
      'services/**/*.test.ts',
    ],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@screena/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)),
      '@screena/schemas': fileURLToPath(
        new URL('./packages/schemas/src/index.ts', import.meta.url),
      ),
      '@screena/seo': fileURLToPath(new URL('./packages/seo/src/index.ts', import.meta.url)),
      '@screena/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
      '@screena/types': fileURLToPath(new URL('./packages/types/src/index.ts', import.meta.url)),
      '@screena/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@screena/tmdb-client': fileURLToPath(
        new URL('./api-clients/tmdb/src/index.ts', import.meta.url),
      ),
      '@screena/rapidapi-core': fileURLToPath(
        new URL('./api-clients/rapidapi-core/src/index.ts', import.meta.url),
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
