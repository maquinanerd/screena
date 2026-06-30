/**
 * movie-indexability.ts — Gate anti-thin da pagina de filme. PURO.
 *
 * Reaproveita `evaluateIndexability` de @screena/seo (invariante 5) em vez de
 * reimplementar a regra. Aqui apenas fixamos o contexto da Fase 4A — idioma
 * pt-BR, sem ratings/streaming ainda — e delegamos a decisao.
 *
 * So content_blocks com `review_status` publicavel (human_reviewed/published)
 * sao renderizados publicamente e contam para o gate. Blocos `ai_generated`,
 * `needs_review`, `draft`, `needs_update`, `blocked` e `archived` NUNCA contam
 * nem aparecem como conteudo final.
 */

import { evaluateIndexability, type IndexabilityResult } from "@screena/seo";

export type { IndexabilityDecision, IndexabilityResult } from "@screena/seo";

/** Estados de `review_status` que podem ser renderizados publicamente. */
export const RENDERABLE_REVIEW_STATUSES = ["human_reviewed", "published"] as const;

const RENDERABLE_REVIEW_STATUS_SET: ReadonlySet<string> = new Set(
  RENDERABLE_REVIEW_STATUSES,
);

/** Minimo de blocos renderizaveis distintos para a pagina poder indexar. */
export const MIN_RENDERABLE_BLOCKS = 2;

/**
 * Um content_block so e publicamente renderizavel (e so conta no gate anti-thin)
 * quando ja passou por revisao: `human_reviewed` ou `published`.
 */
export function isPubliclyRenderableBlock(reviewStatus: string): boolean {
  return RENDERABLE_REVIEW_STATUS_SET.has(reviewStatus);
}

/** Entrada do gate anti-thin da pagina de filme (Fase 4A). */
export interface MovieIndexabilityInput {
  /** Quantidade de blocos renderizaveis distintos da pagina (>= 0). */
  renderableBlockCount: number;
}

/**
 * Decide a indexabilidade da pagina de filme na Fase 4A.
 *
 * Regra: so indexa com `>= MIN_RENDERABLE_BLOCKS` blocos renderizaveis. Sem
 * camada editorial propria suficiente, retorna `noindex` — a pagina existe, mas
 * fica fora do indice. Ratings/streaming nao entram nesta fase, entao nao ha
 * rating exibido (nenhum bloqueio de licenca por aqui ainda).
 */
export function evaluateMovieIndexability(
  input: MovieIndexabilityInput,
): IndexabilityResult {
  const count = input.renderableBlockCount < 0 ? 0 : input.renderableBlockCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: true,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: count >= MIN_RENDERABLE_BLOCKS ? 0 : 1,
    reviewStatusOk: true,
  });
}
