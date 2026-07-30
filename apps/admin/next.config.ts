import type { NextConfig } from "next";

/**
 * Configuracao do admin interno @screena/admin.
 *
 * Diferente do app publico @screena/web (render puro, zero API externa), o admin
 * PODE ler o PostgreSQL local server-side via @screena/db. Ainda assim, nesta
 * fase, o admin e SOMENTE LEITURA: nao escreve, nao publica, nao chama API
 * externa/TMDB/Gemini.
 *
 * `@screena/db` e consumido como FONTE TypeScript (main = src/index.ts); o Next
 * precisa transpila-lo. O `extensionAlias` faz a ponte dos imports ESM com
 * extensao `.js` que apontam para arquivos `.ts` (convencao dos pacotes).
 *
 * `@screena/news-ingestion` entra pelo mesmo motivo: o admin consome dele a
 * FONTE UNICA das transicoes editoriais (`canTransition`). So o nucleo PURO e
 * alcancado — `src/index.ts` nao exporta os adapters Prisma de `src/persistence/`,
 * entao nada de banco atravessa para o bundle por esta porta.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@screena/db", "@screena/news-ingestion"],
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
