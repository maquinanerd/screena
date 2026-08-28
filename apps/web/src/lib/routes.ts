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

/** Caminho das listas do titular (com barra final). Area privada: noindex. */
export const LISTS_PATH = `/${PT_LOCALE_SEGMENT}/listas/`;

/** Caminho do hub "Onde assistir" (com barra final). */
export const WATCH_PATH = `/${PT_LOCALE_SEGMENT}/onde-assistir/`;

/**
 * Documentos legais. Sao os destinos dos dois links do aceite OBRIGATORIO do
 * cadastro (`app/pt/criar-conta/signup-form.tsx`): exigir o aceite e apontar
 * para uma rota inexistente e o pior dos dois mundos, entao estes caminhos
 * existem como constante para que o formulario e as paginas nunca divirjam.
 */
export const TERMS_PATH = `/${PT_LOCALE_SEGMENT}/termos/`;
export const PRIVACY_PATH = `/${PT_LOCALE_SEGMENT}/privacidade/`;

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

/**
 * Segmento da GALERIA DE IMAGENS nas rotas de titulo (pt-BR).
 *
 * Um segmento SO, usado por filme e por serie. Dois valores ("imagens" e
 * "fotos", por exemplo) criariam duas URLs para a mesma pagina, e o canonical
 * teria de escolher uma — que e como se ganha um par de duplicatas de graca.
 */
export const IMAGES_SEGMENT = "imagens";
/** Segmento da GALERIA DE VIDEOS nas rotas de titulo (pt-BR). */
export const VIDEOS_SEGMENT = "videos";

/**
 * Segmento da GALERIA DE FOTOS nas rotas de PESSOA (pt-BR).
 *
 * POR QUE UM SEGUNDO SEGMENTO, E POR QUE ISSO NAO CONTRADIZ `IMAGES_SEGMENT`.
 * A regra de `IMAGES_SEGMENT` proibe DUAS URLs para a MESMA pagina — e o dano
 * dela e um par de duplicatas que o canonical tem de desempatar. Aqui nao ha
 * duplicata: a galeria de pessoa exibe `image_type = 'profile'`, que a galeria
 * de titulo NAO exibe (`TITLE_IMAGE_TYPES` a exclui, e `GalleryImageKind` nem
 * a tem no tipo). Sao dois conjuntos disjuntos em duas entidades diferentes.
 *
 * O segmento e `fotos` e nao `imagens` porque e a palavra que a propria tela 09
 * ja usa no titulo da secao ("Fotos"). URL e rotulo dizendo a mesma palavra e o
 * caso facil; faze-los divergir seria o caso caro.
 */
export const PHOTOS_SEGMENT = "fotos";

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
 * Caminho da galeria de IMAGENS de um titulo, com barra final.
 *
 * `vertical` e o segmento da rota (`filmes` | `series`) e nao um rotulo: a
 * diferenciacao filme/serie nunca depende so de cor, e a URL e um dos cinco
 * sinais obrigatorios (invariante 11).
 */
export function imagesGalleryPath(
  vertical: "filmes" | "series",
  slug: string,
): string | null {
  if (!isSafeSlug(slug)) return null;
  return `/${PT_LOCALE_SEGMENT}/${vertical}/${slug.trim()}/${IMAGES_SEGMENT}/`;
}

/** Caminho da galeria de VIDEOS de um titulo, com barra final. */
export function videosGalleryPath(
  vertical: "filmes" | "series",
  slug: string,
): string | null {
  if (!isSafeSlug(slug)) return null;
  return `/${PT_LOCALE_SEGMENT}/${vertical}/${slug.trim()}/${VIDEOS_SEGMENT}/`;
}

/**
 * Caminho da galeria de IMAGENS de um EPISODIO, com barra final.
 *
 * `/pt/series/{slug}/temporadas/{n}/episodios/{e}/imagens/`.
 *
 * Reusa `IMAGES_SEGMENT` — o MESMO segmento das galerias de titulo. Um segundo
 * vocabulario aqui ("stills", "fotos") criaria duas gramaticas de URL para a
 * mesma coisa dentro do mesmo site.
 *
 * O episodio NAO tem slug proprio: a URL e a do episodio + o segmento, como
 * manda o resto do trilho de serie.
 */
export function episodeImagesGalleryPath(
  seriesSlug: string,
  seasonNumber: number,
  episodeNumber: number,
): string | null {
  const base = episodePath(seriesSlug, seasonNumber, episodeNumber);
  if (base === null) return null;
  return `${base}${IMAGES_SEGMENT}/`;
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

/**
 * Caminho da galeria de FOTOS de uma pessoa, com barra final.
 *
 * Devolve `null` para slug que quebraria o path — a MESMA porta
 * (`isSafeSlug`) das galerias de titulo. Um caminho montado por concatenacao
 * crua aqui seria o unico do modulo sem validacao.
 */
export function personPhotosPath(slug: string): string | null {
  if (!isSafeSlug(slug)) return null;
  return `${PEOPLE_INDEX_PATH}${slug.trim()}/${PHOTOS_SEGMENT}/`;
}
