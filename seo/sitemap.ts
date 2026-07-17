/**
 * seo/sitemap.ts — Builder do sitemap segmentado por idioma da Cinerie.
 *
 * INVARIANTE (regra 3 — Zero API externa no render):
 *   O sitemap e gerado EXCLUSIVAMENTE a partir do PostgreSQL/cache local da
 *   Cinerie. NUNCA consultamos TMDB, RapidAPI, Rotten Tomatoes ou qualquer
 *   fornecedor externo para montar o sitemap. As rotas publicaveis ja foram
 *   materializadas no banco (tabelas `slugs`, `redirects`,
 *   `page_indexability_decisions`) por workers offline.
 *
 * SEGMENTACAO POR IDIOMA:
 *   Cada locale tem seu proprio segmento de sitemap. No MVP, apenas `pt-BR`
 *   publica (regra 7). Locales `en`/`es` nascem em draft/noindex e, portanto,
 *   NAO entram no sitemap ate revisao humana — o filtro acontece via
 *   `page_indexability_decisions.decision = 'index'`.
 *
 * GATE ANTI-THIN (regras 5 e 6):
 *   Uma URL so entra no sitemap se a decisao de indexabilidade for `index`.
 *   Paginas finas (`noindex`), rascunhos (`draft`), obsoletas (`stale`) ou
 *   bloqueadas por licenca (`blocked`) NUNCA aparecem aqui.
 */

/**
 * Locales suportados pela Cinerie. No MVP somente `pt-BR` e publicavel; os
 * demais existem para preparar a expansao multilingue.
 */
export type SitemapLocale = 'pt-BR' | 'en' | 'es';

/**
 * Frequencia de atualizacao sugerida ao crawler (campo `changefreq` do
 * protocolo de sitemap).
 */
export type SitemapChangeFreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

/**
 * Uma entrada (URL) do sitemap, ja resolvida a partir do banco local.
 */
export interface SitemapEntry {
  /** URL absoluta canonica (ex.: https://cinerie.com/pt/filmes/{slug}/). */
  readonly loc: string;
  /** Locale ao qual a URL pertence (define o segmento do sitemap). */
  readonly locale: SitemapLocale;
  /** Data ISO-8601 da ultima atualizacao do conteudo (vinda do banco). */
  readonly lastmod?: string;
  /** Frequencia de mudanca sugerida ao crawler. */
  readonly changefreq?: SitemapChangeFreq;
  /** Prioridade relativa entre 0.0 e 1.0. */
  readonly priority?: number;
}

/**
 * Opcoes de construcao do sitemap.
 */
export interface BuildSitemapOptions {
  /**
   * Locale alvo do segmento. Quando omitido, a Fase 8 devera iterar por todos
   * os locales publicaveis e emitir um sitemap-index apontando para cada
   * segmento por idioma.
   */
  readonly locale?: SitemapLocale;
  /** Origem (scheme + host) usada para montar URLs absolutas. */
  readonly origin?: string;
}

/**
 * Constroi a lista de entradas do sitemap para um locale.
 *
 * Contrato (a ser implementado na Fase 8):
 *   - Ler SOMENTE do PostgreSQL/cache local (tabelas `slugs`,
 *     `page_indexability_decisions`), nunca de API externa.
 *   - Filtrar por `decision = 'index'` e por licenca permitida
 *     (`display_allowed = true`).
 *   - Agrupar por `locale` para produzir sitemaps segmentados por idioma.
 *
 * Por enquanto retorna `[]` — esta e a fundacao (Fase 0), sem banco real.
 *
 * @param _options Opcoes de locale/origin (ignoradas no stub).
 * @returns Lista de entradas do sitemap (vazia nesta fase).
 */
export function buildSitemap(_options: BuildSitemapOptions = {}): SitemapEntry[] {
  // TODO(Fase 8): consultar PostgreSQL/cache local, aplicar gate de
  // indexabilidade/licenca e materializar URLs absolutas por locale.
  return [];
}
