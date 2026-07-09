/**
 * types.ts — Contratos PUROS da promocao de `tmdb_raw` -> tabelas tipadas
 * (P0-00f). Sem rede, sem DB, sem Prisma: so tipos/portas. A orquestracao pura
 * vive em `run.ts`; os adapters concretos (Prisma) vivem em `persistence/*`,
 * FORA do typecheck.
 *
 * O worker le o payload BRUTO ja gravado em `tmdb_raw` (sem TMDB, sem rede) e o
 * promove para as tabelas tipadas EXISTENTES via `normalizeMovie` + o
 * `EntityStorePort` de sempre; o slug/traducao vem do `CatalogFinalizePort`
 * (mesma logica idempotente do backfill, extraida do bin — nunca duplicada).
 *
 * Escopo P0-00f.1: SOMENTE filme. tv/person/season/episode ficam para blocos
 * seguintes (nao estao no payload de filme, ou sao outra cadeia de normalizacao).
 */

import type { CatalogEntityType } from '../public-catalog-slug.js'

/**
 * Uma linha de `tmdb_raw` (entityType=movie) pronta para promocao. `payload` e o
 * detalhe BRUTO do TMDB (base + append) — o mesmo shape que `normalizeMovie` ja
 * consome; `fetchedAt` carimba a frescor herdada (last_synced_at do tipado).
 */
export interface RawMovieRow {
  readonly tmdbId: number
  readonly baseLanguage: string
  /** Payload bruto do TMDB (detalhe de filme + append). Nunca normalizado aqui. */
  readonly payload: unknown
  /** Momento em que o raw foi coletado (vira `last_synced_at` do tipado). */
  readonly fetchedAt: Date
}

/**
 * Porta de leitura de `tmdb_raw` para promocao (implementada pelo adapter Prisma,
 * fora do typecheck). So leitura — a promocao nunca escreve em `tmdb_raw`.
 */
export interface RawMovieSource {
  /** Quantos filmes existem em `tmdb_raw` (para o plano do dry-run). */
  countMovies(): Promise<number>
  /** Ate `limit` linhas de filme (com payload), na ordem estavel do adapter. */
  listMoviePayloads(limit: number): Promise<readonly RawMovieRow[]>
}

/**
 * Porta de finalizacao editorial de catalogo (slug canonico pt-BR idempotente +
 * traducao pt-BR). Implementada pelo adapter `persistence/catalog-finalize.ts`,
 * a MESMA logica (com Redirect 301) que o backfill usa — extraida para ca para
 * nao duplicar (regra P0-00f #7). `entityId` e o id interno como string (BigInt
 * serializado), como o `EntityStorePort` devolve.
 */
export interface CatalogFinalizePort {
  /** Upsert idempotente do slug canonico (+ 301 em troca). Devolve o slug efetivo. */
  upsertCanonicalSlug(
    entityType: CatalogEntityType,
    entityId: string,
    desiredSlug: string,
    tmdbId: number,
  ): Promise<string>
  /** Upsert idempotente da traducao pt-BR (title + summary). */
  upsertTranslation(
    entityType: CatalogEntityType,
    entityId: string,
    title: string,
    summary: string | null,
  ): Promise<void>
}

/** Desfecho por item promovido. */
export type PromoteOutcome = 'created' | 'updated' | 'failed' | 'planned'

/** Contagens de desfecho (validas no modo apply). */
export interface PromoteCounts {
  created: number
  updated: number
  failed: number
}

/** Relatorio de uma execucao de promocao (dry-run ou apply). */
export interface PromoteReport {
  readonly mode: 'dry-run' | 'apply'
  readonly baseLanguage: string
  /** Teto de filmes desta execucao. */
  readonly limit: number
  /** Total de filmes disponiveis em `tmdb_raw`. */
  readonly available: number
  /** Quantos foram efetivamente selecionados (min(available, limit)). */
  readonly selected: number
  /** Desfechos por item (apply; zeros em dry-run). */
  readonly counts: PromoteCounts
  /** Ids que falharam (limitado para o relatorio; nunca some em silencio no total). */
  readonly failedIds: readonly number[]
  readonly durationMs: number
}
