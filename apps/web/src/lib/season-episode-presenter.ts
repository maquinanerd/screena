/**
 * season-episode-presenter.ts — Montagem PURA das views de temporada e episodio
 * (Fase 4). Sem rede/DB/IO: recebe o registro cru ja lido do PostgreSQL e
 * devolve o modelo de exibicao. Nao inventa fatos: ausencia -> null/omite.
 *
 * Reaproveita helpers puros do `series-presenter` (`formatRuntime`,
 * `normalizeSeriesLocalImagePath`) e o construtor de URL remota do TMDB — sem
 * duplicar a biblioteca visual.
 */

import { episodePath, seasonPath } from "./routes";
import {
  formatRuntime,
  normalizeSeriesLocalImagePath,
  type SeriesImageAsset,
} from "./series-presenter";
import { buildTmdbImageUrl, type TmdbImageSize } from "./tmdb-image-url";

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

/** Limite de caracteres do resumo de episodio na LISTA da temporada. */
export const EPISODE_SUMMARY_LIMIT = 220;

interface ImageSpec {
  width: number;
  height: number;
  tmdbSize: TmdbImageSize;
}
const POSTER_SPEC: ImageSpec = { width: 342, height: 513, tmdbSize: "w500" };
const BACKDROP_SPEC: ImageSpec = { width: 1280, height: 720, tmdbSize: "w1280" };
const STILL_SPEC: ImageSpec = { width: 640, height: 360, tmdbSize: "original" };

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveIntegerOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** Primeiro asset valido (local seguro; senao URL remota do TMDB do file_path). */
function imageAsset(
  path: string | null,
  spec: ImageSpec,
): SeriesImageAsset | null {
  const src = normalizeSeriesLocalImagePath(path) ?? buildTmdbImageUrl(path, spec.tmdbSize);
  return src === null ? null : { src, width: spec.width, height: spec.height };
}

/** Poster da temporada; senao poster da serie; senao backdrop da serie. */
function seasonPoster(
  seasonPosterPath: string | null,
  seriesPosterPath: string | null,
  seriesBackdropPath: string | null,
): SeriesImageAsset | null {
  return (
    imageAsset(seasonPosterPath, POSTER_SPEC) ??
    imageAsset(seriesPosterPath, POSTER_SPEC) ??
    imageAsset(seriesBackdropPath, BACKDROP_SPEC)
  );
}

/** "YYYY-MM-DD..." -> "30 de junho de 2026"; `null` se invalido. */
export function formatAirDate(iso: string | null): string | null {
  const value = trimToNull(iso);
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return null;
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} de ${MONTHS_PT[month - 1]} de ${year}`;
}

function yearFromIso(iso: string | null): number | null {
  const value = trimToNull(iso);
  if (value === null) return null;
  const match = /^(\d{4})-/.exec(value);
  if (match === null) return null;
  const year = Number.parseInt(match[1] as string, 10);
  return Number.isInteger(year) && year > 0 ? year : null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Temporada
// ---------------------------------------------------------------------------

export interface SeasonEpisodeInput {
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  airDateIso: string | null;
  runtimeMinutes: number | null;
  stillPath: string | null;
}

/**
 * Episodios por pagina na ficha de temporada.
 *
 * 50 e escolhido para ser INVISIVEL no caso normal: temporada de ficcao tem
 * 8-24 episodios, cabe inteira na primeira pagina, e a navegacao nem aparece.
 * A paginacao so existe para o caso que produziu o problema — novela e
 * programa diario, onde uma "temporada" e um ano de exibicao e a lista tinha
 * centenas ou milhares de linhas, cada uma com `overview`.
 */
export const EPISODES_PER_PAGE = 50;

/**
 * Navegacao entre as fatias de episodios de UMA temporada.
 *
 * As URLs sao reais (`?pagina=N`), nao estado de cliente: o botao Voltar do
 * navegador funciona, o link pode ser compartilhado, e quem esta sem
 * JavaScript navega igual. A pagina 1 NAO leva query — a URL canonica da
 * temporada continua sendo exatamente a que sempre foi.
 */
export interface SeasonEpisodePaginationView {
  /** Pagina atual, 1-based e ja normalizada (nunca 0, nunca acima do total). */
  page: number;
  /** Total de paginas. `1` quando a temporada cabe inteira. */
  pageCount: number;
  /** Total de episodios da temporada (vem do `COUNT`, nao do tamanho da fatia). */
  totalEpisodes: number;
  /** `true` quando ha mais de uma pagina — o unico gate para desenhar a navegacao. */
  hasPages: boolean;
  prevHref: string | null;
  nextHref: string | null;
  /** Ex.: "51–100 de 5.000". Vazio quando ha uma pagina so. */
  rangeLabel: string | null;
}

export interface SeasonPresenterInput {
  seriesTitle: string;
  /** Slug canonico pt-BR da serie. */
  seriesSlug: string;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  airDateIso: string | null;
  episodeCount: number | null;
  seasonPosterPath: string | null;
  seriesPosterPath: string | null;
  seriesBackdropPath: string | null;
  /** APENAS a fatia da pagina atual — nunca a temporada inteira. */
  episodes: SeasonEpisodeInput[];
  /** Pagina atual pedida pela rota (1-based). */
  page: number;
  /**
   * Total de episodios da temporada, vindo de um `COUNT`.
   *
   * NAO e `episodes.length`: se fosse, a navegacao sumiria exatamente quando a
   * fatia fosse a ultima, e a temporada de 5.000 episodios se apresentaria como
   * tendo 50. E o mesmo cuidado que a listagem de filmes ja toma com
   * `totalCount`.
   */
  totalEpisodes: number;
  prevSeasonNumber: number | null;
  nextSeasonNumber: number | null;
}

export interface SeasonEpisodeCardView {
  episodeNumber: number;
  title: string | null;
  summary: string | null;
  dateLabel: string | null;
  runtimeLabel: string | null;
  still: SeriesImageAsset | null;
  href: string;
}

export interface SeasonNavLink {
  seasonNumber: number;
  href: string;
  label: string;
}

export interface SeasonPageView {
  seriesTitle: string;
  seriesSlug: string;
  seasonNumber: number;
  seasonTitle: string;
  overview: string | null;
  dateLabel: string | null;
  airYear: number | null;
  episodeCount: number | null;
  episodeCountLabel: string | null;
  poster: SeriesImageAsset | null;
  /**
   * O backdrop 16:9 da SÉRIE, para o cartão de trailer da temporada.
   *
   * Vem da série de propósito: o TMDB não publica backdrop POR TEMPORADA, e
   * escolher um still de episódio e apresentá-lo como "o frame deste trailer"
   * afirmaria algo que o dado não diz — a mesma decisão que
   * `gallery-presenter.ts` tomou para a lista de vídeos.
   *
   * `null` quando a série não tem backdrop: o cartão continua existindo (o
   * trailer é real), só sem imagem de fundo.
   */
  backdrop: SeriesImageAsset | null;
  episodes: SeasonEpisodeCardView[];
  /** Navegacao entre fatias de episodios DESTA temporada. */
  pagination: SeasonEpisodePaginationView;
  prevSeason: SeasonNavLink | null;
  nextSeason: SeasonNavLink | null;
}

/**
 * URL de uma pagina de episodios. Pagina 1 devolve a URL canonica LIMPA, sem
 * `?pagina=1` — para nao existirem duas URLs com o mesmo conteudo.
 */
function seasonPageHref(
  seriesSlug: string,
  seasonNumber: number,
  page: number,
): string | null {
  const base = seasonPath(seriesSlug, seasonNumber);
  if (base === null) return null;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

function buildSeasonPagination(input: SeasonPresenterInput): SeasonEpisodePaginationView {
  const total = Number.isInteger(input.totalEpisodes) && input.totalEpisodes > 0
    ? input.totalEpisodes
    : 0;
  const pageCount = total === 0 ? 1 : Math.ceil(total / EPISODES_PER_PAGE);
  const page = Math.min(Math.max(Math.trunc(input.page) || 1, 1), pageCount);
  const hasPages = pageCount > 1;

  const first = (page - 1) * EPISODES_PER_PAGE + 1;
  const last = Math.min(page * EPISODES_PER_PAGE, total);

  return {
    page,
    pageCount,
    totalEpisodes: total,
    hasPages,
    prevHref: page > 1 ? seasonPageHref(input.seriesSlug, input.seasonNumber, page - 1) : null,
    nextHref:
      page < pageCount ? seasonPageHref(input.seriesSlug, input.seasonNumber, page + 1) : null,
    rangeLabel: hasPages
      ? `${first.toLocaleString("pt-BR")}–${last.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`
      : null,
  };
}

function seasonLink(seriesSlug: string, seasonNumber: number | null): SeasonNavLink | null {
  if (seasonNumber === null) return null;
  const href = seasonPath(seriesSlug, seasonNumber);
  if (href === null) return null;
  return { seasonNumber, href, label: `Temporada ${seasonNumber}` };
}

function episodeCardsFor(input: SeasonPresenterInput): SeasonEpisodeCardView[] {
  const cards: SeasonEpisodeCardView[] = [];
  for (const episode of input.episodes) {
    const href = episodePath(input.seriesSlug, input.seasonNumber, episode.episodeNumber);
    if (href === null) continue;
    const overview = trimToNull(episode.overview);
    cards.push({
      episodeNumber: episode.episodeNumber,
      title: trimToNull(episode.name),
      summary: overview === null ? null : truncate(overview, EPISODE_SUMMARY_LIMIT),
      dateLabel: formatAirDate(episode.airDateIso),
      runtimeLabel: formatRuntime(episode.runtimeMinutes),
      still: imageAsset(episode.stillPath, STILL_SPEC),
      href,
    });
  }
  return cards.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

export function buildSeasonPageView(input: SeasonPresenterInput): SeasonPageView {
  const episodeCount = positiveIntegerOrNull(input.episodeCount);
  return {
    seriesTitle: input.seriesTitle,
    seriesSlug: input.seriesSlug,
    seasonNumber: input.seasonNumber,
    seasonTitle: trimToNull(input.name) ?? `Temporada ${input.seasonNumber}`,
    overview: trimToNull(input.overview),
    dateLabel: formatAirDate(input.airDateIso),
    airYear: yearFromIso(input.airDateIso),
    episodeCount,
    episodeCountLabel:
      episodeCount === null
        ? null
        : `${episodeCount} ${episodeCount === 1 ? "episódio" : "episódios"}`,
    poster: seasonPoster(
      input.seasonPosterPath,
      input.seriesPosterPath,
      input.seriesBackdropPath,
    ),
    backdrop: imageAsset(input.seriesBackdropPath, BACKDROP_SPEC),
    episodes: episodeCardsFor(input),
    pagination: buildSeasonPagination(input),
    prevSeason: seasonLink(input.seriesSlug, input.prevSeasonNumber),
    nextSeason: seasonLink(input.seriesSlug, input.nextSeasonNumber),
  };
}

// ---------------------------------------------------------------------------
// Episodio
// ---------------------------------------------------------------------------

export interface EpisodePresenterInput {
  seriesTitle: string;
  seriesSlug: string;
  seasonNumber: number;
  seasonName: string | null;
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  airDateIso: string | null;
  runtimeMinutes: number | null;
  stillPath: string | null;
  prevEpisodeNumber: number | null;
  nextEpisodeNumber: number | null;
}

export interface EpisodeNavLink {
  episodeNumber: number;
  href: string;
  label: string;
}

export interface EpisodePageView {
  seriesTitle: string;
  seriesSlug: string;
  seasonNumber: number;
  seasonTitle: string;
  seasonHref: string | null;
  episodeNumber: number;
  episodeTitle: string;
  overview: string | null;
  dateLabel: string | null;
  airYear: number | null;
  runtimeLabel: string | null;
  still: SeriesImageAsset | null;
  prevEpisode: EpisodeNavLink | null;
  nextEpisode: EpisodeNavLink | null;
}

function episodeLink(
  seriesSlug: string,
  seasonNumber: number,
  episodeNumber: number | null,
): EpisodeNavLink | null {
  if (episodeNumber === null) return null;
  const href = episodePath(seriesSlug, seasonNumber, episodeNumber);
  if (href === null) return null;
  return { episodeNumber, href, label: `Episódio ${episodeNumber}` };
}

export function buildEpisodePageView(input: EpisodePresenterInput): EpisodePageView {
  return {
    seriesTitle: input.seriesTitle,
    seriesSlug: input.seriesSlug,
    seasonNumber: input.seasonNumber,
    seasonTitle: trimToNull(input.seasonName) ?? `Temporada ${input.seasonNumber}`,
    seasonHref: seasonPath(input.seriesSlug, input.seasonNumber),
    episodeNumber: input.episodeNumber,
    episodeTitle: trimToNull(input.name) ?? `Episódio ${input.episodeNumber}`,
    overview: trimToNull(input.overview),
    dateLabel: formatAirDate(input.airDateIso),
    airYear: yearFromIso(input.airDateIso),
    runtimeLabel: formatRuntime(input.runtimeMinutes),
    still: imageAsset(input.stillPath, STILL_SPEC),
    prevEpisode: episodeLink(input.seriesSlug, input.seasonNumber, input.prevEpisodeNumber),
    nextEpisode: episodeLink(input.seriesSlug, input.seasonNumber, input.nextEpisodeNumber),
  };
}
