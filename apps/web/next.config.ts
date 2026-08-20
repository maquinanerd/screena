import type { NextConfig } from "next";

/**
 * Configuracao do app publico @screena/web.
 *
 * INVARIANTE INEGOCIAVEL (3 e 4 do CANON):
 *   - Nenhuma chamada de API externa no render de paginas indexaveis.
 *     Paginas publicas leem APENAS PostgreSQL/cache local (api_cache).
 *   - Nenhuma execucao de Gemini/IA no render. content_blocks sao gerados
 *     offline, salvos, validados e somente entao consumidos pela pagina.
 *
 * ISR / revalidate:
 *   - Use export const revalidate em cada rota (ou fetch cache local) para
 *     regenerar HTML estatico periodicamente sem ir a rede de terceiros.
 *   - A revalidacao re-le o snapshot do PostgreSQL/cache, nunca uma API externa.
 *
 * Imagens:
 *   - Nesta fase, a rota publica so renderiza paths locais seguros
 *     (`/media/`, `/uploads/`, `/brand/`). CDN externa fica fora do render.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * REDIRECTS PERMANENTES DE ROTA.
   *
   * `/pt/busca/` era um formulario nu — campo, botao e uma frase instrutiva,
   * zero conteudo — enquanto `/pt/explorar/` ja carregava Em Alta, Lancamentos,
   * Mais aguardados e Populares. Duas paginas finas na mesma intencao. A que
   * sobrevive e `explorar`, porque e a que tem conteudo real e pode indexar;
   * busca sem termo E navegacao.
   *
   * `statusCode: 301` e escolha explicita: o pedido foi 301, e `permanent: true`
   * do Next emite 308. Os dois sao permanentes para buscador; 301 e o que os
   * links antigos ja compartilhados esperam.
   *
   * A QUERY E PRESERVADA pelo proprio Next quando o destino nao declara query
   * propria — e por isso que o destino aqui NAO tem `?`: um link antigo
   * `/pt/busca/?q=duna` chega em `/pt/explorar/?q=duna` e continua buscando.
   */
  async redirects() {
    return [
      { source: '/pt/busca', destination: '/pt/explorar/', statusCode: 301 },
      { source: '/pt/busca/', destination: '/pt/explorar/', statusCode: 301 },
    ]
  },
  // Rotas canonicas usam barra final (ex.: /pt/filmes/{slug}/). Alinhar o
  // trailing slash evita divergencia entre a URL servida e o <link rel="canonical">.
  trailingSlash: true,
  // Pacotes do monorepo sao consumidos como FONTE TypeScript (main = src/index.ts).
  // O Next precisa transpila-los; isto NAO muda arquitetura nem invariante — so
  // diz ao bundler para compilar o TS dessas libs. `@screena/db` continua
  // server-only (so alcancado por server components; travado por audit:render).
  transpilePackages: [
    "@screena/config",
    "@screena/seo",
    "@screena/ui",
    "@screena/types",
    "@screena/db",
    // Runtime de autenticacao (C7C). SERVER-ONLY: so as rotas /api/auth/** o
    // alcancam, e a guarda de fronteira prova que nenhum client component o
    // importa. A chave da Brevo nunca entra no bundle do cliente.
    "@screena/user-platform",
  ],
  // Esses pacotes usam imports ESM com extensao `.js` (convencao NodeNext) que
  // apontam para arquivos `.ts` (ex.: `export * from "./value-blocks.js"`). O
  // webpack do Next nao resolve `.js` -> `.ts` por padrao; o extensionAlias
  // abaixo faz essa ponte (fallback para `.js` real quando nao houver `.ts`).
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
