/**
 * site.ts — Constantes e helpers de URL do site publico Screena. PUROS.
 *
 * Sem rede/DB/IO. Servem para montar canonical e breadcrumb das paginas de forma
 * deterministica. O dominio canonico e screena.media (ver CLAUDE.md / SPEC).
 */

/** Origin canonico do site (sem barra final). */
export const SITE_URL = "https://screena.media";

/** Segmento de idioma do MVP (pt-BR publica primeiro; invariante 7). */
export const PT_LOCALE_SEGMENT = "pt";

/** Caminho da listagem de filmes (com barra final, como no esquema de rotas). */
export const MOVIES_INDEX_PATH = `/${PT_LOCALE_SEGMENT}/filmes/`;

/** Caminho canonico (relativo) da pagina de um filme, com barra final. */
export function moviePath(slug: string): string {
  return `/${PT_LOCALE_SEGMENT}/filmes/${slug}/`;
}

/** URL canonica absoluta da pagina de um filme. */
export function movieCanonicalUrl(slug: string): string {
  return `${SITE_URL}${moviePath(slug)}`;
}
