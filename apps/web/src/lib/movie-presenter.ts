/**
 * movie-presenter.ts — Mapeia o registro cru do filme (vindo do PostgreSQL) para
 * o modelo de exibicao da pagina. PURO: sem rede/DB/IO.
 *
 * Regra dura: NAO inventa fatos. Em especial, nunca fabrica descricao/sinopse —
 * so usa campos que ja existem no payload; ausencia de dado vira `null` e a
 * pagina simplesmente omite aquele campo.
 */

import { isPubliclyRenderableBlock } from "./movie-indexability";
import { buildTmdbImageUrl, type TmdbImageSize } from "./tmdb-image-url";
import { mapEntityStatus, mapOriginalLanguage } from "./entity-status";
import {
  selectSynopsis,
  type SynopsisView,
  type TranslationCandidate,
} from "./synopsis-language";

/**
 * Ordem canonica dos tipos de content_block (espelha o enum `ContentBlockType`
 * do schema). Usada apenas para ordenar a exibicao de forma deterministica.
 */
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

interface LocalImageSpec {
  width: number;
  height: number;
  /** Tamanho TMDB (segmento da URL remota) quando a origem é `file_path` cru. */
  tmdbSize: TmdbImageSize;
}

const POSTER_IMAGE_SPEC: LocalImageSpec = { width: 342, height: 513, tmdbSize: "w500" };
const BACKDROP_IMAGE_SPEC: LocalImageSpec = {
  width: 1280,
  height: 720,
  tmdbSize: "w1280",
};

/** Subconjunto do registro `movies` necessario para a pagina. */
export interface MovieRecordInput {
  /** `movies.title_original` — fallback final do titulo exibido. */
  titleOriginal: string;
  /** Ano de lancamento (derivado de `release_date`) ou null. */
  year: number | null;
  /** `movies.runtime_minutes` ou null. */
  runtimeMinutes: number | null;
  /** `movies.poster_path` salvo offline; nunca uma URL livre do banco. */
  posterPath: string | null;
  /** `movies.backdrop_path` salvo offline; nunca uma URL livre do banco. */
  backdropPath: string | null;
  /** `movies.status` (enum TMDB) — situacao de producao; omitida se ausente. */
  status?: string | null;
  /** `movies.original_language` (ISO 639-1) — idioma original; omitido se ausente. */
  originalLanguage?: string | null;
  /** Classificacao indicativa (advisory) — NAO e rating source; omitida se ausente. */
  certification?: string | null;
}

/** Subconjunto de `entity_translations` (pt-BR) usado pela pagina. */
export interface MovieTranslationInput {
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  summary: string | null;
}

/** content_block cru, antes da filtragem por `review_status`. */
export interface MovieContentBlockInput {
  blockType: string;
  content: string;
  reviewStatus: string;
}

/** Bloco ja aprovado para render publico. */
export interface RenderableMovieBlock {
  blockType: string;
  content: string;
}

/** Imagem ja normalizada para render publico. */
export interface MovieImageAsset {
  src: string;
  width: number;
  height: number;
}

/** Modelo de midia visual da pagina. */
export interface MovieMediaView {
  poster: MovieImageAsset | null;
  backdrop: MovieImageAsset | null;
  hasRealImage: boolean;
}

/** Modelo de exibicao final da pagina de filme. */
export interface MoviePageView {
  title: string;
  year: number | null;
  runtimeMinutes: number | null;
  runtimeLabel: string | null;
  /** Situacao de producao ja em pt-BR (ex.: "Lançado"); `null` = omite a linha. */
  statusLabel: string | null;
  /** Idioma original ja em pt-BR (ex.: "Inglês"); `null` = omite a linha. */
  originalLanguageLabel: string | null;
  metaTitle: string | null;
  /**
   * Descricao para `<meta>` e JSON-LD. SO do locale publicado, sempre.
   *
   * Nao acompanha o fallback de {@link MoviePageView.synopsis}: metadado nao
   * tem onde carregar o aviso de idioma, e declarar descricao em ingles numa
   * pagina `pt-BR` seria afirmar ao robo algo que a pagina nao sustenta.
   */
  metaDescription: string | null;
  /**
   * Sinopse VISIVEL, com a procedencia de idioma junto.
   *
   * `source: 'original_language'` carrega `notice` obrigatorio — e o que
   * impede texto estrangeiro de entrar na tela sem aviso.
   */
  synopsis: SynopsisView | null;
  /** Classificacao indicativa ("16", "L"...), ou null (chip omitido). */
  certification: string | null;
  blocks: RenderableMovieBlock[];
  renderableBlockCount: number;
  media: MovieMediaView;
}

/** Normaliza string opcional para `null` quando vazia/ausente (apos trim). */
function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Normaliza caminhos de imagem LOCAIS servidos pelo proprio app (demo/committed:
 * `/media/`, `/uploads/`, `/brand/`). URLs externas, protocolo-relativo,
 * query/hash e traversal sao recusados; `file_path` cru do TMDB (`/abc.jpg`)
 * tambem retorna `null` AQUI — a URL remota e montada em `imageAsset` via
 * `buildTmdbImageUrl` (helper governado), nao neste normalizador local.
 */
export function normalizeLocalImagePath(
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
): MovieImageAsset | null {
  // Local (demo/committed) primeiro; senão a URL remota do TMDB do `file_path` cru.
  const src = normalizeLocalImagePath(path) ?? buildTmdbImageUrl(path, spec.tmdbSize);
  if (src === null) return null;
  return { src, width: spec.width, height: spec.height };
}

/** Seleciona poster/backdrop renderizaveis sem chamar rede nem inventar asset. */
export function selectMovieMedia(
  record: Pick<MovieRecordInput, "posterPath" | "backdropPath">,
): MovieMediaView {
  const poster = imageAsset(record.posterPath, POSTER_IMAGE_SPEC);
  const backdrop = imageAsset(record.backdropPath, BACKDROP_IMAGE_SPEC);
  return { poster, backdrop, hasRealImage: poster !== null || backdrop !== null };
}

/** Titulo exibido: traducao pt-BR, senao titulo original. Nunca inventado. */
export function selectTitle(
  record: MovieRecordInput,
  translation: MovieTranslationInput | null,
): string {
  return trimToNull(translation?.title) ?? record.titleOriginal;
}

/**
 * Descricao para metadata. SO usa campos existentes (`meta_description` e, como
 * fallback, `summary`). Nunca fabrica texto: ausencia de dado retorna `null`.
 */
export function selectMetaDescription(
  translation: MovieTranslationInput | null,
): string | null {
  return (
    trimToNull(translation?.metaDescription) ?? trimToNull(translation?.summary)
  );
}

/** Rotulo de duracao ("2 h 1 min" / "47 min"); `null` quando ausente/invalido. */
export function formatRuntime(runtimeMinutes: number | null): string | null {
  if (runtimeMinutes == null || runtimeMinutes <= 0) return null;
  const hours = Math.floor(runtimeMinutes / 60);
  const minutes = runtimeMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/** Posicao de um block_type na ordem canonica (tipos desconhecidos vao ao fim). */
function blockTypeRank(blockType: string): number {
  const index = (BLOCK_TYPE_ORDER as readonly string[]).indexOf(blockType);
  return index === -1 ? BLOCK_TYPE_ORDER.length : index;
}

/**
 * Seleciona os blocos renderizaveis: apenas `review_status` publicavel, no
 * maximo um por `block_type` (o primeiro), em ordem canonica. Duplicatas do
 * mesmo tipo nao inflam a contagem do gate anti-thin.
 */
export function selectRenderableBlocks(
  blocks: MovieContentBlockInput[],
): RenderableMovieBlock[] {
  const seenTypes = new Set<string>();
  const renderable: RenderableMovieBlock[] = [];
  for (const block of blocks) {
    if (!isPubliclyRenderableBlock(block.reviewStatus)) continue;
    if (seenTypes.has(block.blockType)) continue;
    seenTypes.add(block.blockType);
    renderable.push({ blockType: block.blockType, content: block.content });
  }
  renderable.sort((a, b) => blockTypeRank(a.blockType) - blockTypeRank(b.blockType));
  return renderable;
}

/** Entrada agregada do presenter. */
export interface PresentMovieInput {
  record: MovieRecordInput;
  translation: MovieTranslationInput | null;
  blocks: MovieContentBlockInput[];
  /**
   * TODAS as traducoes da entidade, em qualquer locale.
   *
   * Existe para a sinopse do T2 e so para ela: um titulo que entrou pelo
   * caminho sob demanda pode ter texto apenas em `en-US`, e ate aqui o render
   * o descartava calado. `translation` acima continua sendo a linha do locale
   * publicado e continua governando titulo e metadados.
   *
   * Ausente (`undefined`) = chamador que ainda nao consultou; a sinopse entao
   * so pode vir de `translation`, o comportamento antigo.
   */
  translations?: readonly TranslationCandidate[];
}

/** Monta o `MoviePageView` a partir do payload controlado do PostgreSQL. */
export function presentMovie(input: PresentMovieInput): MoviePageView {
  const blocks = selectRenderableBlocks(input.blocks);
  return {
    synopsis: selectSynopsis(
      input.translations ?? [],
      input.record.originalLanguage,
    ),
    title: selectTitle(input.record, input.translation),
    year: input.record.year,
    runtimeMinutes: input.record.runtimeMinutes,
    runtimeLabel: formatRuntime(input.record.runtimeMinutes),
    certification: trimToNull(input.record.certification ?? null),
    statusLabel: mapEntityStatus(input.record.status, "movie"),
    originalLanguageLabel: mapOriginalLanguage(input.record.originalLanguage),
    metaTitle: trimToNull(input.translation?.metaTitle),
    metaDescription: selectMetaDescription(input.translation),
    blocks,
    renderableBlockCount: blocks.length,
    media: selectMovieMedia(input.record),
  };
}
