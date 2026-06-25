/**
 * seo/robots.ts — Gerador das regras de robots.txt da Screena.
 *
 * PRINCIPIOS:
 *   - Paginas finas (gate anti-thin, regra 5) e rascunhos (`draft`, regra 7)
 *     NUNCA devem ser indexadas. O controle primario disso e o
 *     `<meta name="robots" content="noindex">` por pagina, decidido em
 *     `page_indexability_decisions` — NAO o robots.txt. O robots.txt apenas
 *     bloqueia areas tecnicas/administrativas que nem deveriam ser rastreadas.
 *   - Locales `en`/`es` nascem em draft/noindex (regra 7); seu noindex tambem
 *     vive no nivel de pagina, nao aqui.
 *   - O robots.txt aponta para o sitemap-index gerado por `buildSitemap`,
 *     servido apenas a partir do banco local (regra 3 — Zero API no render).
 *
 * NOTA IMPORTANTE sobre noindex vs Disallow:
 *   Bloquear via `Disallow` impede o rastreamento, mas o Google ainda pode
 *   indexar a URL sem conteudo. Para REMOVER da indexacao usamos `noindex`
 *   no nivel da pagina. Portanto NAO usamos robots.txt para esconder paginas
 *   finas/draft — usamos a meta tag. Aqui so listamos rotas tecnicas.
 */

/**
 * Uma regra (grupo) de robots para um user-agent.
 */
export interface RobotsRule {
  /** User-agent alvo (ex.: '*'). */
  readonly userAgent: string;
  /** Caminhos permitidos explicitamente. */
  readonly allow?: readonly string[];
  /** Caminhos bloqueados ao rastreamento (areas tecnicas/admin). */
  readonly disallow?: readonly string[];
}

/**
 * Documento robots completo: regras + referencia ao(s) sitemap(s).
 */
export interface RobotsTxt {
  readonly rules: readonly RobotsRule[];
  /** URLs absolutas de sitemap (segmentadas por idioma na Fase 8). */
  readonly sitemaps: readonly string[];
  /** Host canonico preferido. */
  readonly host?: string;
}

/**
 * Opcoes de geracao do robots.txt.
 */
export interface BuildRobotsOptions {
  /** Origem (scheme + host) usada para montar URLs absolutas. */
  readonly origin?: string;
}

/**
 * Constroi o documento robots.txt da Screena.
 *
 * Contrato (a ser detalhado na Fase 8):
 *   - Bloquear apenas rotas tecnicas/administrativas (ex.: /admin, /api
 *     internas), nunca usar Disallow como substituto de `noindex`.
 *   - Apontar para o(s) sitemap(s) gerados a partir do banco local.
 *
 * Por enquanto retorna um stub minimo e seguro: libera o site e aponta para
 * o sitemap padrao. O controle fino de indexabilidade fica no nivel da pagina.
 *
 * @param _options Opcoes de origin (ignoradas no stub).
 * @returns Estrutura robots pronta para ser serializada como robots.txt.
 */
export function buildRobots(_options: BuildRobotsOptions = {}): RobotsTxt {
  // TODO(Fase 8): receber `origin`, listar rotas tecnicas a bloquear e
  // emitir os sitemaps segmentados por idioma. O noindex de paginas
  // finas/draft permanece no nivel da pagina (meta robots), nao aqui.
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        // Rotas administrativas/tecnicas serao listadas em Disallow na Fase 8.
        disallow: [],
      },
    ],
    sitemaps: [],
  };
}
