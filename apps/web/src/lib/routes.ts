/**
 * Constantes de rotas publicas do Screen. PURO: sem env, DB, rede ou IO.
 *
 * Este modulo pode ser importado por client components, por isso nao deve ler
 * `process.env` nem carregar helpers server-only.
 */

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

/**
 * Caminho de detalhe sob uma listagem publica, validando o slug. Retorna `null`
 * para slug vazio ou com caracteres que quebrariam path/URL.
 */
export function detailPath(indexPath: string, slug: string | null): string | null {
  if (slug === null) return null;
  const value = slug.trim();
  if (value === "") return null;
  if (/[/\\:?#]/.test(value) || value.includes("..")) return null;
  return `${indexPath}${value}/`;
}
