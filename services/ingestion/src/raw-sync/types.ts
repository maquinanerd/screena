/**
 * types.ts — Contratos PUROS do raw sync (P0-00d). Sem rede, sem DB, sem Prisma.
 *
 * O worker consome a fila NDJSON do P0-00c (descoberta de ids) e grava o payload
 * BRUTO do TMDB em `tmdb_raw`. Aqui vivem apenas os tipos/portas; a orquestracao
 * pura esta em `run.ts` e os adapters concretos (Prisma/rede) vivem em
 * `persistence/*` e `bin/*`.
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
 * Porta de persistencia do raw (implementada pelo adapter Prisma). `readHash`
 * habilita o short-circuit por hash SEM reescrever nada.
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

/**
 * Motivo de interrupcao precoce do lote (degradacao graciosa, sempre retomavel
 * no proximo ciclo pois nada foi gravado para os itens nao processados):
 *  - `request-ceiling` — o teto efetivo de requisicoes do run foi atingido;
 *  - `circuit-open`    — o circuit breaker da fonte (client) abriu.
 */
export type RawSyncAbortReason = 'request-ceiling' | 'circuit-open'

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

/**
 * Estatistica de tamanho do payload por tipo. O tamanho e medido sobre a MESMA
 * serializacao canonica usada no hash (`stableStringify`), em bytes UTF-8.
 * Registrado em create/update E skip (o worker sempre busca o payload para
 * hashear antes de decidir); `failed` nao entra (nao houve payload). `count` e o
 * numero de amostras (payloads medidos) daquele tipo.
 */
export interface PayloadSizeStats {
  count: number
  avgBytes: number
  maxBytes: number
  minBytes: number
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
  /** Tamanho de payload por tipo (apply; count=0 em dry-run — nada buscado). */
  readonly payloadSizes: Record<SupportedRawKind, PayloadSizeStats>
  /** Tamanho de payload agregado (todos os tipos combinados). */
  readonly payloadSizesTotal: PayloadSizeStats
  readonly unsupportedSkipped: number
  readonly unsupportedByKind: Record<string, number>
  /** Retries transitorios que passaram pela camada do core (observabilidade). */
  readonly retries: number
  /** Quantos desses retries foram por 429 (rate limit). */
  readonly rate429: number
  /**
   * Total de TENTATIVAS de fetch no run (cada `fn()` do retry conta 1). E a base
   * do teto efetivo de requisicoes. Nao e quota exata de rede: inclui rejeicoes
   * pre-flight de circuito aberto (nao tocam a rede) e uma tentativa de append
   * pode gerar multiplas chamadas HTTP — logo serve de PROXY de esforco/quota,
   * nao de contagem exata de requests HTTP.
   */
  readonly requests: number
  /**
   * Itens selecionados que NAO chegaram a ser processados (o lote parou antes —
   * teto/breaker). Como nada foi gravado para eles, sao retomaveis no proximo
   * ciclo. Sempre 0 quando `aborted === false` (e em dry-run).
   */
  readonly notProcessed: number
  /** O lote foi interrompido antes de terminar (teto de requisicoes / breaker)? */
  readonly aborted: boolean
  /** Motivo da interrupcao (null quando terminou normalmente). */
  readonly abortReason: RawSyncAbortReason | null
  readonly scanned: number
  readonly selected: number
  readonly durationMs: number
}
