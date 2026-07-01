/**
 * movie-presenter.ts — Mapeia o registro cru do filme (vindo do PostgreSQL) para
 * o modelo de exibicao da pagina. PURO: sem rede/DB/IO.
 *
 * Regra dura: NAO inventa fatos. Em especial, nunca fabrica descricao/sinopse —
 * so usa campos que ja existem no payload; ausencia de dado vira `null` e a
 * pagina simplesmente omite aquele campo.
 */

import { isPubliclyRenderableBlock } from "./movie-indexability";

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

/** Subconjunto do registro `movies` necessario para a pagina. */
export interface MovieRecordInput {
  /** `movies.title_original` — fallback final do titulo exibido. */
  titleOriginal: string;
  /** Ano de lancamento (derivado de `release_date`) ou null. */
  year: number | null;
  /** `movies.runtime_minutes` ou null. */
  runtimeMinutes: number | null;
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

/** Modelo de exibicao final da pagina de filme. */
export interface MoviePageView {
  title: string;
  year: number | null;
  runtimeMinutes: number | null;
  runtimeLabel: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  blocks: RenderableMovieBlock[];
  renderableBlockCount: number;
}

/** Normaliza string opcional para `null` quando vazia/ausente (apos trim). */
function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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
}

/** Monta o `MoviePageView` a partir do payload controlado do PostgreSQL. */
export function presentMovie(input: PresentMovieInput): MoviePageView {
  const blocks = selectRenderableBlocks(input.blocks);
  return {
    title: selectTitle(input.record, input.translation),
    year: input.record.year,
    runtimeMinutes: input.record.runtimeMinutes,
    runtimeLabel: formatRuntime(input.record.runtimeMinutes),
    metaTitle: trimToNull(input.translation?.metaTitle),
    metaDescription: selectMetaDescription(input.translation),
    blocks,
    renderableBlockCount: blocks.length,
  };
}
