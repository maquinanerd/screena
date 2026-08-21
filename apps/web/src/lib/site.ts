/**
 * site.ts - Helpers de URL publica/canonica do Cinerie.
 *
 * Rotas puras vivem em `routes.ts` para poderem ser importadas no cliente.
 * Este modulo pode ler env porque monta metadata, canonical, sitemap e JSON-LD
 * no lado servidor.
 */

import { episodePath, moviePath, seasonPath, seriesPath } from "./routes";

export {
  detailPath,
  episodePath,
  EPISODES_SEGMENT,
  EXPLORE_PATH,
  HOME_PATH,
  // As galerias entram no MESMO barril das demais rotas: quem monta URL
  // publica importa de um lugar so.
  IMAGES_SEGMENT,
  imagesGalleryPath,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  parseRouteNumber,
  PEOPLE_INDEX_PATH,
  PRIVACY_PATH,
  PT_LOCALE_SEGMENT,
  SEASONS_SEGMENT,
  SERIES_INDEX_PATH,
  TERMS_PATH,
  VIDEOS_SEGMENT,
  videosGalleryPath,
  moviePath,
  seasonPath,
  seriesPath,
} from "./routes";

/** Variavel de origem publica desta instalacao. */
export const PUBLIC_SITE_URL_ENV = "CINERIE_PUBLIC_SITE_URL";

/** Flag explicita que permite indexacao somente na origem oficial. */
export const PUBLIC_INDEXING_ENABLED_ENV = "CINERIE_PUBLIC_INDEXING_ENABLED";

/** Flag que liga a faixa de newsletter do rodape (ver `SiteUrlEnv`). */
export const NEWSLETTER_ENABLED_ENV = "CINERIE_NEWSLETTER_ENABLED";

/**
 * Nomes LEGADOS das mesmas variaveis (marca anterior).
 *
 * Continuam sendo lidos como FALLBACK: renomear a env quebraria todo deploy ja
 * configurado (EasyPanel/Dockerfile) no instante do merge — e o gate de
 * rebranding nao pode alterar comportamento. Precedencia: o nome novo vence; o
 * antigo so vale enquanto o nome novo nao estiver definido. Remover apos migrar
 * a configuracao dos ambientes (gate de infraestrutura).
 */
export const LEGACY_PUBLIC_SITE_URL_ENV = "THE_SCREEN_PUBLIC_SITE_URL";
export const LEGACY_PUBLIC_INDEXING_ENABLED_ENV = "THE_SCREEN_PUBLIC_INDEXING_ENABLED";

/** Origin publico canonico oficial (sem barra final). */
export const OFFICIAL_SITE_URL = "https://cinerie.com";

/** Origin local usado em exemplos/dev quando configurado por env. */
export const LOCAL_SITE_URL = "http://localhost:3000";

export interface SiteUrlEnv {
  readonly CINERIE_PUBLIC_SITE_URL?: string;
  readonly CINERIE_PUBLIC_INDEXING_ENABLED?: string;
  /**
   * Kill switch PROPRIO dos documentos legais (`/pt/termos/`, `/pt/privacidade/`).
   *
   * Existe porque as duas paginas terminam ANTES do catalogo: elas sao um
   * bloqueador de lancamento (o aceite do cadastro aponta para elas) e nao
   * dependem de dado sincronizado nem de licenca de terceiro. Sem uma chave
   * propria, a unica forma de indexa-las seria ligar
   * `CINERIE_PUBLIC_INDEXING_ENABLED`, que abre o site INTEIRO.
   */
  readonly CINERIE_LEGAL_DOCS_INDEXING_ENABLED?: string;
  /**
   * Liga a faixa de NEWSLETTER do rodape.
   *
   * Desligada por default, e nao por cautela generica: nao existe modelo de
   * inscricao no schema, entao com ela ligada o formulario so poderia mentir
   * (`200 OK` sem guardar) ou errar sempre. Um formulario que nunca consegue ter
   * sucesso e pior que ausencia — o leitor digita o e-mail, aperta, e recebe erro.
   *
   * NAO e um kill switch de indexacao: nao tem relacao com
   * `CINERIE_PUBLIC_INDEXING_ENABLED` nem com origem oficial. E uma flag de
   * capacidade — "ha onde guardar?" —, por isso vale em qualquer ambiente.
   *
   * O QUE PRECISA EXISTIR ANTES DE LIGAR: docs/frontend/newsletter.md.
   */
  readonly CINERIE_NEWSLETTER_ENABLED?: string;
  /** Legado (marca anterior) — lido so como fallback. */
  readonly THE_SCREEN_PUBLIC_SITE_URL?: string;
  readonly THE_SCREEN_PUBLIC_INDEXING_ENABLED?: string;
  readonly NODE_ENV?: string;
  readonly VERCEL_ENV?: string;
}

function readTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parser booleano EXPLICITO e FAIL-CLOSED para flags de env.
 *
 * So `"true"` e `"1"` ligam (sem diferenciar maiuscula/minuscula, com trim).
 * `"false"`, `"0"`, vazio, ausente ou QUALQUER valor invalido desligam. Nao ha
 * "verdadeiro por presenca": `FLAG=false` desliga, como qualquer operador espera.
 *
 * Existe porque a leitura anterior era `flag !== "1"`, que rejeitava silenciosa-
 * mente `"true"` — um operador que escrevesse `=true` DESLIGARIA a indexacao sem
 * perceber (e vice-versa nao havia: nada ligava por engano). Fail-closed e
 * intencional: na duvida, nao indexa.
 */
export function parseBooleanEnvFlag(raw: string | undefined): boolean {
  const value = readTrimmed(raw);
  if (value === null) return false;
  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1";
}

/**
 * Flag GLOBAL de indexacao desta instalacao (o kill switch).
 *
 * Precedencia (a decisao do operador vence o legado assado na imagem):
 *   1. CINERIE_PUBLIC_INDEXING_ENABLED — se DEFINIDA, decide sozinha (mesmo
 *      vazia: vazio e invalido e resolve para `false`, nunca cai no legado);
 *   2. THE_SCREEN_PUBLIC_INDEXING_ENABLED (legado, ver LEGACY_*);
 *   3. `false` (default obrigatorio).
 *
 * A precedencia por DEFINICAO (nao por "valor nao-vazio") e deliberada: o
 * Dockerfile assa `THE_SCREEN_PUBLIC_INDEXING_ENABLED=1` na imagem, entao cair
 * no legado quando o nome novo esta definido-porem-vazio LIGARIA a indexacao
 * contra a vontade explicita de quem setou o nome novo.
 */
export function isPublicIndexingEnabled(env: SiteUrlEnv = process.env): boolean {
  const raw =
    env.CINERIE_PUBLIC_INDEXING_ENABLED ?? env.THE_SCREEN_PUBLIC_INDEXING_ENABLED;
  return parseBooleanEnvFlag(raw);
}

/**
 * Normaliza um origin publico seguro. Aceita apenas http/https e origin puro
 * (sem path, query, hash, usuario ou senha). Remove barra final via URL.origin.
 */
export function normalizeSiteOrigin(value: string | null | undefined): string | null {
  const raw = readTrimmed(value ?? undefined);
  if (raw === null) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;

  return url.origin;
}

export function configuredSiteUrl(env: SiteUrlEnv = process.env): string | null {
  // Nome novo vence; o legado so vale enquanto o novo nao estiver definido.
  return normalizeSiteOrigin(env.CINERIE_PUBLIC_SITE_URL ?? env.THE_SCREEN_PUBLIC_SITE_URL);
}

/**
 * Resolve a origem usada por canonical/metadata. Producao oficial deve definir
 * CINERIE_PUBLIC_SITE_URL=https://cinerie.com; dev/staging/preview devem
 * definir sua propria origem para nao emitirem canonical falso de producao.
 */
export function resolveSiteUrl(env: SiteUrlEnv = process.env): string {
  return configuredSiteUrl(env) ?? OFFICIAL_SITE_URL;
}

/** Origin publico desta instalacao (sem barra final). */
export const SITE_URL = resolveSiteUrl(process.env);

export function isOfficialSiteUrl(siteUrl: string): boolean {
  return normalizeSiteOrigin(siteUrl) === OFFICIAL_SITE_URL;
}

/**
 * A SUPERFICIE e a producao oficial? (origem canonica + ambiente de producao)
 *
 * Metade do gate de indexacao, sem a flag. Extraido para que um segundo kill
 * switch (o dos documentos legais) possa reusar EXATAMENTE as mesmas condicoes
 * de ambiente sem reimplementa-las: duas copias divergiriam na primeira vez que
 * alguem adicionasse uma condicao aqui, e a copia esquecida indexaria em
 * staging.
 *
 * Nao decide nada sozinha — nenhuma flag e consultada aqui.
 */
function isOfficialProductionSurface(env: SiteUrlEnv): boolean {
  if (configuredSiteUrl(env) !== OFFICIAL_SITE_URL) return false;

  const nodeEnv = readTrimmed(env.NODE_ENV)?.toLowerCase() ?? null;
  if (nodeEnv !== null && nodeEnv !== "production") return false;

  const vercelEnv = readTrimmed(env.VERCEL_ENV)?.toLowerCase() ?? null;
  if (vercelEnv !== null && vercelEnv !== "production") return false;

  return true;
}

/**
 * Robots so pode liberar indexacao quando a origem configurada e exatamente a
 * oficial, a flag explicita esta ligada e o ambiente nao se declara
 * preview/dev/test.
 */
export function isOfficialIndexableEnvironment(
  env: SiteUrlEnv = process.env,
): boolean {
  if (!isPublicIndexingEnabled(env)) return false;
  return isOfficialProductionSurface(env);
}

/**
 * Kill switch PROPRIO dos documentos legais.
 *
 * Mesmo parser fail-closed das demais flags: so `"true"`/`"1"` ligam; ausente,
 * vazio ou invalido desliga.
 */
export function isLegalDocsIndexingEnabled(
  env: SiteUrlEnv = process.env,
): boolean {
  return parseBooleanEnvFlag(env.CINERIE_LEGAL_DOCS_INDEXING_ENABLED);
}

/**
 * A faixa de newsletter do rodape pode renderizar?
 *
 * Mesmo parser fail-closed das demais flags: so `"true"`/`"1"` ligam; ausente,
 * vazio ou invalido desliga. Fail-closed aqui significa "na duvida, nao promete
 * uma inscricao que ninguem vai guardar".
 *
 * DELIBERADAMENTE independente das flags de indexacao: aquelas perguntam "este
 * ambiente pode aparecer no Google?"; esta pergunta "existe onde guardar?". Sao
 * eixos diferentes, e amarrar os dois faria a newsletter acender em producao so
 * porque a indexacao foi ligada.
 */
export function isNewsletterEnabled(env: SiteUrlEnv = process.env): boolean {
  return parseBooleanEnvFlag(env.CINERIE_NEWSLETTER_ENABLED);
}

/**
 * O ambiente pode indexar os DOCUMENTOS LEGAIS?
 *
 * Mesmas condicoes de superficie do gate geral (origem oficial + producao), mas
 * lendo a flag propria. E deliberadamente INDEPENDENTE de
 * `CINERIE_PUBLIC_INDEXING_ENABLED`: o objetivo e poder indexar Termos e
 * Privacidade enquanto o catalogo segue fechado.
 */
export function isOfficialLegalDocsIndexableEnvironment(
  env: SiteUrlEnv = process.env,
): boolean {
  if (!isLegalDocsIndexingEnabled(env)) return false;
  return isOfficialProductionSurface(env);
}

/** Forma de `robots` do Next para metadata de pagina. */
export interface PageRobots {
  readonly index: boolean;
  readonly follow: boolean;
}

const NOINDEX: PageRobots = { index: false, follow: false };

/**
 * PONTO UNICO de decisao do `<meta robots>` de QUALQUER pagina publica.
 *
 * Incidente de producao (2026-07-16): `CINERIE_PUBLIC_INDEXING_ENABLED=false` e o
 * HTML seguia emitindo `index, follow`. Causa: a flag global so era consultada
 * por `app/robots.ts`; nenhuma pagina a lia. Todo `<meta robots>` saia direto de
 * `page_indexability_decisions`, que nao conhece env — logo o kill switch nao
 * tinha efeito nenhum sobre as paginas.
 *
 * Contrato (AND de dois gates, nesta ordem):
 *  1. o AMBIENTE pode indexar? (`isOfficialIndexableEnvironment`: flag ligada +
 *     origem oficial + NODE_ENV/VERCEL_ENV de producao). Se nao, `noindex,nofollow`
 *     — sem excecao, sem fallback;
 *  2. so entao a decisao da ENTIDADE decide (`page_indexability_decisions` via
 *     `shouldIndex`). A flag global NUNCA torna uma entidade indexavel: ela so
 *     pode derrubar.
 *
 * Usar o MESMO gate de `app/robots.ts` mantem `<meta robots>`, `robots.txt` e
 * sitemap coerentes por construcao — eles nunca podem discordar.
 *
 * Travado por `tests/governance/no-raw-robots-metadata.test.ts`: nenhuma pagina
 * pode montar `robots:` na mao.
 */
export function publicRobots(
  shouldIndex: boolean,
  env: SiteUrlEnv = process.env,
): PageRobots {
  if (!isOfficialIndexableEnvironment(env)) return NOINDEX;
  return shouldIndex ? { index: true, follow: true } : NOINDEX;
}

/**
 * `<meta robots>` dos DOIS documentos legais (`/pt/termos/`, `/pt/privacidade/`).
 *
 * POR QUE UM HELPER PROPRIO, E NAO `publicRobots(true)`.
 *
 * As duas paginas sao um bloqueador de lancamento: o aceite obrigatorio do
 * cadastro aponta para elas, e o texto ficou pronto (#127 + #133) muito antes do
 * catalogo. Com `publicRobots(true)` a unica maneira de indexa-las e ligar
 * `CINERIE_PUBLIC_INDEXING_ENABLED` — que abre o site INTEIRO, com o catalogo
 * ainda incompleto. Uma decisao de indexacao (invariante 5) e humana e
 * registrada; ela nao pode vir de carona.
 *
 * Contrato (OR de dois gates, ambos exigindo producao oficial):
 *  1. o site inteiro pode indexar (`isOfficialIndexableEnvironment`) — entao os
 *     documentos legais indexam junto, como qualquer pagina; OU
 *  2. so os documentos legais foram liberados
 *     (`isOfficialLegalDocsIndexableEnvironment`).
 *
 * E OR, nao AND, de proposito: a chave dos legais **adiciona** uma permissao,
 * nunca remove uma que ja existe. Com o site aberto, esquecer de ligar
 * `CINERIE_LEGAL_DOCS_INDEXING_ENABLED` nao pode desindexar a Politica de
 * Privacidade.
 *
 * `robots.txt` acompanha: `app/robots.ts` libera o crawl DESTES DOIS caminhos
 * quando (2) vale sem (1). Sem isso o gate seria inerte — o meta diria `index` e
 * o `Disallow: /` impediria o crawler de chegar a ler o meta.
 */
export function legalDocRobots(env: SiteUrlEnv = process.env): PageRobots {
  const allowed =
    isOfficialIndexableEnvironment(env) ||
    isOfficialLegalDocsIndexableEnvironment(env);
  return allowed ? { index: true, follow: true } : NOINDEX;
}

/**
 * Mesmo gate de `publicRobots`, para paginas que JA resolveram um `robots`
 * completo a partir da decisao persistida (`seo.robots`).
 *
 * Preserva a nuance da decisao quando o ambiente pode indexar — inclusive
 * `noindex,follow`, que `resolvePageSeo` emite para entidade sem decisao vigente
 * (fail-closed, mas ainda seguindo links). Quando o ambiente NAO pode indexar,
 * colapsa tudo para `noindex,nofollow`.
 */
export function gatePublicRobots(
  robots: PageRobots,
  env: SiteUrlEnv = process.env,
): PageRobots {
  if (!isOfficialIndexableEnvironment(env)) return NOINDEX;
  return robots;
}

/** URL canonica absoluta da pagina de um filme. */
export function movieCanonicalUrl(slug: string): string {
  return `${SITE_URL}${moviePath(slug)}`;
}

/** URL canonica absoluta da pagina de uma serie, ou `null` para slug invalido. */
export function seriesCanonicalUrl(slug: string): string | null {
  const path = seriesPath(slug);
  return path === null ? null : `${SITE_URL}${path}`;
}

/** URL canonica absoluta da pagina de uma temporada, ou `null` se invalida. */
export function seasonCanonicalUrl(
  seriesSlug: string,
  seasonNumber: number,
): string | null {
  const path = seasonPath(seriesSlug, seasonNumber);
  return path === null ? null : `${SITE_URL}${path}`;
}

/** URL canonica absoluta da pagina de um episodio, ou `null` se invalida. */
export function episodeCanonicalUrl(
  seriesSlug: string,
  seasonNumber: number,
  episodeNumber: number,
): string | null {
  const path = episodePath(seriesSlug, seasonNumber, episodeNumber);
  return path === null ? null : `${SITE_URL}${path}`;
}

/**
 * URL canonica absoluta de um caminho publico interno.
 *
 * Regras:
 *  - rejeita path externo (`https://...`, `//host`) e path que nao comece em `/`;
 *  - colapsa barras duplicadas internas (`/pt//filmes/` -> `/pt/filmes/`);
 *  - garante barra final (padrao `trailingSlash: true` do app);
 *  - prefixa sempre a origem publica resolvida por env.
 *
 * Retorna `null` para entrada invalida; nunca gera URL fora do origin escolhido.
 */
export function canonicalPublicUrl(
  path: string,
  siteUrl: string = SITE_URL,
): string | null {
  const origin = normalizeSiteOrigin(siteUrl);
  if (origin === null) return null;

  const value = path.trim();
  if (value === "" || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("://")) return null;

  const collapsed = value.replace(/\/{2,}/g, "/");
  const withTrailing = collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
  return `${origin}${withTrailing}`;
}
