/**
 * types.ts — Contratos PUROS da promocao de `tmdb_raw` -> tabelas tipadas
 * (P0-00f). Sem rede, sem DB, sem Prisma: so tipos/portas. A orquestracao pura
 * vive em `run.ts`; os adapters concretos (Prisma) vivem em `persistence/*`.
 *
 * O worker le o payload BRUTO ja gravado em `tmdb_raw` (sem TMDB, sem rede) e o
 * promove para as tabelas tipadas EXISTENTES via o normalizer da entidade + o
 * `EntityStorePort` de sempre; o slug/traducao vem do `CatalogFinalizePort`
 * (mesma logica idempotente do backfill, extraida do bin — nunca duplicada).
 *
 * Core GENERICO por `PromoteStrategy` (P0-00f.2): a orquestracao e uma so;
 * `movie` (f.1) e `tv` (f.2) sao estrategias finas. person e blocos seguintes.
 * season/episode NUNCA sao promovidos aqui (nao estao no payload de detalhe;
 * exigem `/tv/{id}/season/{n}` — outro bloco).
 */

import type { UpsertOutcome } from '../ports.js'
import type { CatalogEntityType } from '../public-catalog-slug.js'

/**
 * Uma linha de `tmdb_raw` pronta para promocao (qualquer entityType suportado).
 * `payload` e o detalhe BRUTO do TMDB (base + append) — o mesmo shape que o
 * normalizer da entidade ja consome; `fetchedAt` carimba a frescor herdada
 * (last_synced_at do tipado).
 */
export interface RawEntityRow {
  readonly tmdbId: number
  readonly baseLanguage: string
  /** Payload bruto do TMDB (detalhe + append). Nunca normalizado aqui. */
  readonly payload: unknown
  /** Momento em que o raw foi coletado (vira `last_synced_at` do tipado). */
  readonly fetchedAt: Date
}

/** Alias historico (P0-00f.1): a linha e agnostica de entidade. */
export type RawMovieRow = RawEntityRow

/**
 * Porta GENERICA de leitura de `tmdb_raw` para promocao (implementada pelo
 * adapter Prisma). So leitura — a promocao nunca escreve em
 * `tmdb_raw`. O core opera sobre esta porta; os wrappers por tipo adaptam a sua.
 */
export interface RawEntitySource {
  /** Quantas entidades ha em `tmdb_raw` (para o plano do dry-run). */
  count(): Promise<number>
  /** Ate `limit` linhas (com payload), na ordem estavel do adapter. */
  list(limit: number): Promise<readonly RawEntityRow[]>
}

/** Porta de leitura de FILMES em `tmdb_raw` (wrapper de filme; P0-00f.1). */
export interface RawMovieSource {
  countMovies(): Promise<number>
  listMoviePayloads(limit: number): Promise<readonly RawEntityRow[]>
}

/** Porta de leitura de SERIES em `tmdb_raw` (wrapper de serie; P0-00f.2). */
export interface RawTvSource {
  countTvShows(): Promise<number>
  listTvShowPayloads(limit: number): Promise<readonly RawEntityRow[]>
}

/** Porta de leitura de PESSOAS em `tmdb_raw` (wrapper de pessoa; P0-00f.3). */
export interface RawPersonSource {
  countPeople(): Promise<number>
  listPersonPayloads(limit: number): Promise<readonly RawEntityRow[]>
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

/**
 * Campos de EXIBICAO (title/overview) derivados do payload bruto, ja com o
 * fallback de titulo resolvido pela estrategia — sao a base do slug + traducao.
 * A ficha factual (nota, datas, elenco) vem do normalizer, nunca daqui.
 *
 * Sem `year` de proposito: o ano de lancamento nao entra no slug canonico
 * (`desiredCatalogSlug`). Ele continua vivo na ficha (releaseDate/firstAirDate)
 * e no render (titulo, metadata, schema, filtros) — so nao na URL.
 */
export interface PromoteDisplayFields {
  readonly title: string
  readonly overview: string | null
}

/** Resultado da promocao de UM registro: outcome do store + campos de exibicao. */
export interface PromotedRecord {
  readonly outcome: UpsertOutcome
  readonly display: PromoteDisplayFields
}

/**
 * Estrategia por tipo de entidade: encapsula o que muda entre movie/tv/person —
 * o `entityType` (para slug/traducao) e o `promote` (normalizar + upsert tipado
 * + campos de exibicao). O core generico cuida de fila, contagem, finalize
 * (slug/traducao), relatorio e isolamento de falha por item.
 */
export interface PromoteStrategy {
  readonly entityType: CatalogEntityType
  /** Normaliza o payload e faz o upsert tipado; devolve outcome + exibicao. */
  promote(row: RawEntityRow): Promise<PromotedRecord>
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
  /** Tipo de entidade promovido (movie/tv/...) — rotula o relatorio/log. */
  readonly entityType: CatalogEntityType
  readonly baseLanguage: string
  /** Teto de entidades desta execucao. */
  readonly limit: number
  /** Total de entidades disponiveis em `tmdb_raw` (do tipo). */
  readonly available: number
  /** Quantos foram efetivamente selecionados (min(available, limit)). */
  readonly selected: number
  /** Desfechos por item (apply; zeros em dry-run). */
  readonly counts: PromoteCounts
  /** Ids que falharam (limitado para o relatorio; nunca some em silencio no total). */
  readonly failedIds: readonly number[]
  readonly durationMs: number
}
