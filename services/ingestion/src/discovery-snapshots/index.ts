/**
 * discovery-snapshots — Persistencia das listas de descoberta (Backend A §5).
 *
 * Uma lista do TMDB (trending/popular/top_rated/upcoming/now_playing/
 * airing_today/on_the_air/discover) vira um SNAPSHOT imutavel + itens ordenados.
 * O render NUNCA chama o TMDB: le o ultimo snapshot VALIDO (capturedAt/expiresAt).
 *
 * Este modulo e PURO (planejamento + extracao); o adapter Prisma fica em
 * services/ingestion/src/persistence/discovery-snapshot-store.ts.
 */

/** Tipos de lista suportados (§5). */
export const DISCOVERY_LIST_TYPES = [
  'trending',
  'popular',
  'top_rated',
  'upcoming',
  'now_playing',
  'airing_today',
  'on_the_air',
  'discover',
] as const

/** Um tipo de lista valido. */
export type DiscoveryListType = (typeof DISCOVERY_LIST_TYPES)[number]

/** Entidade alvo de uma lista (so renderaveis de catalogo). */
export type DiscoveryEntityType = 'movie' | 'tv'

/** TTL padrao por tipo de lista (ms) — espelha as periodicidades de ingestao. */
export const DISCOVERY_TTL_MS: Readonly<Record<DiscoveryListType, number>> = {
  trending: 6 * 60 * 60 * 1000, // sinal volatil: 6h
  popular: 12 * 60 * 60 * 1000,
  top_rated: 24 * 60 * 60 * 1000,
  upcoming: 24 * 60 * 60 * 1000,
  now_playing: 24 * 60 * 60 * 1000,
  airing_today: 12 * 60 * 60 * 1000,
  on_the_air: 12 * 60 * 60 * 1000,
  discover: 12 * 60 * 60 * 1000,
}

/** Item extraido de uma pagina de lista (ainda em id TMDB). */
export interface DiscoveryItemPlan {
  readonly entityTmdbId: number
  readonly position: number
  readonly providerScore: number | null
}

/** Plano completo de um snapshot, pronto para o store. */
export interface DiscoverySnapshotPlan {
  readonly listType: DiscoveryListType
  readonly entityType: DiscoveryEntityType
  readonly locale: string
  readonly country: string | null
  readonly window: string | null
  readonly capturedAt: Date
  readonly expiresAt: Date
  readonly provider: string
  readonly payloadHash: string
  readonly items: readonly DiscoveryItemPlan[]
}

/** Identidade de um snapshot (para ler o mais recente valido). */
export interface DiscoverySnapshotQuery {
  readonly listType: DiscoveryListType
  readonly entityType: DiscoveryEntityType
  readonly locale: string
  readonly country?: string | null
  readonly window?: string | null
}

/** Um item ja resolvido (id interno), como sai do store. */
export interface StoredDiscoveryItem {
  readonly entityId: string
  readonly position: number
  readonly providerScore: number | null
}

/** Um snapshot lido do banco. */
export interface StoredDiscoverySnapshot {
  readonly id: string
  readonly listType: string
  readonly entityType: DiscoveryEntityType
  readonly locale: string
  readonly country: string | null
  readonly window: string | null
  readonly capturedAt: Date
  readonly expiresAt: Date
  readonly payloadHash: string
  readonly items: readonly StoredDiscoveryItem[]
}

/** Resultado de salvar um snapshot. */
export interface SaveSnapshotResult {
  readonly id: string
  /** false quando o payloadHash e igual ao ultimo (lista inalterada => noop). */
  readonly created: boolean
  readonly items: number
}

/** Porta de persistencia dos snapshots. */
export interface DiscoverySnapshotStorePort {
  /**
   * Grava um snapshot novo. Se o ultimo snapshot da mesma identidade tiver o
   * MESMO payloadHash e ainda estiver valido, e noop (created=false) — a lista
   * nao mudou. Itens cujo tmdbId nao esteja promovido sao ignorados.
   */
  saveSnapshot(plan: DiscoverySnapshotPlan): Promise<SaveSnapshotResult>
  /** Ultimo snapshot NAO expirado da identidade, ou null. */
  readLatestValid(query: DiscoverySnapshotQuery, now: Date): Promise<StoredDiscoverySnapshot | null>
  /** Idade (segundos) do ultimo snapshot da identidade, ou null se nao existir. */
  ageSeconds(query: DiscoverySnapshotQuery, now: Date): Promise<number | null>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Extrai os itens de uma pagina de lista TMDB (`results[]`), na ordem recebida.
 * Descarta itens sem id inteiro positivo. `position` e 0-based e continua de
 * `startPosition` (paginacao).
 */
export function extractListItems(page: unknown, startPosition = 0): DiscoveryItemPlan[] {
  const raw = asRecord(page)
  if (raw === null) return []
  const results = Array.isArray(raw.results) ? raw.results : []
  const items: DiscoveryItemPlan[] = []
  for (const entry of results) {
    const item = asRecord(entry)
    if (item === null) continue
    const id = item.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue
    const score = item.popularity
    items.push({
      entityTmdbId: id,
      position: startPosition + items.length,
      providerScore: typeof score === 'number' && Number.isFinite(score) ? score : null,
    })
  }
  return items
}

/** Monta o plano do snapshot a partir dos itens ja extraidos. */
export function planDiscoverySnapshot(input: {
  readonly listType: DiscoveryListType
  readonly entityType: DiscoveryEntityType
  readonly locale: string
  readonly country?: string | null
  readonly window?: string | null
  readonly items: readonly DiscoveryItemPlan[]
  readonly payloadHash: string
  readonly capturedAt: Date
  readonly ttlMs?: number
  readonly provider?: string
}): DiscoverySnapshotPlan {
  const ttl = input.ttlMs ?? DISCOVERY_TTL_MS[input.listType]
  return {
    listType: input.listType,
    entityType: input.entityType,
    locale: input.locale,
    country: input.country ?? null,
    window: input.window ?? null,
    capturedAt: input.capturedAt,
    expiresAt: new Date(input.capturedAt.getTime() + ttl),
    provider: input.provider ?? 'tmdb',
    payloadHash: input.payloadHash,
    // Reindexa as posicoes para serem densas e 0-based (o unique
    // (snapshot_id, position) exige unicidade).
    items: input.items.map((item, index) => ({ ...item, position: index })),
  }
}

/** True quando o snapshot ainda esta dentro da validade. */
export function isSnapshotValid(snapshot: { expiresAt: Date }, now: Date): boolean {
  return snapshot.expiresAt.getTime() > now.getTime()
}
