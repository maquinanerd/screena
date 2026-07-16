/**
 * schemas.ts — Validadores PUROS do payload de cada tipo de job (Backend A).
 *
 * `CatalogJobHandler.validateInput` roda ANTES de qualquer IO. Payload invalido
 * e falha PERMANENTE (`CatalogJobInputError`): repetir nao conserta um input
 * errado, entao o worker manda direto para dead-letter sem gastar tentativas.
 *
 * Regra de leitura: nada de coercao silenciosa. `"12"` NAO vira `12` num campo
 * de id — um payload que erra o tipo esta errado e deve falhar alto, perto da
 * origem, em vez de virar um id plausivel porem inventado.
 */

import { CatalogJobInputError } from '../handler.js'
import type { CatalogEntityKind, CatalogJobType } from '../types.js'
import {
  DISCOVERY_LIST_TYPES,
  type DiscoveryEntityType,
  type DiscoveryListType,
} from '../../discovery-snapshots/index.js'
import type { ChangesKind } from '../../discovery/changes-plan.js'

/** Kinds que o TMDB expoe como detalhe sincronizavel. */
export const SYNC_DETAIL_KINDS = [
  'movie',
  'tv',
  'person',
  'collection',
  'company',
  'network',
  'keyword',
] as const

/** Um kind valido de `sync_details`. */
export type SyncDetailKind = (typeof SYNC_DETAIL_KINDS)[number]

/** Kinds que possuem creditos (elenco/equipe). */
export const CREDIT_KINDS = ['movie', 'tv', 'season', 'episode'] as const

/** Um kind valido de `sync_credits`. */
export type CreditKind = (typeof CREDIT_KINDS)[number]

/** Kinds que possuem ids externos. */
export const EXTERNAL_ID_KINDS = ['movie', 'tv', 'person', 'episode'] as const

/** Um kind valido de `sync_external_ids`. */
export type ExternalIdKind = (typeof EXTERNAL_ID_KINDS)[number]

/**
 * Kinds que possuem midia sincronizavel por `sync_media`.
 *
 * `season`/`episode` ficam DE FORA de proposito: a chave de midia e
 * (entityType, tmdbId) e, para temporada, o tmdbId e o da SERIE — todas as
 * temporadas colidiriam na mesma chave de cache (`/season/1399/images`) e as
 * linhas ficariam indistinguiveis. Stills de episodio entram por
 * `sync_episodes`, que usa a chave natural correta (serie + temporada +
 * episodio).
 */
export const MEDIA_KINDS = ['movie', 'tv', 'person'] as const

/** Um kind valido de `sync_media`. */
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** Estrategias de descoberta de ids. */
export const DISCOVER_STRATEGIES = [
  'daily-exports',
  'popular',
  'trending',
  'top_rated',
  'upcoming',
  'now_playing',
  'airing_today',
  'on_the_air',
  'discover',
  'explicit-ids',
] as const

/** Uma estrategia valida de `discover_ids`. */
export type DiscoverStrategy = (typeof DISCOVER_STRATEGIES)[number]

/**
 * Modos do bootstrap.
 *
 * `wait` NAO existe: o bootstrap so enfileira, e quem processa e o
 * `catalog worker`. Declarar um modo que nao faz nada seria pior que nao ter o
 * modo — o operador acharia que o comando esperou o catalogo encher.
 * `resume` e `enqueue-only` sao equivalentes na pratica (a idempotencia por
 * requestId E a retomada); `resume` existe como intencao explicita.
 */
export const BOOTSTRAP_MODES = ['enqueue-only', 'resume', 'status'] as const

/** Um modo valido de bootstrap. */
export type BootstrapMode = (typeof BOOTSTRAP_MODES)[number]

// ---------------------------------------------------------------------------
// Leitores primitivos
// ---------------------------------------------------------------------------

/** Falha com contexto do campo (mensagem entra no dead-letter, sem PII). */
function fail(field: string, expected: string, got: unknown): never {
  const actual =
    got === null ? 'null' : Array.isArray(got) ? 'array' : typeof got === 'object' ? 'object' : typeof got
  throw new CatalogJobInputError(`campo "${field}": esperado ${expected}, recebido ${actual}`)
}

/** Payload precisa ser um objeto simples (nunca array/null). */
export function asRecord(value: unknown, field = 'payload'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(field, 'objeto', value)
  }
  return value as Record<string, unknown>
}

/** Inteiro positivo estrito. NAO aceita string numerica nem 0/negativo. */
export function readPositiveInt(raw: Record<string, unknown>, field: string): number {
  const value = raw[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(field, 'inteiro positivo', value)
  }
  return value
}

/** Inteiro >= 0 opcional; ausente/undefined => `fallback`. */
export function readOptionalNonNegativeInt(
  raw: Record<string, unknown>,
  field: string,
  fallback: number | null = null,
): number | null {
  const value = raw[field]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(field, 'inteiro >= 0', value)
  }
  return value
}

/** String nao-vazia. */
export function readString(raw: Record<string, unknown>, field: string): string {
  const value = raw[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(field, 'string nao-vazia', value)
  }
  return value.trim()
}

/** String nao-vazia opcional. */
export function readOptionalString(
  raw: Record<string, unknown>,
  field: string,
  fallback: string | null = null,
): string | null {
  const value = raw[field]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(field, 'string nao-vazia', value)
  }
  return value.trim()
}

/** Booleano opcional. */
export function readOptionalBoolean(
  raw: Record<string, unknown>,
  field: string,
  fallback: boolean,
): boolean {
  const value = raw[field]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') fail(field, 'booleano', value)
  return value
}

/** Valor pertencente a um conjunto fechado. */
export function readEnum<T extends string>(
  raw: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = raw[field]
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new CatalogJobInputError(
      `campo "${field}": esperado um de [${allowed.join(', ')}], recebido ${JSON.stringify(value)}`,
    )
  }
  return value as T
}

/** Enum opcional; ausente => `fallback`. */
export function readOptionalEnum<T extends string>(
  raw: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw[field] === undefined || raw[field] === null) return fallback
  return readEnum(raw, field, allowed)
}

/** Lista de inteiros positivos (rejeita duplicata silenciosa: dedup explicito). */
export function readIntArray(raw: Record<string, unknown>, field: string): number[] {
  const value = raw[field]
  if (!Array.isArray(value)) fail(field, 'array de inteiros positivos', value)
  const out: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry <= 0) {
      fail(`${field}[]`, 'inteiro positivo', entry)
    }
    out.push(entry)
  }
  return [...new Set(out)]
}

/**
 * Data ISO `YYYY-MM-DD`. Rejeita data impossivel (`2026-02-31`) comparando o
 * round-trip: `Date` normaliza silenciosamente, entao so aceitamos quando o
 * texto reconstruido bate com o recebido.
 */
export function readIsoDate(raw: Record<string, unknown>, field: string): Date {
  const value = readString(raw, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CatalogJobInputError(`campo "${field}": esperado data YYYY-MM-DD, recebido "${value}"`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new CatalogJobInputError(`campo "${field}": data inexistente "${value}"`)
  }
  return parsed
}

/** Data ISO opcional. */
export function readOptionalIsoDate(raw: Record<string, unknown>, field: string): Date | null {
  if (raw[field] === undefined || raw[field] === null) return null
  return readIsoDate(raw, field)
}

// ---------------------------------------------------------------------------
// Inputs por tipo de job
// ---------------------------------------------------------------------------

/** Input de `bootstrap`. */
export interface BootstrapInput {
  readonly strategy: DiscoverStrategy
  readonly entityTypes: readonly ChangesKind[]
  readonly locale: string
  readonly country: string | null
  readonly limit: number | null
  readonly mode: BootstrapMode
  readonly ids: readonly number[] | null
}

/** Input de `discover_ids`. */
export interface DiscoverIdsInput {
  readonly strategy: DiscoverStrategy
  readonly entityType: ChangesKind
  readonly locale: string
  readonly country: string | null
  readonly limit: number | null
  readonly maxPages: number | null
  readonly ids: readonly number[] | null
  readonly enqueueDetails: boolean
}

/** Input de `sync_details`. */
export interface SyncDetailsInput {
  readonly entityType: SyncDetailKind
  readonly tmdbId: number
  readonly locale: string
  readonly enqueueDependencies: boolean
}

/** Input de `sync_credits`. */
export interface SyncCreditsInput {
  readonly entityType: CreditKind
  readonly tmdbId: number
  readonly seasonNumber: number | null
  readonly episodeNumber: number | null
  readonly locale: string
}

/** Input de `sync_external_ids`. */
export interface SyncExternalIdsInput {
  readonly entityType: ExternalIdKind
  readonly tmdbId: number
  readonly seasonNumber: number | null
  readonly episodeNumber: number | null
}

/** Input de `sync_media`. */
export interface SyncMediaInput {
  readonly entityType: MediaKind
  readonly tmdbId: number
  readonly seasonNumber: number | null
  readonly episodeNumber: number | null
  readonly locale: string
}

/** Input de `sync_seasons`. */
export interface SyncSeasonsInput {
  readonly tmdbId: number
  readonly locale: string
  readonly enqueueEpisodes: boolean
}

/** Input de `sync_episodes`. */
export interface SyncEpisodesInput {
  readonly tmdbId: number
  readonly seasonNumber: number
  readonly locale: string
}

/** Input de `sync_lists`. */
export interface SyncListsInput {
  readonly listType: DiscoveryListType
  readonly entityType: DiscoveryEntityType
  readonly locale: string
  readonly country: string | null
  readonly window: string | null
  readonly maxPages: number | null
}

/** Input de `sync_changes`. */
export interface SyncChangesInput {
  readonly kinds: readonly ChangesKind[]
  readonly from: Date | null
  readonly to: Date | null
  readonly maxPages: number | null
  readonly resume: boolean
}

/** Input de `reprocess_raw`. */
export interface ReprocessRawInput {
  readonly entityType: ChangesKind
  readonly tmdbId: number | null
  readonly baseLanguage: string
  readonly limit: number | null
  readonly dryRun: boolean
}

const CHANGES_KIND_VALUES: readonly ChangesKind[] = ['movie', 'tv', 'person']

/** Le `entityTypes` (lista de movie/tv/person); ausente => todos. */
function readChangesKinds(raw: Record<string, unknown>, field: string): ChangesKind[] {
  const value = raw[field]
  if (value === undefined || value === null) return [...CHANGES_KIND_VALUES]
  if (!Array.isArray(value) || value.length === 0) {
    fail(field, 'array nao-vazio de movie|tv|person', value)
  }
  const out: ChangesKind[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !CHANGES_KIND_VALUES.includes(entry as ChangesKind)) {
      throw new CatalogJobInputError(
        `campo "${field}[]": esperado um de [movie, tv, person], recebido ${JSON.stringify(entry)}`,
      )
    }
    out.push(entry as ChangesKind)
  }
  return [...new Set(out)]
}

/** Valida o payload de `bootstrap`. */
export function validateBootstrapInput(value: unknown): BootstrapInput {
  const raw = asRecord(value)
  const strategy = readOptionalEnum(raw, 'strategy', DISCOVER_STRATEGIES, 'daily-exports')
  const ids = raw.ids === undefined || raw.ids === null ? null : readIntArray(raw, 'ids')
  if (strategy === 'explicit-ids' && (ids === null || ids.length === 0)) {
    throw new CatalogJobInputError('strategy "explicit-ids" exige "ids" nao-vazio')
  }
  return {
    strategy,
    entityTypes: readChangesKinds(raw, 'entityTypes'),
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
    country: readOptionalString(raw, 'country'),
    limit: readOptionalNonNegativeInt(raw, 'limit'),
    mode: readOptionalEnum(raw, 'mode', BOOTSTRAP_MODES, 'enqueue-only'),
    ids,
  }
}

/** Valida o payload de `discover_ids`. */
export function validateDiscoverIdsInput(value: unknown): DiscoverIdsInput {
  const raw = asRecord(value)
  const strategy = readOptionalEnum(raw, 'strategy', DISCOVER_STRATEGIES, 'daily-exports')
  const ids = raw.ids === undefined || raw.ids === null ? null : readIntArray(raw, 'ids')
  if (strategy === 'explicit-ids' && (ids === null || ids.length === 0)) {
    throw new CatalogJobInputError('strategy "explicit-ids" exige "ids" nao-vazio')
  }
  return {
    strategy,
    entityType: readEnum(raw, 'entityType', CHANGES_KIND_VALUES),
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
    country: readOptionalString(raw, 'country'),
    limit: readOptionalNonNegativeInt(raw, 'limit'),
    maxPages: readOptionalNonNegativeInt(raw, 'maxPages'),
    ids,
    enqueueDetails: readOptionalBoolean(raw, 'enqueueDetails', true),
  }
}

/** Valida o payload de `sync_details`. */
export function validateSyncDetailsInput(value: unknown): SyncDetailsInput {
  const raw = asRecord(value)
  return {
    entityType: readEnum(raw, 'entityType', SYNC_DETAIL_KINDS),
    tmdbId: readPositiveInt(raw, 'tmdbId'),
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
    enqueueDependencies: readOptionalBoolean(raw, 'enqueueDependencies', true),
  }
}

/**
 * Valida o payload de `sync_credits`.
 *
 * `season` exige `seasonNumber`; `episode` exige `seasonNumber` + `episodeNumber`
 * — sem eles nao existe chave natural, e adivinhar numero de temporada seria
 * inventar fato (invariante 12).
 */
export function validateSyncCreditsInput(value: unknown): SyncCreditsInput {
  const raw = asRecord(value)
  const entityType = readEnum(raw, 'entityType', CREDIT_KINDS)
  const seasonNumber = readOptionalNonNegativeInt(raw, 'seasonNumber')
  const episodeNumber = readOptionalNonNegativeInt(raw, 'episodeNumber')
  if ((entityType === 'season' || entityType === 'episode') && seasonNumber === null) {
    throw new CatalogJobInputError(`entityType "${entityType}" exige "seasonNumber"`)
  }
  if (entityType === 'episode' && episodeNumber === null) {
    throw new CatalogJobInputError('entityType "episode" exige "episodeNumber"')
  }
  return {
    entityType,
    tmdbId: readPositiveInt(raw, 'tmdbId'),
    seasonNumber,
    episodeNumber,
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
  }
}

/** Valida o payload de `sync_external_ids`. */
export function validateSyncExternalIdsInput(value: unknown): SyncExternalIdsInput {
  const raw = asRecord(value)
  const entityType = readEnum(raw, 'entityType', EXTERNAL_ID_KINDS)
  const seasonNumber = readOptionalNonNegativeInt(raw, 'seasonNumber')
  const episodeNumber = readOptionalNonNegativeInt(raw, 'episodeNumber')
  if (entityType === 'episode' && (seasonNumber === null || episodeNumber === null)) {
    throw new CatalogJobInputError('entityType "episode" exige "seasonNumber" e "episodeNumber"')
  }
  return { entityType, tmdbId: readPositiveInt(raw, 'tmdbId'), seasonNumber, episodeNumber }
}

/**
 * Valida o payload de `sync_media`.
 *
 * `season`/`episode` sao rejeitados por `MEDIA_KINDS` (ver a nota la): a chave
 * de midia e (entityType, tmdbId) e colidiria entre temporadas. `seasonNumber`/
 * `episodeNumber` seguem no tipo por compatibilidade do payload, mas nao tem uso
 * aqui — nenhum kind aceito os consome.
 */
export function validateSyncMediaInput(value: unknown): SyncMediaInput {
  const raw = asRecord(value)
  const entityType = readEnum(raw, 'entityType', MEDIA_KINDS)
  return {
    entityType,
    tmdbId: readPositiveInt(raw, 'tmdbId'),
    seasonNumber: readOptionalNonNegativeInt(raw, 'seasonNumber'),
    episodeNumber: readOptionalNonNegativeInt(raw, 'episodeNumber'),
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
  }
}

/** Valida o payload de `sync_seasons`. */
export function validateSyncSeasonsInput(value: unknown): SyncSeasonsInput {
  const raw = asRecord(value)
  return {
    tmdbId: readPositiveInt(raw, 'tmdbId'),
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
    enqueueEpisodes: readOptionalBoolean(raw, 'enqueueEpisodes', true),
  }
}

/** Valida o payload de `sync_episodes`. Temporada 0 (especiais) e valida. */
export function validateSyncEpisodesInput(value: unknown): SyncEpisodesInput {
  const raw = asRecord(value)
  const seasonNumber = readOptionalNonNegativeInt(raw, 'seasonNumber')
  if (seasonNumber === null) {
    throw new CatalogJobInputError('campo "seasonNumber": esperado inteiro >= 0, recebido ausente')
  }
  return {
    tmdbId: readPositiveInt(raw, 'tmdbId'),
    seasonNumber,
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
  }
}

/** Valida o payload de `sync_lists`. */
export function validateSyncListsInput(value: unknown): SyncListsInput {
  const raw = asRecord(value)
  const listType = readEnum(raw, 'listType', DISCOVERY_LIST_TYPES)
  const entityType = readEnum(raw, 'entityType', ['movie', 'tv'] as const)
  // Combinacoes que o TMDB simplesmente nao expoe: falhar aqui (permanente) e
  // melhor que descobrir com um 404 depois de gastar cota.
  const movieOnly: readonly DiscoveryListType[] = ['upcoming', 'now_playing']
  const tvOnly: readonly DiscoveryListType[] = ['airing_today', 'on_the_air']
  if (entityType === 'tv' && movieOnly.includes(listType)) {
    throw new CatalogJobInputError(`lista "${listType}" nao existe para tv`)
  }
  if (entityType === 'movie' && tvOnly.includes(listType)) {
    throw new CatalogJobInputError(`lista "${listType}" nao existe para movie`)
  }
  const window = readOptionalString(raw, 'window')
  if (listType === 'trending' && window !== null && window !== 'day' && window !== 'week') {
    throw new CatalogJobInputError(`campo "window": trending aceita day|week, recebido "${window}"`)
  }
  return {
    listType,
    entityType,
    locale: readOptionalString(raw, 'locale', 'pt-BR') as string,
    country: readOptionalString(raw, 'country'),
    window,
    maxPages: readOptionalNonNegativeInt(raw, 'maxPages'),
  }
}

/**
 * Valida o payload de `sync_changes`.
 *
 * Janela invalida (`from > to`) falha ANTES de tocar o provider — cota nao se
 * gasta com pergunta impossivel.
 */
export function validateSyncChangesInput(value: unknown): SyncChangesInput {
  const raw = asRecord(value)
  const from = readOptionalIsoDate(raw, 'from')
  const to = readOptionalIsoDate(raw, 'to')
  if (from !== null && to !== null && from.getTime() > to.getTime()) {
    throw new CatalogJobInputError('janela invalida: "from" e posterior a "to"')
  }
  return {
    kinds: readChangesKinds(raw, 'kinds'),
    from,
    to,
    maxPages: readOptionalNonNegativeInt(raw, 'maxPages'),
    resume: readOptionalBoolean(raw, 'resume', true),
  }
}

/** Valida o payload de `reprocess_raw`. */
export function validateReprocessRawInput(value: unknown): ReprocessRawInput {
  const raw = asRecord(value)
  const tmdbId = raw.tmdbId === undefined || raw.tmdbId === null ? null : readPositiveInt(raw, 'tmdbId')
  return {
    entityType: readEnum(raw, 'entityType', CHANGES_KIND_VALUES),
    tmdbId,
    baseLanguage: readOptionalString(raw, 'baseLanguage', 'pt-BR') as string,
    limit: readOptionalNonNegativeInt(raw, 'limit'),
    dryRun: readOptionalBoolean(raw, 'dryRun', false),
  }
}

/** Mapeia o kind do job para o `CatalogEntityKind` do banco. */
export function toCatalogEntityKind(kind: string): CatalogEntityKind {
  return kind as CatalogEntityKind
}

/**
 * Validadores por tipo de job, sem precisar do registry.
 *
 * O registry exige as dependencias de producao (Prisma + TMDB); quem so quer
 * saber "este payload e valido?" — o `catalog enqueue`, um teste — nao deveria
 * ter de montar um client so para isso.
 */
export const JOB_PAYLOAD_VALIDATORS: Readonly<Record<CatalogJobType, (value: unknown) => unknown>> = {
  bootstrap: validateBootstrapInput,
  discover_ids: validateDiscoverIdsInput,
  sync_details: validateSyncDetailsInput,
  sync_credits: validateSyncCreditsInput,
  sync_external_ids: validateSyncExternalIdsInput,
  sync_media: validateSyncMediaInput,
  sync_seasons: validateSyncSeasonsInput,
  sync_episodes: validateSyncEpisodesInput,
  sync_lists: validateSyncListsInput,
  sync_changes: validateSyncChangesInput,
  reprocess_raw: validateReprocessRawInput,
}

/**
 * Valida o payload de um job pelo tipo. Lanca `CatalogJobInputError` quando
 * invalido — o MESMO erro que o worker veria, so que antes de gravar.
 */
export function validateJobPayload(jobType: CatalogJobType, payload: unknown): unknown {
  const validator = JOB_PAYLOAD_VALIDATORS[jobType]
  if (validator === undefined) {
    throw new CatalogJobInputError(`tipo de job desconhecido: ${jobType}`)
  }
  return validator(payload)
}
