/**
 * anticipated-presenter.ts — Lógica PURA da tela 12 (Mais Aguardados):
 * transforma o payload controlado do PostgreSQL nos cards canônicos de
 * antecipação (Media Anticipation Card). Sem rede/DB/IO.
 *
 * Governança:
 *  - Não inventa dados: item sem título público ou sem slug canônico não entra.
 *  - Sem métrica de comunidade inventada ("X mil aguardando" do protótipo não
 *    tem agregado de produto ativo — composição preservada, métrica omitida).
 *  - Data ausente é estado REAL ("Data não confirmada", âmbar canônico),
 *    nunca data inventada (EX-12-nodate).
 */

import { episodePath, moviePath, seasonPath, seriesPath } from "./site";
import { buildTmdbImageUrl } from "./tmdb-image-url";

/** Meses pt-BR abreviados, minúsculos, como no canônico ("31 jul. 2026"). */
const MONTHS_SHORT_PT = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
] as const;

export type AnticipatedKind = "movie" | "tv" | "season" | "episode";

/** Card serializável da tela 12 — pronto para o grid client. */
export interface AnticipatedCard {
  kind: AnticipatedKind;
  /** Alvo REAL do bookmark (filme ou série-mãe) — UserWatchState.planned. */
  bookmarkType: "movie" | "tv";
  bookmarkId: string;
  title: string;
  /** Título original quando difere do público (linha secundária canônica). */
  original: string | null;
  href: string;
  posterUrl: string | null;
  /** Linha de meta factual ("2h 46", "8 episódios", "T9 · E7"...). */
  metaLine: string;
  /** Rótulo da pílula de data ("31 jul. 2026" | "Data não confirmada"). */
  dateLabel: string;
  /** ISO da estreia (para filtro de período) ou null quando não confirmada. */
  dateIso: string | null;
  /** true = sem data confirmada (pílula âmbar + ícone de alerta canônicos). */
  unconfirmed: boolean;
  /** createdAt ISO — ordenação "Adicionados recentemente". */
  addedAtIso: string;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** "31 jul. 2026" a partir de uma data UTC (@db.Date). */
export function formatAnticipatedDate(date: Date): string {
  const month = MONTHS_SHORT_PT[date.getUTCMonth()] ?? "";
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/** "2h 46" / "54 min" a partir de minutos, ou null. */
export function formatRuntime(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, "0")}`;
}

export interface AnticipatedMovieInput {
  id: string;
  titleOriginal: string;
  translationTitle: string | null;
  slug: string | null;
  releaseDate: Date | null;
  runtimeMinutes: number | null;
  posterPath: string | null;
  createdAt: Date;
}

export interface AnticipatedShowInput {
  id: string;
  nameOriginal: string;
  translationTitle: string | null;
  slug: string | null;
  firstAirDate: Date | null;
  numberOfEpisodes: number | null;
  posterPath: string | null;
  createdAt: Date;
}

export interface AnticipatedSeasonInput {
  tvShowId: string;
  seasonNumber: number;
  airDate: Date | null;
  episodeCount: number | null;
  posterPath: string | null;
  createdAt: Date;
  showNameOriginal: string;
  showTranslationTitle: string | null;
  showSlug: string | null;
  showPosterPath: string | null;
}

export interface AnticipatedEpisodeInput {
  tvShowId: string;
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: Date | null;
  createdAt: Date;
  showNameOriginal: string;
  showTranslationTitle: string | null;
  showSlug: string | null;
  showPosterPath: string | null;
}

function dateFields(date: Date | null): {
  dateLabel: string;
  dateIso: string | null;
  unconfirmed: boolean;
} {
  if (date === null) {
    return { dateLabel: "Data não confirmada", dateIso: null, unconfirmed: true };
  }
  return { dateLabel: formatAnticipatedDate(date), dateIso: date.toISOString(), unconfirmed: false };
}

export function buildAnticipatedMovieCard(input: AnticipatedMovieInput): AnticipatedCard | null {
  const title = trimToNull(input.translationTitle) ?? trimToNull(input.titleOriginal);
  const slug = trimToNull(input.slug);
  if (title === null || slug === null) return null;
  const original = trimToNull(input.titleOriginal);
  const runtime = formatRuntime(input.runtimeMinutes);
  return {
    kind: "movie",
    bookmarkType: "movie",
    bookmarkId: input.id,
    title,
    original: original !== null && original !== title ? original : null,
    href: moviePath(slug),
    posterUrl: buildTmdbImageUrl(input.posterPath, "w300"),
    metaLine: runtime ?? "Duração a confirmar",
    ...dateFields(input.releaseDate),
    addedAtIso: input.createdAt.toISOString(),
  };
}

export function buildAnticipatedShowCard(input: AnticipatedShowInput): AnticipatedCard | null {
  const title = trimToNull(input.translationTitle) ?? trimToNull(input.nameOriginal);
  const slug = trimToNull(input.slug);
  if (title === null || slug === null) return null;
  const href = seriesPath(slug);
  if (href === null) return null;
  const original = trimToNull(input.nameOriginal);
  const episodes = input.numberOfEpisodes;
  return {
    kind: "tv",
    bookmarkType: "tv",
    bookmarkId: input.id,
    title,
    original: original !== null && original !== title ? original : null,
    href,
    posterUrl: buildTmdbImageUrl(input.posterPath, "w300"),
    metaLine:
      episodes != null && episodes > 0
        ? `${episodes} episódio${episodes === 1 ? "" : "s"}`
        : "Episódios a confirmar",
    ...dateFields(input.firstAirDate),
    addedAtIso: input.createdAt.toISOString(),
  };
}

export function buildAnticipatedSeasonCard(input: AnticipatedSeasonInput): AnticipatedCard | null {
  const title = trimToNull(input.showTranslationTitle) ?? trimToNull(input.showNameOriginal);
  const slug = trimToNull(input.showSlug);
  if (title === null || slug === null) return null;
  const href = seasonPath(slug, input.seasonNumber);
  if (href === null) return null;
  const count = input.episodeCount;
  return {
    kind: "season",
    bookmarkType: "tv",
    bookmarkId: input.tvShowId,
    title,
    original: trimToNull(input.showNameOriginal) !== title ? trimToNull(input.showNameOriginal) : null,
    href,
    posterUrl: buildTmdbImageUrl(input.posterPath ?? input.showPosterPath, "w300"),
    metaLine:
      count != null && count > 0
        ? `Temporada ${input.seasonNumber} · ${count} ep.`
        : `Temporada ${input.seasonNumber}`,
    ...dateFields(input.airDate),
    addedAtIso: input.createdAt.toISOString(),
  };
}

export function buildAnticipatedEpisodeCard(
  input: AnticipatedEpisodeInput,
): AnticipatedCard | null {
  const title = trimToNull(input.showTranslationTitle) ?? trimToNull(input.showNameOriginal);
  const slug = trimToNull(input.showSlug);
  if (title === null || slug === null) return null;
  const href = episodePath(slug, input.seasonNumber, input.episodeNumber);
  if (href === null) return null;
  const epName = trimToNull(input.name);
  const code = `T${input.seasonNumber} · E${input.episodeNumber}`;
  return {
    kind: "episode",
    bookmarkType: "tv",
    bookmarkId: input.tvShowId,
    title,
    original: epName !== null ? `${code} — ${epName}` : code,
    href,
    posterUrl: buildTmdbImageUrl(input.showPosterPath, "w300"),
    metaLine: code,
    ...dateFields(input.airDate),
    addedAtIso: input.createdAt.toISOString(),
  };
}
