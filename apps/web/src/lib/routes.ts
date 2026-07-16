/**
 * Constantes de rotas publicas da Cinerie. PURO: sem env, DB, rede ou IO.
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

/** Segmento de temporadas nas rotas de serie (pt-BR). */
export const SEASONS_SEGMENT = "temporadas";
/** Segmento de episodios nas rotas de temporada (pt-BR). */
export const EPISODES_SEGMENT = "episodios";

/** Slug seguro para path (sem caracteres que quebrariam URL). */
function isSafeSlug(slug: string): boolean {
  const value = slug.trim();
  if (value === "") return false;
  return !/[/\\:?#]/.test(value) && !value.includes("..");
}

/** Numero de temporada/episodio inteiro positivo. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/** Caminho canonico (relativo) da pagina de uma serie, com barra final. */
export function seriesPath(slug: string): string | null {
  if (!isSafeSlug(slug)) return null;
  return `/${PT_LOCALE_SEGMENT}/series/${slug.trim()}/`;
}

/** Caminho canonico (relativo) da pagina de uma temporada, com barra final. */
export function seasonPath(
  seriesSlug: string,
  seasonNumber: number,
): string | null {
  if (!isSafeSlug(seriesSlug) || !isPositiveInteger(seasonNumber)) return null;
  return `/${PT_LOCALE_SEGMENT}/series/${seriesSlug.trim()}/${SEASONS_SEGMENT}/${seasonNumber}/`;
}

/** Caminho canonico (relativo) da pagina de um episodio, com barra final. */
export function episodePath(
  seriesSlug: string,
  seasonNumber: number,
  episodeNumber: number,
): string | null {
  if (
    !isSafeSlug(seriesSlug) ||
    !isPositiveInteger(seasonNumber) ||
    !isPositiveInteger(episodeNumber)
  ) {
    return null;
  }
  return `/${PT_LOCALE_SEGMENT}/series/${seriesSlug.trim()}/${SEASONS_SEGMENT}/${seasonNumber}/${EPISODES_SEGMENT}/${episodeNumber}/`;
}

/**
 * Parseia um parametro numerico de rota (temporada/episodio) na FORMA CANONICA:
 * inteiro positivo SEM zero a esquerda. `01`, `003`, `0`, `-1`, `abc`, `1a` ->
 * `null`. A politica vigente e responder 404 para forma nao-canonica (o projeto
 * nao normaliza numeros de rota).
 */
export function parseRouteNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
