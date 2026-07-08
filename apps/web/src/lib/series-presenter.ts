/**
 * series-presenter.ts - Mapeia o registro cru de serie (PostgreSQL) para o
 * modelo de exibicao da pagina publica. PURO: sem rede/DB/IO.
 *
 * Regra dura: nao inventa fatos. Ausencia de dado vira `null` ou lista vazia, e
 * a pagina simplesmente omite a secao correspondente.
 */

import { evaluateIndexability, type IndexabilityResult } from "@screena/seo";

import { buildTmdbImageUrl, type TmdbImageSize } from "./tmdb-image-url";

const BLOCK_TYPE_ORDER = [
  "editorial_intro",
  "summary_without_spoilers",
  "ratings_explanation",
  "where_to_watch_text",
  "cast_intro",
  "similar_titles_intro",
  "franchise_context",
  "season_guide",
  "episode_context",
  "faq",
  "news_context",
  "review_summary",
] as const;

const LOCAL_IMAGE_PREFIXES = ["/media/", "/uploads/", "/brand/"] as const;
const LOCAL_IMAGE_EXTENSION_PATTERN = /\.(?:avif|jpg|jpeg|png|webp)$/i;

const POSTER_IMAGE_SPEC: LocalImageSpec = { width: 342, height: 513, tmdbSize: "w500" };
const BACKDROP_IMAGE_SPEC: LocalImageSpec = { width: 1280, height: 720, tmdbSize: "w1280" };
const STILL_IMAGE_SPEC: LocalImageSpec = { width: 640, height: 360, tmdbSize: "original" };

/** Estados de `review_status` que podem aparecer no render publico. */
export const SERIES_RENDERABLE_REVIEW_STATUSES = [
  "human_reviewed",
  "published",
] as const;

const SERIES_RENDERABLE_REVIEW_STATUS_SET: ReadonlySet<string> = new Set(
  SERIES_RENDERABLE_REVIEW_STATUSES,
);

/** Minimo de blocos renderizaveis distintos para indexar a pagina. */
export const MIN_SERIES_RENDERABLE_BLOCKS = 2;

interface LocalImageSpec {
  width: number;
  height: number;
  /** Tamanho TMDB (segmento da URL remota) quando a origem é `file_path` cru. */
  tmdbSize: TmdbImageSize;
}

export interface SeriesRecordInput {
  nameOriginal: string;
  firstAirYear: number | null;
  lastAirYear: number | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  posterPath: string | null;
  backdropPath: string | null;
}

export interface SeriesTranslationInput {
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  summary: string | null;
}

export interface SeriesContentBlockInput {
  blockType: string;
  content: string;
  reviewStatus: string;
}

export interface SeriesEpisodeInput {
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  airYear: number | null;
  runtimeMinutes: number | null;
  stillPath: string | null;
}

export interface SeriesSeasonInput {
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  airYear: number | null;
  episodeCount: number | null;
  posterPath: string | null;
  episodes: SeriesEpisodeInput[];
}

export interface RenderableSeriesBlock {
  blockType: string;
  content: string;
}

export interface SeriesImageAsset {
  src: string;
  width: number;
  height: number;
}

export interface SeriesMediaView {
  poster: SeriesImageAsset | null;
  backdrop: SeriesImageAsset | null;
  hasRealImage: boolean;
}

export interface SeriesEpisodeView {
  episodeNumber: number;
  title: string | null;
  overview: string | null;
  airYear: number | null;
  runtimeLabel: string | null;
  still: SeriesImageAsset | null;
}

export interface SeriesSeasonView {
  seasonNumber: number;
  title: string;
  overview: string | null;
  airYear: number | null;
  episodeCount: number | null;
  episodeCountLabel: string | null;
  poster: SeriesImageAsset | null;
  episodes: SeriesEpisodeView[];
}

export interface SeriesPageView {
  title: string;
  firstAirYear: number | null;
  lastAirYear: number | null;
  periodLabel: string | null;
  seasonsCount: number | null;
  episodesCount: number | null;
  seasonsCountLabel: string | null;
  episodesCountLabel: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  blocks: RenderableSeriesBlock[];
  renderableBlockCount: number;
  media: SeriesMediaView;
  seasons: SeriesSeasonView[];
}

export interface SeriesIndexabilityInput {
  renderableBlockCount: number;
}

export interface BuildSeriesPageViewInput {
  record: SeriesRecordInput;
  translation: SeriesTranslationInput | null;
  blocks: SeriesContentBlockInput[];
  seasons: SeriesSeasonInput[];
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveIntegerOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function validYearOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function normalizeSeriesLocalImagePath(
  path: string | null | undefined,
): string | null {
  const value = trimToNull(path);
  if (value === null) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("//")) return null;
  if (value.includes("\\") || value.includes("?") || value.includes("#")) {
    return null;
  }
  if (value.split("/").includes("..")) return null;
  if (!LOCAL_IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return null;
  }
  return LOCAL_IMAGE_EXTENSION_PATTERN.test(value) ? value : null;
}

function imageAsset(
  path: string | null,
  spec: LocalImageSpec,
): SeriesImageAsset | null {
  // Local (demo/committed) primeiro; senão a URL remota do TMDB do `file_path` cru.
  const src = normalizeSeriesLocalImagePath(path) ?? buildTmdbImageUrl(path, spec.tmdbSize);
  if (src === null) return null;
  return { src, width: spec.width, height: spec.height };
}

export function selectSeriesMedia(
  record: Pick<SeriesRecordInput, "posterPath" | "backdropPath">,
): SeriesMediaView {
  const poster = imageAsset(record.posterPath, POSTER_IMAGE_SPEC);
  const backdrop = imageAsset(record.backdropPath, BACKDROP_IMAGE_SPEC);
  return { poster, backdrop, hasRealImage: poster !== null || backdrop !== null };
}

export function selectSeriesTitle(
  record: SeriesRecordInput,
  translation: SeriesTranslationInput | null,
): string {
  return trimToNull(translation?.title) ?? record.nameOriginal;
}

export function selectSeriesMetaDescription(
  translation: SeriesTranslationInput | null,
): string | null {
  return (
    trimToNull(translation?.metaDescription) ?? trimToNull(translation?.summary)
  );
}

export function formatSeriesPeriod(
  firstAirYear: number | null,
  lastAirYear: number | null,
): string | null {
  const first = validYearOrNull(firstAirYear);
  const last = validYearOrNull(lastAirYear);
  if (first === null && last === null) return null;
  if (first !== null && last !== null && first !== last) return `${first}-${last}`;
  return String(first ?? last);
}

export function formatRuntime(runtimeMinutes: number | null): string | null {
  if (runtimeMinutes == null || runtimeMinutes <= 0) return null;
  const hours = Math.floor(runtimeMinutes / 60);
  const minutes = runtimeMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function formatCountLabel(
  value: number | null,
  singular: string,
  plural: string,
): string | null {
  const count = positiveIntegerOrNull(value);
  if (count === null) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function blockTypeRank(blockType: string): number {
  const index = (BLOCK_TYPE_ORDER as readonly string[]).indexOf(blockType);
  return index === -1 ? BLOCK_TYPE_ORDER.length : index;
}

export function isPubliclyRenderableSeriesBlock(reviewStatus: string): boolean {
  return SERIES_RENDERABLE_REVIEW_STATUS_SET.has(reviewStatus);
}

export function selectRenderableSeriesBlocks(
  blocks: SeriesContentBlockInput[],
): RenderableSeriesBlock[] {
  const seenTypes = new Set<string>();
  const renderable: RenderableSeriesBlock[] = [];
  for (const block of blocks) {
    const content = trimToNull(block.content);
    if (content === null) continue;
    if (!isPubliclyRenderableSeriesBlock(block.reviewStatus)) continue;
    if (seenTypes.has(block.blockType)) continue;
    seenTypes.add(block.blockType);
    renderable.push({ blockType: block.blockType, content });
  }
  renderable.sort((a, b) => blockTypeRank(a.blockType) - blockTypeRank(b.blockType));
  return renderable;
}

export function evaluateSeriesIndexability(
  input: SeriesIndexabilityInput,
): IndexabilityResult {
  const count = input.renderableBlockCount < 0 ? 0 : input.renderableBlockCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: true,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: count >= MIN_SERIES_RENDERABLE_BLOCKS ? 0 : 1,
    reviewStatusOk: true,
  });
}

function buildEpisodeView(input: SeriesEpisodeInput): SeriesEpisodeView {
  return {
    episodeNumber: input.episodeNumber,
    title: trimToNull(input.name),
    overview: trimToNull(input.overview),
    airYear: validYearOrNull(input.airYear),
    runtimeLabel: formatRuntime(input.runtimeMinutes),
    still: imageAsset(input.stillPath, STILL_IMAGE_SPEC),
  };
}

function buildSeasonView(input: SeriesSeasonInput): SeriesSeasonView {
  const episodeCount = positiveIntegerOrNull(input.episodeCount);
  return {
    seasonNumber: input.seasonNumber,
    title: trimToNull(input.name) ?? `Temporada ${input.seasonNumber}`,
    overview: trimToNull(input.overview),
    airYear: validYearOrNull(input.airYear),
    episodeCount,
    episodeCountLabel: formatCountLabel(episodeCount, "episodio", "episodios"),
    poster: imageAsset(input.posterPath, POSTER_IMAGE_SPEC),
    episodes: input.episodes
      .map(buildEpisodeView)
      .sort((a, b) => a.episodeNumber - b.episodeNumber),
  };
}

export function buildSeriesPageView(
  input: BuildSeriesPageViewInput,
): SeriesPageView {
  const firstAirYear = validYearOrNull(input.record.firstAirYear);
  const lastAirYear = validYearOrNull(input.record.lastAirYear);
  const seasonsCount = positiveIntegerOrNull(input.record.numberOfSeasons);
  const episodesCount = positiveIntegerOrNull(input.record.numberOfEpisodes);
  const blocks = selectRenderableSeriesBlocks(input.blocks);
  const seasons = input.seasons
    .map(buildSeasonView)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

  return {
    title: selectSeriesTitle(input.record, input.translation),
    firstAirYear,
    lastAirYear,
    periodLabel: formatSeriesPeriod(firstAirYear, lastAirYear),
    seasonsCount,
    episodesCount,
    seasonsCountLabel: formatCountLabel(seasonsCount, "temporada", "temporadas"),
    episodesCountLabel: formatCountLabel(episodesCount, "episodio", "episodios"),
    metaTitle: trimToNull(input.translation?.metaTitle),
    metaDescription: selectSeriesMetaDescription(input.translation),
    blocks,
    renderableBlockCount: blocks.length,
    media: selectSeriesMedia(input.record),
    seasons,
  };
}
