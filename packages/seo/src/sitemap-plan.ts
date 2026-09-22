/**
 * sitemap-plan.ts — Arquitetura PURA e escalavel de sitemap.
 *
 * Prompt 3 (§5): sitemap index + separacao por idioma publicado + separacao por
 * tipo + paginacao para o limite de URLs + `lastModified` a partir de fatos
 * persistidos + exclusao coerente com a indexabilidade.
 *
 * Este modulo NAO le banco nem gera XML: ele PLANEJA os shards a partir de uma
 * lista de URLs ja filtradas (`includeInSitemap === true`, resolvidas pela
 * FONTE UNICA `resolvePageSeo`). Cada shard e um par (idioma, tipo, pagina) com
 * no maximo `maxPerShard` URLs. O `lastmod` de um shard e o maior `lastmod` das
 * suas URLs (ou null quando nenhuma tem data confiavel).
 *
 * PURO: sem rede, banco, IO, `Date` ou `Math.random`.
 */

/** Limite duro do protocolo de sitemap (sitemaps.org): 50.000 URLs por arquivo. */
export const SITEMAP_PROTOCOL_URL_LIMIT = 50_000;

/**
 * URLs por ARQUIVO de sitemap que a Cinerie gera — abaixo do limite do protocolo,
 * de proposito.
 *
 * Ate 21/09/2026 era o proprio limite do protocolo. Medido em producao nesse dia,
 * o arquivo cheio de filmes tinha 50.000 URLs e 80.683 imagens: 20,4 MB crus,
 * 2,9 MB transferidos, 4,5 s ate o primeiro byte e 7,9 s ate o fim. Dentro do
 * limite, mas pesado: as rotas do sitemap sao dinamicas (cada pedido monta o
 * arquivo do PostgreSQL), e a extensao de imagem dobrou o tamanho por URL.
 *
 * Com 10.000 por arquivo, cada um fica perto de 4 MB crus. O TOTAL de URLs nao
 * muda — muda so em quantos arquivos ele se divide; o indice pode listar ate
 * 50.000 arquivos. Quem segura o total e o teto por tipo
 * (`SITEMAP_TYPE_URL_CEILING`, em `apps/web/src/server/seo/sitemap-index.ts`).
 */
export const SITEMAP_URL_LIMIT = 10_000;

/** URL ja filtrada e pronta para o sitemap. */
export interface SitemapUrl {
  /** URL absoluta canonica (com barra final). */
  loc: string;
  /** Idioma publicado ao qual a URL pertence (ex.: 'pt-BR'). */
  language: string;
  /** Tipo/segmento (ex.: 'movies', 'series', 'people', 'news', 'static'). */
  type: string;
  /** ISO-8601 confiavel do banco, ou null para omitir. */
  lastmod?: string | null;
}

/** Um shard concreto de sitemap (um arquivo). */
export interface SitemapShard {
  language: string;
  type: string;
  /** Pagina 0-based dentro do grupo (idioma, tipo). */
  page: number;
  /** Identificador estavel do shard (para `generateSitemaps`/URL). */
  id: string;
  urls: SitemapUrl[];
  /** Maior `lastmod` das URLs do shard, ou null. */
  lastmod: string | null;
}

export interface PlanSitemapOptions {
  /** Maximo de URLs por shard (default SITEMAP_URL_LIMIT). */
  maxPerShard?: number;
}

function maxLastmod(urls: readonly SitemapUrl[]): string | null {
  let max: string | null = null;
  for (const url of urls) {
    const value = url.lastmod ?? null;
    if (value === null) continue;
    if (max === null || value > max) max = value;
  }
  return max;
}

/** Chave de grupo estavel e deterministica (idioma|tipo). */
function groupKey(language: string, type: string): string {
  return `${language}|${type}`;
}

/**
 * Planeja os shards a partir das URLs ja filtradas.
 *
 * - agrupa por (idioma, tipo) em ordem estavel de primeira aparicao;
 * - pagina cada grupo em blocos de ate `maxPerShard`;
 * - calcula `lastmod` por shard (maior data confiavel; senao null);
 * - id deterministico `sitemap-{language}-{type}-{page}` (idioma normalizado
 *   para minuscula/sem acento tecnico? mantido literal para casar com o slug de
 *   rota — ja e ASCII em pt-BR/en/es).
 */
export function planSitemapShards(
  urls: readonly SitemapUrl[],
  options: PlanSitemapOptions = {},
): SitemapShard[] {
  const maxPerShard =
    options.maxPerShard && options.maxPerShard > 0
      ? options.maxPerShard
      : SITEMAP_URL_LIMIT;

  // Agrupamento preservando ordem de primeira aparicao (deterministico).
  const order: string[] = [];
  const groups = new Map<string, SitemapUrl[]>();
  for (const url of urls) {
    const key = groupKey(url.language, url.type);
    let bucket = groups.get(key);
    if (bucket === undefined) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(url);
  }

  const shards: SitemapShard[] = [];
  for (const key of order) {
    const bucket = groups.get(key) as SitemapUrl[];
    const [language, type] = key.split("|") as [string, string];
    for (let page = 0; page * maxPerShard < bucket.length; page += 1) {
      const slice = bucket.slice(page * maxPerShard, (page + 1) * maxPerShard);
      shards.push({
        language,
        type,
        page,
        id: `sitemap-${language}-${type}-${page}`,
        urls: slice,
        lastmod: maxLastmod(slice),
      });
    }
  }
  return shards;
}

/** Entrada do sitemap-index (um `<sitemap>` apontando para um shard). */
export interface SitemapIndexEntry {
  loc: string;
  lastmod: string | null;
}

/**
 * Monta as entradas do sitemap-index a partir dos shards. `resolveLoc` recebe o
 * id do shard e devolve a URL absoluta do arquivo de sitemap correspondente
 * (ex.: `https://cinerie.com/sitemaps/sitemap-pt-BR-movies-0.xml`).
 */
export function buildSitemapIndex(
  shards: readonly SitemapShard[],
  resolveLoc: (shard: SitemapShard) => string,
): SitemapIndexEntry[] {
  return shards.map((shard) => ({
    loc: resolveLoc(shard),
    lastmod: shard.lastmod,
  }));
}
