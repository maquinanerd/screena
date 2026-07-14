/**
 * entity-index-presenter.ts - Monta as listagens publicas (portas de entrada)
 * das entidades principais: filmes, series e pessoas. PURO: sem rede/DB/IO.
 *
 * Regras duras (espelham os presenters de detalhe):
 *  - nao inventa dados: item sem titulo/nome ou sem slug canonico NAO entra;
 *  - imagem: path LOCAL seguro (demo/committed) OU URL remota do TMDB montada do
 *    `file_path` cru (via helper governado); path invalido/externo -> null -> fallback;
 *  - ordenacao deterministica e cap de itens; sem paginacao complexa;
 *  - indexacao (politica 2026-07 — indexacao total): listagem com >= 1 item
 *    valido indexa; listagem vazia e caso tecnico/vazio -> noindex.
 */

import { evaluateIndexability, type IndexabilityResult } from "@screena/seo";

import {
  SCREEN_SCORE_EDITORIAL_SOURCE,
  SCREEN_SCORE_SCALE,
  type ScreenScoreSource,
} from "./home-hero-presenter";
import { buildTmdbImageUrl, type TmdbImageSize } from "./tmdb-image-url";

/** Quantos itens a listagem exibe por pagina (sem paginacao nesta fatia). */
export const INDEX_ITEM_LIMIT = 24;

/**
 * Numero de itens validos a partir do qual a listagem e considerada "rica"
 * (sinal de qualidade). NAO gate mais indexacao: basta >= 1 item valido para
 * indexar (politica 2026-07 — indexacao total); listagem vazia = noindex tecnico.
 */
export const MIN_INDEX_ITEMS = 3;

const LOCAL_IMAGE_PREFIXES = ["/media/", "/uploads/", "/brand/"] as const;
const LOCAL_IMAGE_EXTENSION_PATTERN = /\.(?:avif|jpg|jpeg|png|webp)$/i;

const POSTER_IMAGE_SPEC: LocalImageSpec = { width: 342, height: 513, tmdbSize: "w500" };
const PROFILE_IMAGE_SPEC: LocalImageSpec = { width: 300, height: 450, tmdbSize: "original" };

const MOVIE_PATH_PREFIX = "/pt/filmes/";
const SERIES_PATH_PREFIX = "/pt/series/";
const PERSON_PATH_PREFIX = "/pt/pessoas/";

/**
 * Traducao pt-BR dos departamentos conhecidos do TMDB (`known_for_department`).
 * Espelha o mapa de `person-presenter`; valor desconhecido -> `null` (nunca vaza
 * rotulo em ingles nem inventa funcao).
 */
const KNOWN_FOR_DEPARTMENT_LABELS: Readonly<Record<string, string>> = {
  Acting: "Atuacao",
  Directing: "Direcao",
  Writing: "Roteiro",
  Production: "Producao",
  Editing: "Edicao",
  Camera: "Fotografia",
  Sound: "Som",
  Art: "Arte",
  "Costume & Make-Up": "Figurino e Maquiagem",
  "Visual Effects": "Efeitos Visuais",
  Lighting: "Iluminacao",
  Crew: "Equipe",
};

interface LocalImageSpec {
  width: number;
  height: number;
  /** Tamanho TMDB (segmento da URL remota) quando a origem é `file_path` cru. */
  tmdbSize: TmdbImageSize;
}

export type EntityIndexKind = "movie" | "series" | "person";

export interface EntityImageAsset {
  src: string;
  width: number;
  height: number;
}

/** Card ja pronto para render (com href montado). */
export interface EntityCard {
  kind: EntityIndexKind;
  title: string;
  href: string;
  /** Metadado curto: ano (filme), periodo (serie) ou funcao (pessoa). */
  meta: string | null;
  image: EntityImageAsset | null;
  /**
   * Nota editorial PROPRIA da cinerie (escala SCREEN_SCORE_SCALE) ja validada e
   * formatada para exibicao, ou `null` quando nao ha nota governada/liberada com
   * origem editorial explicita (pessoas: sempre `null`). Mesma governanca do hero
   * (`resolveHeroRating`):
   * NUNCA e rating externo (IMDb/RT/TMDB) nem AggregateRating de terceiro.
   */
  screenScore: string | null;
}

export interface EntityIndexView {
  kind: EntityIndexKind;
  cards: EntityCard[];
  /** Total de itens validos (antes do cap de exibicao). */
  totalCount: number;
  /** True quando ha mais itens validos do que os exibidos (totalCount > cards). */
  hasMore: boolean;
}

/**
 * Subconjunto controlado da nota editorial propria da cinerie (ja convertido de
 * Prisma), compartilhado por filme e serie. Opcional: ausente == nao exibir a
 * nota (gate seguro, igual ao default `screen_score_display = false`).
 */
export interface ScreenScoreInput {
  /** Nota editorial propria da cinerie (0..scale) ou null. */
  screenScore?: number | null;
  /** Escala da nota; so exibe quando == SCREEN_SCORE_SCALE. */
  screenScoreScale?: number | null;
  /** Gate seguro: so exibe a nota quando `true` (ausente = nao exibir). */
  screenScoreDisplay?: boolean;
  /**
   * Origem/proveniencia da nota propria. Ausente/null significa "sem pipeline
   * editorial real confirmado" e oculta a estrela, mesmo com display=true.
   */
  screenScoreSource?: ScreenScoreSource | null;
}

export interface MovieListItemInput extends ScreenScoreInput {
  titleOriginal: string;
  translationTitle: string | null;
  slug: string | null;
  year: number | null;
  posterPath: string | null;
}

export interface SeriesListItemInput extends ScreenScoreInput {
  nameOriginal: string;
  translationTitle: string | null;
  slug: string | null;
  firstAirYear: number | null;
  lastAirYear: number | null;
  posterPath: string | null;
}

export interface PersonListItemInput {
  name: string;
  translationTitle: string | null;
  slug: string | null;
  knownForDepartment: string | null;
  profilePath: string | null;
}

export interface EntityIndexIndexabilityInput {
  itemCount: number;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validYearOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Normaliza caminhos de imagem locais ja servidos pelo proprio app. Paths TMDB
 * crus (`/abc.jpg`), URLs externas, protocolo-relativo, query/hash e traversal
 * sao recusados: a listagem so aponta para paths locais seguros.
 */
export function normalizeEntityLocalImagePath(
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
): EntityImageAsset | null {
  // Local (demo/committed) primeiro; senão a URL remota do TMDB montada do
  // `file_path` cru (helper governado). Path inválido -> null -> fallback visual.
  const src = normalizeEntityLocalImagePath(path) ?? buildTmdbImageUrl(path, spec.tmdbSize);
  if (src === null) return null;
  return { src, width: spec.width, height: spec.height };
}

export function mapKnownForDepartment(
  department: string | null | undefined,
): string | null {
  const value = trimToNull(department);
  if (value === null) return null;
  return KNOWN_FOR_DEPARTMENT_LABELS[value] ?? null;
}

/**
 * Resolve a nota editorial PROPRIA da cinerie de um card para exibicao, seguindo
 * EXATAMENTE o mesmo gate do hero (`resolveHeroRating`): so devolve valor quando
 * ha origem editorial explicita, o display esta liberado, o numero e finito > 0,
 * a escala e SCREEN_SCORE_SCALE e o valor <= escala. Qualquer desvio -> `null`
 * (sem estrela, sem fallback fake, nunca nota por posicao). NUNCA e rating
 * externo (IMDb/RT/TMDB) nem AggregateRating: e a mesma nota governada do hero,
 * formatada como texto (uma casa decimal) para o card.
 */
export function resolveCardScreenScore(input: ScreenScoreInput): string | null {
  if (input.screenScoreSource !== SCREEN_SCORE_EDITORIAL_SOURCE) return null;
  if (input.screenScoreDisplay !== true) return null;
  const value = input.screenScore;
  const scale = input.screenScoreScale;
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (scale !== SCREEN_SCORE_SCALE) return null;
  if (value > scale) return null;
  return value.toFixed(1);
}

/** Periodo curto de uma serie: "2011" (ano unico) ou "2011-2019". */
export function formatSeriesIndexPeriod(
  firstAirYear: number | null,
  lastAirYear: number | null,
): string | null {
  const first = validYearOrNull(firstAirYear);
  const last = validYearOrNull(lastAirYear);
  if (first === null && last === null) return null;
  if (first !== null && last !== null && first !== last) return `${first}-${last}`;
  return String(first ?? last);
}

/** Entrada interna: card resolvido + chaves de ordenacao deterministica. */
interface SortableEntry {
  card: EntityCard | null;
  year: number | null;
  sortKey: string;
}

function buildIndexView(
  kind: EntityIndexKind,
  entries: SortableEntry[],
): EntityIndexView {
  const valid = entries.filter(
    (entry): entry is { card: EntityCard; year: number | null; sortKey: string } =>
      entry.card !== null,
  );
  valid.sort((a, b) => {
    const ay = a.year ?? Number.NEGATIVE_INFINITY;
    const by = b.year ?? Number.NEGATIVE_INFINITY;
    if (ay !== by) return by - ay;
    return a.sortKey.localeCompare(b.sortKey);
  });
  const totalCount = valid.length;
  const cards = valid.slice(0, INDEX_ITEM_LIMIT).map((entry) => entry.card);
  return { kind, cards, totalCount, hasMore: totalCount > cards.length };
}

export function buildMovieCard(input: MovieListItemInput): EntityCard | null {
  const slug = trimToNull(input.slug);
  const title = trimToNull(input.translationTitle) ?? trimToNull(input.titleOriginal);
  if (slug === null || title === null) return null;
  const year = validYearOrNull(input.year);
  return {
    kind: "movie",
    title,
    href: `${MOVIE_PATH_PREFIX}${slug}/`,
    meta: year !== null ? String(year) : null,
    image: imageAsset(input.posterPath, POSTER_IMAGE_SPEC),
    screenScore: resolveCardScreenScore(input),
  };
}

export function buildSeriesCard(input: SeriesListItemInput): EntityCard | null {
  const slug = trimToNull(input.slug);
  const title = trimToNull(input.translationTitle) ?? trimToNull(input.nameOriginal);
  if (slug === null || title === null) return null;
  return {
    kind: "series",
    title,
    href: `${SERIES_PATH_PREFIX}${slug}/`,
    meta: formatSeriesIndexPeriod(input.firstAirYear, input.lastAirYear),
    image: imageAsset(input.posterPath, POSTER_IMAGE_SPEC),
    screenScore: resolveCardScreenScore(input),
  };
}

export function buildPersonCard(input: PersonListItemInput): EntityCard | null {
  const slug = trimToNull(input.slug);
  const title = trimToNull(input.translationTitle) ?? trimToNull(input.name);
  if (slug === null || title === null) return null;
  return {
    kind: "person",
    title,
    href: `${PERSON_PATH_PREFIX}${slug}/`,
    meta: mapKnownForDepartment(input.knownForDepartment),
    image: imageAsset(input.profilePath, PROFILE_IMAGE_SPEC),
    // Pessoas nao tem nota editorial (screen_score e so de filme/serie).
    screenScore: null,
  };
}

/** Listagem de filmes: releaseDate (ano) desc, depois titleOriginal asc. */
export function buildMovieIndexView(
  items: MovieListItemInput[],
): EntityIndexView {
  return buildIndexView(
    "movie",
    items.map((item) => ({
      card: buildMovieCard(item),
      year: validYearOrNull(item.year),
      sortKey: trimToNull(item.titleOriginal) ?? "",
    })),
  );
}

/** Listagem de series: firstAirDate (ano) desc, depois nameOriginal asc. */
export function buildSeriesIndexView(
  items: SeriesListItemInput[],
): EntityIndexView {
  return buildIndexView(
    "series",
    items.map((item) => ({
      card: buildSeriesCard(item),
      year: validYearOrNull(item.firstAirYear),
      sortKey: trimToNull(item.nameOriginal) ?? "",
    })),
  );
}

/** Listagem de pessoas: nome asc (deterministico, sem depender de timestamp). */
export function buildPersonIndexView(
  items: PersonListItemInput[],
): EntityIndexView {
  return buildIndexView(
    "person",
    items.map((item) => ({
      card: buildPersonCard(item),
      year: null,
      sortKey: trimToNull(item.translationTitle) ?? trimToNull(item.name) ?? "",
    })),
  );
}

/**
 * Decide index/noindex da listagem via o avaliador canonico. Politica 2026-07
 * (indexacao total): listagem com >= 1 item valido indexa; listagem vazia e
 * caso tecnico/vazio -> `noindex`.
 */
export function evaluateEntityIndexIndexability(
  input: EntityIndexIndexabilityInput,
): IndexabilityResult {
  const count = input.itemCount < 0 ? 0 : input.itemCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: count > 0,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: 0,
    reviewStatusOk: true,
  });
}
