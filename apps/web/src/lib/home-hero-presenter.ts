/**
 * home-hero-presenter.ts — Monta os SLIDES do hero-carousel da home publica a
 * partir do payload controlado do PostgreSQL. PURO: sem rede/DB/IO.
 *
 * Fronteira de serializacao (o client component `hero-carousel` so recebe o
 * `HeroSlide`): tudo aqui e string/number/array plano — nunca `Decimal`,
 * `BigInt` ou objeto Prisma cru cruza para o client.
 *
 * Regras duras (espelham os demais presenters):
 *  - NAO inventa fatos: sem titulo ou sem slug canonico, o slide e descartado.
 *  - A NOTA e a nota editorial PROPRIA do Screen (`screenScore`, escala 5), nunca
 *    AggregateRating de terceiro nem mistura com IMDb/RT (invariantes 1/2/6). So
 *    aparece quando `screenScoreDisplay` esta liberado e o valor e valido.
 *  - `certification` e classificacao indicativa (advisory), nao rating source.
 *  - A sinopse e o resumo editorial pt-BR (nunca copia sinopse externa), aparada.
 */

import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH, detailPath } from "./site";

/** Escala canonica da nota editorial propria do Screen. */
export const SCREEN_SCORE_SCALE = 5;

/** Teto de nomes de elenco exibidos na coluna de creditos do slide. */
export const HERO_CAST_LIMIT = 3;

/** Comprimento maximo da sinopse curta do slide (aparada em limite de palavra). */
export const HERO_SYNOPSIS_MAX = 160;

export type HeroVertical = "movie" | "series";

/**
 * Subconjunto controlado (ja convertido de Prisma) para montar um slide. O
 * `screenScore`/`screenScoreScale` ja chegam como number puro (Decimal->number
 * feito no loader server); aqui so validamos e formatamos.
 */
export interface HeroSlideInput {
  kind: HeroVertical;
  /** Titulo pt-BR (traducao) ou original; sem titulo o slide e descartado. */
  title: string | null;
  /** Slug canonico pt-BR; sem slug o slide e descartado (nunca link quebrado). */
  slug: string | null;
  /** Ano (filme) / ano de estreia (serie) — info principal quando existir. */
  year: number | null;
  /** Serie: total de temporadas (quando > 0). */
  seasonsCount: number | null;
  /** Serie: total de episodios (quando > 0). */
  episodesCount: number | null;
  /** Classificacao indicativa (advisory) ou null. */
  certification: string | null;
  /** Nota editorial propria do Screen (0..scale) ou null. */
  screenScore: number | null;
  /** Escala da nota (deve ser SCREEN_SCORE_SCALE; senao a nota e ignorada). */
  screenScoreScale: number | null;
  /** Gate seguro: so exibe a nota quando true. */
  screenScoreDisplay: boolean;
  /** Nome do diretor (crew) ou null. */
  director: string | null;
  /** Nomes de elenco ja ordenados (top -> menos relevante). */
  cast: readonly string[];
  /** Resumo editorial pt-BR (nunca sinopse externa) ou null. */
  summary: string | null;
}

/** Nota editorial propria do Screen, ja validada, para render de estrelas. */
export interface HeroRating {
  /** Valor na escala (0 < value <= scale). */
  value: number;
  /** Escala (sempre SCREEN_SCORE_SCALE quando presente). */
  scale: number;
}

/** Slide pronto para render — objeto PLANO e serializavel (client-safe). */
export interface HeroSlide {
  vertical: HeroVertical;
  /** Rotulo textual do destaque ("Filme em destaque" / "Serie em destaque"). */
  eyebrow: string;
  title: string;
  /** `/pt/filmes/{slug}/` ou `/pt/series/{slug}/`. */
  href: string;
  /** Itens da info principal (filme: ["2023"]; serie: ["3 temporadas", ...]). */
  primaryMeta: string[];
  /** Nota editorial do Screen ou null (oculta quando invalida/nao liberada). */
  rating: HeroRating | null;
  /** Classificacao indicativa ou null. */
  certification: string | null;
  /** Diretor ou null. */
  director: string | null;
  /** Nomes de elenco (<= HERO_CAST_LIMIT). */
  cast: string[];
  /** Sinopse curta aparada ou null. */
  synopsis: string | null;
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

/** "1 temporada" / "3 temporadas" (ou null quando a contagem nao e valida). */
export function formatCountLabel(
  value: number | null,
  singular: string,
  plural: string,
): string | null {
  const count = positiveIntegerOrNull(value);
  if (count === null) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Valida a nota editorial propria do Screen para exibicao. So retorna nota
 * quando: display liberado, valor finito > 0, escala == SCREEN_SCORE_SCALE e
 * valor <= escala. Qualquer desvio -> null (fallback seguro, sem estrela).
 */
export function resolveHeroRating(input: HeroSlideInput): HeroRating | null {
  if (!input.screenScoreDisplay) return null;
  const value = input.screenScore;
  const scale = input.screenScoreScale;
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (scale !== SCREEN_SCORE_SCALE) return null;
  if (value > scale) return null;
  return { value, scale };
}

/**
 * Info principal do slide como lista de itens validos (sem `null`/vazio):
 *  - filme: [ano] quando houver;
 *  - serie: [temporadas, episodios] (cada um so quando > 0).
 * A ordem/separadores finais ("·") ficam por conta do componente.
 */
export function buildPrimaryMeta(input: HeroSlideInput): string[] {
  if (input.kind === "movie") {
    const year = positiveIntegerOrNull(input.year);
    return year === null ? [] : [String(year)];
  }
  const items: string[] = [];
  const seasons = formatCountLabel(input.seasonsCount, "temporada", "temporadas");
  const episodes = formatCountLabel(input.episodesCount, "episódio", "episódios");
  if (seasons !== null) items.push(seasons);
  if (episodes !== null) items.push(episodes);
  return items;
}

/**
 * Apara a sinopse a no maximo HERO_SYNOPSIS_MAX chars, cortando em limite de
 * palavra e anexando reticencias. Texto ja curto passa intacto.
 */
export function trimSynopsis(
  value: string | null,
  max: number = HERO_SYNOPSIS_MAX,
): string | null {
  const text = trimToNull(value);
  if (text === null) return null;
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:]+$/u, "")}…`;
}

/** Nomes de elenco: apara, descarta vazios, deduplica e aplica o teto. */
export function buildHeroCast(
  names: readonly string[],
  limit: number = HERO_CAST_LIMIT,
): string[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : HERO_CAST_LIMIT;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = trimToNull(raw);
    if (name === null || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

const EYEBROW: Readonly<Record<HeroVertical, string>> = {
  movie: "Filme em destaque",
  series: "Série em destaque",
};

/**
 * Monta o `HeroSlide` de uma entrada, ou `null` quando falta titulo/slug validos
 * (o carousel simplesmente ignora entradas invalidas).
 */
export function buildHeroSlide(input: HeroSlideInput): HeroSlide | null {
  const title = trimToNull(input.title);
  const slug = trimToNull(input.slug);
  if (title === null || slug === null) return null;
  const indexPath = input.kind === "movie" ? MOVIES_INDEX_PATH : SERIES_INDEX_PATH;
  const href = detailPath(indexPath, slug);
  if (href === null) return null;

  return {
    vertical: input.kind,
    eyebrow: EYEBROW[input.kind],
    title,
    href,
    primaryMeta: buildPrimaryMeta(input),
    rating: resolveHeroRating(input),
    certification: trimToNull(input.certification),
    director: trimToNull(input.director),
    cast: buildHeroCast(input.cast),
    synopsis: trimSynopsis(input.summary),
  };
}

/** Monta e filtra a lista de slides (descarta os invalidos). */
export function buildHeroSlides(inputs: readonly HeroSlideInput[]): HeroSlide[] {
  const slides: HeroSlide[] = [];
  for (const input of inputs) {
    const slide = buildHeroSlide(input);
    if (slide !== null) slides.push(slide);
  }
  return slides;
}
