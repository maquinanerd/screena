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
  episodes: SeasonEpisodeInput[];
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
  episodes: SeasonEpisodeCardView[];
  prevSeason: SeasonNavLink | null;
  nextSeason: SeasonNavLink | null;
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
    episodes: episodeCardsFor(input),
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
