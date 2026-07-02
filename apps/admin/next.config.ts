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
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@screena/db"],
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
