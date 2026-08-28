/**
 * route-cache-policy.ts — O REGISTRO UNICO de politica de cache por rota.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * Medido em producao em 2026-08-28: TODA rota publica respondia
 * `private, no-cache, no-store, max-age=0, must-revalidate` com
 * `cf-cache-status: DYNAMIC`, e a home levava 3,7 s de TTFB.
 *
 * Esse cabecalho NAO e escrito por nenhuma linha deste repositorio. Ele e o
 * default do proprio Next para resposta NAO cacheada — `getCacheControlHeader`
 * em `next/dist/server/lib/cache-control.js` devolve exatamente essa string
 * quando `revalidate === 0`, e devolve `s-maxage=<n>` quando ha revalidacao.
 * A prova executada esta em `validate-route-cache-real-postgres.ts`: a MESMA
 * instalacao do Next emite `s-maxage=31536000` para `/pt/termos/` (estatica) e
 * `no-store` para `/pt/` (dinamica), sem uma linha nossa de `Cache-Control`.
 *
 * Ou seja: nao ha "header global para remover". Ha rota dinamica para deixar de
 * ser dinamica. O header e CONSEQUENCIA, e este registro e o lugar unico onde a
 * decisao por rota mora.
 *
 * ============================================================================
 * A REGRA QUE NAO PODE SER RELAXADA: AUSENCIA E FALHA
 * ============================================================================
 * O mapa abaixo e FECHADO. Rota nova que nao aparecer aqui REPROVA o guard
 * (`tests/web/route-cache-policy.test.ts`) — nunca "publica por omissao".
 *
 * Este projeto ja pagou duas levas (#241, #242) por uma regra que tratava
 * ausencia como permissao: o `NOT EXISTS` do sitemap fazia URL sem decisao
 * entrar por omissao. La o preco era posicao no Google. Aqui o preco seria
 * pagina de usuario logado guardada numa CDN e servida para outra pessoa.
 * Errar para `private` nao custa nada; errar para o outro lado custa uma conta.
 *
 * ============================================================================
 * AS TRES CLASSES
 * ============================================================================
 *  - `private`        — autenticada, personalizada, ou operacional. NUNCA
 *                       cacheavel. Continua emitindo `no-store` (que e o
 *                       comportamento CORRETO para ela).
 *  - `public-static`  — publica pura, guardada como ROTA: prerenderizada no
 *                       build, ou gerada na primeira visita e mantida pela
 *                       janela do `revalidate` (ISR).
 *  - `public-dynamic` — publica, renderizada A CADA requisicao. Nao vaza dado
 *                       pessoal; simplesmente nao pode (ou nao deve) ser
 *                       guardada. Tres motivos distintos aparecem hoje, e cada
 *                       entrada diz qual e o seu:
 *                         (a) a resposta depende de `searchParams` (`/pt/explorar`);
 *                         (b) envelhecer e proibido (despublicacao editorial);
 *                         (c) o RELEASE NAO CONSEGUE PRERENDERIZAR o caminho —
 *                             ver abaixo.
 *
 * ============================================================================
 * (c) POR QUE A HOME E AS LISTAGENS FICARAM DINAMICAS, MEDIDO
 * ============================================================================
 * Elas nao dependem de requisicao nenhuma — depois desta leva o `?ranking=`
 * virou controle de cliente. Mesmo assim continuam `public-dynamic`, e o motivo
 * e do DEPLOY, nao do codigo: um caminho FIXO elegivel a cache de rota e
 * prerenderizado durante o `next build`, e o `Dockerfile` roda o build sem
 * `DATABASE_URL` e sem env publica, de proposito. Tentado nesta leva:
 *
 *   Error occurred prerendering page "/pt/filmes"
 *   PrismaClientInitializationError: Environment variable not found: DATABASE_URL
 *   Export encountered an error on /pt/filmes/page, exiting the build.
 *
 * As FICHAS (`/pt/filmes/[slug]` e irmas) escapam disso porque declaram
 * `generateStaticParams` devolvendo `[]`: nada e prerenderizado no build, cada
 * URL nasce na primeira visita e entao e guardada. Sao 67 mil das 110 mil URLs
 * do sitemap, e e nelas que o rastreamento acontece.
 *
 * O que substituiu o cache de rota na home e nas listagens foi consulta menor:
 * elas liam o catalogo inteiro para exibir 24 cards. Medido no validador com
 * 12 mil entidades: `/pt/filmes/` caiu de dezenas de milhares de linhas por
 * requisicao para 289, e de segundos para ~100 ms.
 *
 * PARA O DONO: dar cache de rota a esses seis caminhos exige um build com banco
 * alcancavel (ou um passo de prerender pos-deploy). E decisao de deploy.
 *
 * NAO EXISTE HOJE uma quarta situacao — "publica mas personalizada no
 * SERVIDOR". Nenhum arquivo de `apps/web` importa `next/headers`: nenhum server
 * component consegue ler cookie/sessao, e portanto nenhum HTML do servidor
 * carrega estado de usuario. A personalizacao real (bookmark do card, "seu mes
 * em numeros") ja e boundary de CLIENTE, buscada em `/api/me/**` depois do
 * carregamento. `tests/web/route-cache-policy.test.ts` trava essa ausencia: se
 * alguem introduzir `next/headers` em `apps/web`, o guard reprova e obriga a
 * reclassificacao antes de qualquer cache.
 */

/** Classe de politica de cache de uma rota. */
export type RouteCacheClass = "private" | "public-static" | "public-dynamic";

export interface RouteCachePolicy {
  /** Classe da rota. */
  readonly cls: RouteCacheClass;
  /**
   * Janela de revalidacao em segundos.
   *
   * `null` em `public-static` significa PRERENDERIZADA NO BUILD (o Next serve
   * com `s-maxage` de um ano e quem revalida e o proprio deploy). Um numero
   * significa ISR: gerada na primeira visita e mantida por essa janela.
   * Sempre `null` em `private` e `public-dynamic` — la nao ha nada guardado.
   */
  readonly revalidateSeconds: number | null;
  /** Por que esta rota esta nesta classe. Sem frase, sem entrada. */
  readonly reason: string;
}

/**
 * Janela das superficies de CATALOGO puro (pessoas, em breve, onde assistir,
 * fichas de filme/serie/pessoa).
 *
 * Uma hora e a janela que as fichas ja declaravam desde 2026-07 (`export const
 * revalidate = 3600`) e que ficou INERTE ate esta leva — ver o cabecalho de
 * `generateStaticParams` nas rotas de detalhe. O catalogo se move em ciclos de
 * horas/dias (ver `.claude/rules/ingestion.md`), nao de segundos.
 *
 * CONSEQUENCIA A DECLARAR: uma decisao `noindex` aplicada por
 * `catalog index-decisions --apply` passa a levar ate uma hora para aparecer no
 * `<meta robots>` da ficha. Antes aparecia na requisicao seguinte — porque a
 * rota nunca chegou a ser cacheada. Isso e aceitavel para SEO (o Google recrawl
 * e muito mais lento que uma hora) mas nao e invisivel, e por isso esta escrito.
 */
export const CATALOG_SURFACE_REVALIDATE_SECONDS = 3600;

/**
 * Paginas SEM banco: o documento legal e os dois aliases de entrada.
 *
 * Elas ja eram prerenderizadas no build antes desta leva e continuam sendo — nao
 * leem PostgreSQL, entao o build sem `DATABASE_URL` as alcanca. O Next as serve
 * com `s-maxage` de um ano, e a revalidacao aqui e o proprio deploy.
 */
export const BUILD_PRERENDERED = null;

function priv(reason: string): RouteCachePolicy {
  return { cls: "private", revalidateSeconds: null, reason };
}
function publicDynamic(reason: string): RouteCachePolicy {
  return { cls: "public-dynamic", revalidateSeconds: null, reason };
}
function publicStatic(
  revalidateSeconds: number | null,
  reason: string,
): RouteCachePolicy {
  return { cls: "public-static", revalidateSeconds, reason };
}

const AUTH_SHELL = priv(
  "area do titular: shell noindex cujo conteudo vem de /api/me|/api/auth no cliente",
);
const AUTH_API = priv("rota de autenticacao/identidade: resposta depende da credencial");

/**
 * O REGISTRO. Chave = id de rota do App Router, exatamente como o Next o
 * imprime em `.next/app-path-routes-manifest.json` e na tabela do build.
 *
 * O guard compara este mapa com o BUILD REAL (nao com o texto do fonte): rota
 * que existe no build e falta aqui reprova; entrada aqui sem rota no build
 * reprova; e `public-static` que o Next NAO colocou no prerender-manifest
 * reprova — porque ali a intencao existiria e o cache nao.
 */
export const ROUTE_CACHE_POLICY: Readonly<Record<string, RouteCachePolicy>> = {
  // ---------------------------------------------------------------- interno
  "/_not-found": publicStatic(
    BUILD_PRERENDERED,
    "404 do App Router: casca estatica, sem dado — o Next a prerenderiza no build",
  ),

  // ------------------------------------------------------- API autenticada
  "/api/account/close": AUTH_API,
  "/api/account/consent": AUTH_API,
  "/api/account/export": AUTH_API,
  "/api/account/privacy": AUTH_API,
  "/api/account/profile": AUTH_API,
  "/api/auth/email-verification/confirm": AUTH_API,
  "/api/auth/email-verification/request": AUTH_API,
  "/api/auth/login": AUTH_API,
  "/api/auth/logout": AUTH_API,
  "/api/auth/logout-all": AUTH_API,
  "/api/auth/password-change": AUTH_API,
  "/api/auth/password-reset/confirm": AUTH_API,
  "/api/auth/password-reset/request": AUTH_API,
  "/api/auth/session": AUTH_API,
  "/api/auth/signup": AUTH_API,
  "/api/me/episodes": AUTH_API,
  "/api/me/episodes/bulk": AUTH_API,
  "/api/me/history": AUTH_API,
  "/api/me/imports": AUTH_API,
  "/api/me/imports/[id]": AUTH_API,
  "/api/me/imports/[id]/apply": AUTH_API,
  "/api/me/imports/[id]/cancel": AUTH_API,
  "/api/me/library": AUTH_API,
  "/api/me/lists": AUTH_API,
  "/api/me/lists/[id]": AUTH_API,
  "/api/me/lists/[id]/delete": AUTH_API,
  "/api/me/lists/[id]/items": AUTH_API,
  "/api/me/lists/[id]/items/[itemId]/remove": AUTH_API,
  "/api/me/lists/[id]/reorder": AUTH_API,
  "/api/me/ratings": AUTH_API,
  "/api/me/ratings/remove": AUTH_API,
  "/api/me/series-progress/[id]": AUTH_API,
  "/api/me/watch-state": AUTH_API,
  "/api/me/watch-state/remove": AUTH_API,

  // ------------------------------------------------- API publica/operacional
  "/api/catalog/summary": priv(
    "diagnostico operacional: numero do catalogo agora, nunca de ha 5 minutos",
  ),
  "/api/health": priv("health check: resposta guardada mentiria sobre o estado atual"),
  "/api/internal/entity-resolve": priv(
    "rota interna autenticada por credencial de maquina (ADR 0019)",
  ),
  "/api/newsletter": priv("recebe dado pessoal (e-mail) por POST"),
  "/api/seo/redirect": priv(
    "consulta de redirect chamada pelo middleware a cada requisicao; cache aqui congelaria a tabela `redirects`",
  ),

  // ------------------------------------------------------------- dev only
  "/dev/ad-preview": publicStatic(BUILD_PRERENDERED, "harness de desenvolvimento, fora do produto"),
  "/dev/movie-page-preview": publicStatic(BUILD_PRERENDERED, "harness de desenvolvimento, fora do produto"),

  // ---------------------------------------------------------------- assets
  "/media/editorial/[...key]": priv(
    "bytes de midia editorial: a propria rota decide seu Cache-Control (200 = immutable, 404 = no-store)",
  ),

  // ------------------------------------------------------- SEO (fora de escopo)
  // #241/#242 acabaram de subir sobre estas quatro. Nao sao tocadas nesta leva.
  "/news-sitemap.xml": publicDynamic("sitemap paginado no banco (#241/#242) — fora de escopo"),
  "/robots.txt": publicDynamic("gate de indexacao por ambiente — fora de escopo"),
  "/sitemap.xml": publicDynamic("sitemap paginado no banco (#241/#242) — fora de escopo"),
  "/sitemaps/[shard]": publicDynamic("shard paginado no banco (#241/#242) — fora de escopo"),

  // ----------------------------------------------------- aliases de entrada
  "/filmes": publicStatic(BUILD_PRERENDERED, "alias que redireciona para /pt/filmes/"),
  "/series": publicStatic(BUILD_PRERENDERED, "alias que redireciona para /pt/series/"),

  // -------------------------------------------------------- area do titular
  "/pt/conta": AUTH_SHELL,
  "/pt/conta/privacidade": AUTH_SHELL,
  "/pt/criar-conta": AUTH_SHELL,
  "/pt/entrar": AUTH_SHELL,
  "/pt/historico": AUTH_SHELL,
  "/pt/importar": AUTH_SHELL,
  "/pt/listas": AUTH_SHELL,
  "/pt/listas/[id]": AUTH_SHELL,
  "/pt/minha-lista": AUTH_SHELL,
  "/pt/recuperar-senha": AUTH_SHELL,
  "/pt/redefinir-senha": AUTH_SHELL,
  "/pt/tracker": AUTH_SHELL,
  "/pt/verificar-email": priv(
    "confirma token de e-mail que chega na URL: guardar essa resposta e guardar o token",
  ),

  // ------------------ publica, dinamica por LIMITE DE BUILD (motivo (c) acima)
  // Estas seis nao dependem de requisicao nenhuma. Elas continuam dinamicas
  // porque um caminho FIXO com cache de rota e prerenderizado no `next build`, e
  // o release constroi sem `DATABASE_URL`. O que as tirou dos 3-4 s nao foi
  // cache: foi a consulta parar de varrer o catalogo.
  "/pt": publicDynamic(
    "home: caminho fixo — o build do release nao alcanca o banco para prerenderizar",
  ),
  "/pt/filmes": publicDynamic(
    "listagem de filmes: caminho fixo — o build do release nao alcanca o banco",
  ),
  "/pt/series": publicDynamic(
    "listagem de series: caminho fixo — o build do release nao alcanca o banco",
  ),
  "/pt/pessoas": publicDynamic(
    "listagem de pessoas: caminho fixo — o build do release nao alcanca o banco",
  ),
  "/pt/em-breve": publicDynamic(
    "mais aguardados: caminho fixo — o build do release nao alcanca o banco",
  ),
  "/pt/onde-assistir": publicDynamic(
    "hub de streaming: caminho fixo — o build do release nao alcanca o banco",
  ),

  // ------------------------------------------------------ publica cacheavel
  "/pt/filmes/[slug]": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "ficha de filme: a janela de 3600 s que a rota ja declarava desde 2026-07",
  ),
  "/pt/filmes/[slug]/imagens": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "galeria de imagens do filme: midia de catalogo, sem dado pessoal",
  ),
  "/pt/filmes/[slug]/videos": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "galeria de videos do filme: midia de catalogo, sem dado pessoal",
  ),
  "/pt/series/[slug]": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "ficha de serie: a janela de 3600 s que a rota ja declarava desde 2026-07",
  ),
  "/pt/series/[slug]/imagens": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "galeria de imagens da serie: midia de catalogo, sem dado pessoal",
  ),
  "/pt/series/[slug]/videos": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "galeria de videos da serie: midia de catalogo, sem dado pessoal",
  ),
  "/pt/series/[slug]/temporadas/[season]": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "ficha de temporada: catalogo puro, mesma janela da serie",
  ),
  "/pt/series/[slug]/temporadas/[season]/episodios/[episode]": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "ficha de episodio: catalogo puro, mesma janela da temporada",
  ),
  "/pt/series/[slug]/temporadas/[season]/episodios/[episode]/imagens": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "galeria de imagens do episodio: midia de catalogo, sem dado pessoal",
  ),
  "/pt/pessoas/[slug]": publicStatic(
    CATALOG_SURFACE_REVALIDATE_SECONDS,
    "ficha de pessoa: a janela de 3600 s que a rota ja declarava desde 2026-07",
  ),
  "/pt/creditos-de-dados": publicStatic(BUILD_PRERENDERED, "documento legal, sem banco"),
  "/pt/privacidade": publicStatic(BUILD_PRERENDERED, "documento legal, sem banco"),
  "/pt/termos": publicStatic(BUILD_PRERENDERED, "documento legal, sem banco"),

  // ---------------------------------------------- publica, mas nao cacheavel
  "/pt/explorar": publicDynamic(
    "busca: a resposta depende de `?q=` — legitimamente por requisicao",
  ),
  "/pt/noticias": publicDynamic(
    "listagem editorial: DESPUBLICACAO DE EMERGENCIA depende de leitura por requisicao — docs/operations/editorial-unpublish-emergency.md",
  ),
  "/pt/noticias/[slug]": publicDynamic(
    "materia: DESPUBLICACAO DE EMERGENCIA depende de leitura por requisicao — rebaixou no banco, 404 na requisicao seguinte",
  ),
};

/** Rotas declaradas, ordenadas — util para relatorio e para o guard. */
export function declaredRoutes(): string[] {
  return Object.keys(ROUTE_CACHE_POLICY).sort();
}

/**
 * Politica de uma rota. Rota desconhecida NAO tem default: quem chama decide o
 * que fazer com `undefined`, e o guard reprova antes de chegar aqui.
 */
export function policyFor(route: string): RouteCachePolicy | undefined {
  return ROUTE_CACHE_POLICY[route];
}

/** True quando a classe da rota permite HTML guardado por servidor/CDN. */
export function isCacheableClass(cls: RouteCacheClass): boolean {
  return cls === "public-static";
}
