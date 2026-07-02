/**
 * site.ts — Constantes e helpers de URL do site publico Screen. PUROS.
 *
 * Sem rede/DB/IO. Servem para montar canonical e breadcrumb das paginas de forma
 * deterministica. O dominio publico canonico e thescreen.media (marca Screen).
 */

/** Origin canonico do site (sem barra final). */
export const SITE_URL = "https://thescreen.media";

/** Segmento de idioma do MVP (pt-BR publica primeiro; invariante 7). */
export const PT_LOCALE_SEGMENT = "pt";

/** Caminho da home publica pt-BR (com barra final). */
export const HOME_PATH = `/${PT_LOCALE_SEGMENT}/`;

/** Caminho da listagem de filmes (com barra final, como no esquema de rotas). */
export const MOVIES_INDEX_PATH = `/${PT_LOCALE_SEGMENT}/filmes/`;

/** Caminho da listagem de series (com barra final). */
export const SERIES_INDEX_PATH = `/${PT_LOCALE_SEGMENT}/series/`;

/** Caminho da listagem de pessoas (com barra final). */
export const PEOPLE_INDEX_PATH = `/${PT_LOCALE_SEGMENT}/pessoas/`;

/** Caminho da listagem de noticias (com barra final). */
export const NEWS_INDEX_PATH = `/${PT_LOCALE_SEGMENT}/noticias/`;

/** Caminho do hub exploratorio (com barra final). */
export const EXPLORE_PATH = `/${PT_LOCALE_SEGMENT}/explorar/`;

/** Caminho canonico (relativo) da pagina de um filme, com barra final. */
export function moviePath(slug: string): string {
  return `/${PT_LOCALE_SEGMENT}/filmes/${slug}/`;
}

/** URL canonica absoluta da pagina de um filme. */
export function movieCanonicalUrl(slug: string): string {
  return `${SITE_URL}${moviePath(slug)}`;
}

/**
 * Caminho de detalhe sob uma listagem publica, validando o slug: rejeita slug
 * vazio/whitespace e slug com caracteres de path/URL (`/`, `\`, `:`, `?`, `#`,
 * `..`) que quebrariam o esquema canonico. Retorna `null` em vez de inventar
 * URL — quem consome (sitemap, links) simplesmente omite o item.
 */
export function detailPath(indexPath: string, slug: string | null): string | null {
  if (slug === null) return null;
  const value = slug.trim();
  if (value === "") return null;
  if (/[/\\:?#]/.test(value) || value.includes("..")) return null;
  return `${indexPath}${value}/`;
}

/**
 * URL canonica absoluta de um caminho publico interno.
 *
 * Regras (todas deterministas, sem rede):
 *  - rejeita path externo (`https://...`, `//host`) e path que nao comece em `/`;
 *  - colapsa barras duplicadas internas (`/pt//filmes/` -> `/pt/filmes/`);
 *  - garante barra final (padrao `trailingSlash: true` do app);
 *  - prefixa sempre o dominio canonico `SITE_URL`.
 *
 * Retorna `null` para entrada invalida — nunca gera URL fora do dominio.
 */
export function canonicalPublicUrl(path: string): string | null {
  const value = path.trim();
  if (value === "" || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("://")) return null;
  const collapsed = value.replace(/\/{2,}/g, "/");
  const withTrailing = collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
  return `${SITE_URL}${withTrailing}`;
}
