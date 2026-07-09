/**
 * types.ts — Contratos PUROS do raw sync (P0-00d). Sem rede, sem DB, sem Prisma.
 *
 * O worker consome a fila NDJSON do P0-00c (descoberta de ids) e grava o payload
 * BRUTO do TMDB em `tmdb_raw`. Aqui vivem apenas os tipos/portas; a orquestracao
 * pura esta em `run.ts` e os adapters concretos (Prisma/rede) vivem FORA do
 * typecheck (`persistence/*`, `bin/*`).
 *
 * INVARIANTES honradas por estes contratos:
 *  - baseLanguage e sempre a lingua da requisicao base (pt-BR no piloto); os
 *    demais idiomas vem embutidos no payload via `translations`.
 *  - a decisao de gravar/pular e por `payloadHash` (idempotencia; ver
 *    `hash-decision.ts`), nunca por "achismo".
 */

import type { QueueItem } from '../discovery/sync-queue.js'

/** Tipos de entidade que o piloto P0-00d sabe buscar detalhe (subset do enum). */
export type SupportedRawKind = 'movie' | 'tv' | 'person'

/**
 * Porta de leitura de detalhe TMDB. Satisfeita ESTRUTURALMENTE por
 * `client.endpoints` (que tem estes metodos, entre outros) — o core nunca
 * importa o client concreto, so este contrato, e por isso permanece testavel com
 * um fake em memoria.
 */
export interface RawDetailSource {
  getMovie(tmdbId: number): Promise<unknown>
  getTvShow(tmdbId: number): Promise<unknown>
  getPerson(tmdbId: number): Promise<unknown>
}

/** Chave natural de `tmdb_raw` (`@@unique([entityType, tmdbId, baseLanguage])`). */
export interface RawEntityKey {
  readonly entityType: SupportedRawKind
  readonly tmdbId: number
  readonly baseLanguage: string
}

/** Registro a persistir em `tmdb_raw` (payload bruto + rastreabilidade). */
export interface RawEntityRecord extends RawEntityKey {
  /** Payload BRUTO do TMDB (base + append/translations). Nunca normalizado aqui. */
  readonly payload: unknown
  /** Hash estavel do payload (idempotencia; `@screena` util `hashPayload`). */
  readonly payloadHash: string
  /** ETag do HTTP, se o client expor (hoje null — ver PR/README). */
  readonly etag: string | null
  /** Last-Modified do HTTP, se o client expor (hoje null — ver PR/README). */
  readonly lastModified: string | null
  /** Momento da coleta (injetado; determinista em teste). */
  readonly fetchedAt: Date
}

/**
 * Porta de persistencia do raw (implementada pelo adapter Prisma, fora do
 * typecheck). `readHash` habilita o short-circuit por hash SEM reescrever nada.
 */
export interface RawEntityStore {
  /** Hash atual do registro (ou null se nao existe). */
  readHash(key: RawEntityKey): Promise<string | null>
  /** Insere um novo registro. */
  create(record: RawEntityRecord): Promise<void>
  /** Atualiza payload/hash/fetchedAt de um registro existente. */
  update(key: RawEntityKey, record: RawEntityRecord): Promise<void>
}

/** Resultado da decisao de gravacao por hash. */
export type RawWriteOutcome = 'create' | 'update' | 'skip'

/** Resultado por item (inclui estados que nao gravam). */
export type ItemOutcome = RawWriteOutcome | 'failed' | 'planned'

/** Limites do piloto por tipo suportado (default 100/100/100). */
export interface PilotLimits {
  readonly movie: number
  readonly tv: number
  readonly person: number
}

/**
 * Resultado do seletor do piloto. `selected` sao SO itens suportados, ja
 * limitados por tipo; `unsupported*` contam collection/network/company/keyword
 * (nunca somem em silencio). O seletor faz scan INTEIRO da fila (memoria
 * limitada aos selecionados + contadores).
 */
export interface PilotSelection {
  /** Itens suportados selecionados (<= soma dos limites), na ordem da fila. */
  readonly selected: readonly QueueItem[]
  /** Quantos selecionados por tipo suportado. */
  readonly perKindSelected: Record<SupportedRawKind, number>
  /** Total de itens de tipos NAO suportados (contados, nao processados). */
  readonly unsupportedSkipped: number
  /** Breakdown de unsupported por tipo (collection/network/company/keyword). */
  readonly unsupportedByKind: Record<string, number>
  /** Total de itens lidos da fila (scan inteiro). */
  readonly scanned: number
}

/** Contagens de desfecho por tipo (validas no modo apply). */
export interface KindCounts {
  created: number
  updated: number
  skipped: number
  failed: number
}

/** Relatorio completo de uma execucao (dry-run ou apply). */
export interface RawSyncReport {
  readonly mode: 'dry-run' | 'apply'
  readonly baseLanguage: string
  readonly limits: PilotLimits
  /** Planejado por tipo (valido nos dois modos = itens selecionados). */
  readonly perKindSelected: Record<SupportedRawKind, number>
  /** Desfechos por tipo (apply; zeros em dry-run). */
  readonly perKind: Record<SupportedRawKind, KindCounts>
  /** Soma dos desfechos de todos os tipos. */
  readonly totals: KindCounts
  readonly unsupportedSkipped: number
  readonly unsupportedByKind: Record<string, number>
  /** Retries transitorios que passaram pela camada do core (observabilidade). */
  readonly retries: number
  /** Quantos desses retries foram por 429 (rate limit). */
  readonly rate429: number
  readonly scanned: number
  readonly selected: number
  readonly durationMs: number
}
