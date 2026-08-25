import type { NextConfig } from "next";

/**
 * ============================================================================
 * CABECALHOS DE SEGURANCA — os quatro inocuos
 * ============================================================================
 * MEDIDO EM PRODUCAO (2026-08-25): `https://cinerie.com/pt/` e
 * `https://cinerie.com/api/health/` respondiam 200 sem NENHUM cabecalho de
 * seguranca — nem `nosniff`, nem `Referrer-Policy`, nem `X-Frame-Options`, nem
 * `Permissions-Policy`. Zero de sete, na pagina publica E na rota de API.
 *
 * POR QUE AQUI, E NAO NO `middleware.ts`
 * --------------------------------------
 * O matcher do middleware EXCLUI `api` (e `_next/static`, `media`, `brand`,
 * `uploads`). Cabecalho posto la nunca alcancaria `/api/health/`, que foi
 * justamente uma das duas superficies medidas nuas. Alem disso o middleware faz
 * um subrequest por request (`/api/seo/redirect`); estender o matcher para
 * `/api/**` so para carimbar cabecalho pagaria esse custo em toda chamada de
 * API. `headers()` do `next.config` roda na camada de ROTEAMENTO, antes de
 * qualquer handler, e cobre pagina, route handler, asset de `public/` e
 * `_next/static` de uma vez.
 *
 * NAO E CSP NEM HSTS. Os dois ficam de fora DE PROPOSITO: CSP mal calibrado
 * quebra a pagina e HSTS e quase irreversivel. Ambos exigem PR propria.
 *
 * A BORDA (Cloudflare) fica na frente. Ela repassa cabecalho de origem por
 * padrao; o que ela injeta hoje e o bloco gerenciado do `robots.txt`. Se algum
 * dia um Transform Rule/"Security Headers" da borda passar a emitir estes
 * mesmos nomes, o valor da borda e o que o navegador ve — a verificacao final e
 * medir a resposta publica, nao ler este arquivo.
 *
 * INTERACAO MEDIDA COM ROUTE HANDLER (Next 15.5)
 * ----------------------------------------------
 * `router-server.js` aplica estes cabecalhos com `res.setHeader(...)` ANTES de
 * chamar o handler; depois `send-response.js` so acrescenta o cabecalho da
 * `Response` do handler "if it is either not present in the outbound response".
 * Ou seja: o que esta aqui VENCE o que o handler define, em silencio.
 *
 * E por isso que existe a segunda regra, mais especifica, abaixo. As 34 rotas
 * sob `/api/auth`, `/api/account` e `/api/me` delegam para
 * `@screena/user-platform`, que responde com `Referrer-Policy: no-referrer`
 * (`AUTH_SECURITY_HEADERS`) porque a pagina que as consome carrega token na
 * URL. Uma regra global unica teria SUPRIMIDO esse `no-referrer` e rebaixado a
 * borda de autenticacao para `strict-origin-when-cross-origin` sem aviso.
 * `x-content-type-options` colide com o mesmo valor (`nosniff`) nessas rotas e
 * em `/media/editorial/`, entao a supressao ali e inofensiva.
 */

/**
 * `Referrer-Policy` da borda de autenticacao — o valor que
 * `AUTH_SECURITY_HEADERS` ja emitia e que a regra global apagaria.
 */
const AUTH_BOUNDARY_REFERRER_POLICY = "no-referrer";

/**
 * Arvores de rota que respondem por `@screena/user-platform` e por isso pedem o
 * `Referrer-Policy` mais restrito. Nao e estilo: cada entrada aqui corresponde
 * a um diretorio de `apps/web/app/api/`, e
 * `tests/web/security-headers.test.ts` recusa uma arvore nova que emita
 * `no-referrer` sem aparecer nesta lista.
 */
const AUTH_BOUNDARY_ROUTE_TREES = ["auth", "account", "me"] as const;

/**
 * `Permissions-Policy`: allowlist VAZIA para o que o app comprovadamente nao
 * usa. Varredura em `apps/**` (fora de `node_modules`) nao encontra
 * `navigator.geolocation`, `navigator.mediaDevices`/`getUserMedia`,
 * `PaymentRequest`, `requestMIDIAccess`, `navigator.bluetooth|usb|serial|hid`,
 * `DeviceMotionEvent`/`DeviceOrientationEvent`, `wakeLock`, `<video>` nem
 * `<audio>` — dai `autoplay` tambem entrar na lista.
 *
 * TRES FEATURES FICAM DE FORA DE PROPOSITO: `fullscreen`,
 * `picture-in-picture` e `encrypted-media`. O player de trailer
 * (`app/_components/youtube-frame.tsx`) pede exatamente essas tres em
 * `allow="encrypted-media; picture-in-picture; fullscreen"` mais
 * `allowFullScreen`. Permissions-Policy do documento de topo governa a
 * DELEGACAO: listar qualquer uma delas com allowlist vazia revogaria o `allow`
 * do iframe e quebraria o botao de tela cheia e o video com DRM.
 *
 * `publickey-credentials-get` (WebAuthn) tambem fica de fora: hoje nao ha uso,
 * mas a borda de autenticacao esta viva e passkey e adicao plausivel — bloquear
 * agora trocaria zero reducao de superficie por uma falha silenciosa de login
 * depois.
 *
 * `browsing-topics=()` entra porque o app nao tem publicidade: os contratos
 * canonicos de home/noticia/explorar ja asseguram ausencia de `doubleclick` e
 * `adsbygoogle` no HTML. Sem anuncio, inferencia de topico e so superficie.
 */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "bluetooth=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "local-fonts=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

/**
 * Os quatro cabecalhos aplicados a TODO path.
 *
 * NENHUM valor pode conter `:`. O Next roda `compileNonPath()` sobre chave e
 * valor quando a regra tem parametro (e `'/:path*'` tem), e essa funcao so
 * devolve cedo justamente quando nao ha `:` — com dois-pontos ela trataria
 * `(`/`)` como sintaxe de grupo do path-to-regexp. `Permissions-Policy` e cheio
 * de parenteses; e a ausencia de `:` que o mantem intacto.
 */
const BASE_SECURITY_HEADERS = [
  // Impede o navegador de adivinhar o tipo do corpo e executar como script algo
  // servido como texto/imagem. Sem efeito colateral conhecido.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `strict-origin-when-cross-origin`: caminho completo em navegacao interna
  // (atribuicao propria continua funcionando), so a origem quando sai para
  // terceiro, e NADA em downgrade https->http. E o mesmo valor que o unico
  // subrecurso de terceiro do app ja declara por conta propria
  // (`referrerPolicy` do iframe do player) e o que `docs/CLOUDPANEL_DEPLOY.md`
  // ja prescrevia para o nginx. `no-referrer` global seria mais restrito, mas
  // apagaria o credito de saida para as fontes que o rodape linka.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `DENY`, nao `SAMEORIGIN`: o UNICO elemento `<iframe>` do repositorio e o
  // player do YouTube (`app/_components/youtube-frame.tsx`) — e ele e SAIDA,
  // nos enquadrando terceiro. `X-Frame-Options` governa quem pode enquadrar
  // NOS, e nada enquadra uma pagina da Cinerie: `apps/admin` nao tem um
  // `<iframe>` sequer, e `apps/cms` nao configura live preview (o
  // `embed-url.ts` de la recusa explicitamente devolver iframe pronto).
  // Sem enquadramento de mesma origem, `SAMEORIGIN` nao compraria nada que
  // `DENY` ja nao de. O equivalente moderno (`frame-ancestors 'none'`) vive no
  // CSP e fica para a PR propria.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
] as const;

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
  /**
   * CABECALHOS DE SEGURANCA. Ver o bloco no topo do arquivo para o porque de
   * cada valor e para a interacao medida com os route handlers.
   *
   * ORDEM IMPORTA. O Next acumula as regras que casam e faz
   * `resHeaders[key] = value` — a ULTIMA regra que casa vence para a mesma
   * chave. A regra da borda de autenticacao vem depois da global de proposito,
   * e usa a MESMA grafia da chave (`Referrer-Policy`), porque a colisao
   * acontece na chave literal do objeto.
   */
  async headers() {
    return [
      { source: '/:path*', headers: [...BASE_SECURITY_HEADERS] },
      ...AUTH_BOUNDARY_ROUTE_TREES.map((tree) => ({
        source: `/api/${tree}/:path*`,
        headers: [{ key: 'Referrer-Policy', value: AUTH_BOUNDARY_REFERRER_POLICY }],
      })),
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
