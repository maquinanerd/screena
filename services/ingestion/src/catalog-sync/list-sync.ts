/**
 * list-sync.ts — Orquestracao PURA de execucao PAGINADA de endpoints de lista/
 * discover/trending/changes do TMDB (Fase 8). Port-based, testavel com fakes.
 *
 * Para cada pagina: captura o payload BRUTO em api_cache (chave inclui a pagina),
 * loga o ciclo, extrai/deduplica ids e persiste o CHECKPOINT (retomavel). Respeita
 * total_pages e um teto maxPages; nunca carrega tudo em memoria de uma vez. Nao
 * normaliza entidades por conta propria — a ingestao de entidade e job explicito.
 */

import type { CachePort, SyncLogPort, SyncStatus } from '../ports.js'

/** Estado de checkpoint de um job paginado. */
export interface CheckpointState {
  readonly lastPage: number
  readonly totalPages: number | null
  readonly done: boolean
}

/** Porta de checkpoint (tmdb_sync_checkpoint). */
export interface CheckpointStorePort {
  load(job: string, paramsHash: string): Promise<CheckpointState | null>
  save(job: string, paramsHash: string, state: CheckpointState): Promise<void>
}

/** Dependencias do sync paginado. */
export interface ListSyncDeps {
  readonly cache: CachePort
  readonly log: SyncLogPort
  readonly checkpoint: CheckpointStorePort
  readonly now: () => Date
}

/** Opcoes de um job paginado. */
export interface ListSyncOptions {
  /** Identidade estavel do job (ex.: 'list:movie/popular', 'discover:movie'). */
  readonly job: string
  /** Endpoint base para o cache (ex.: '/movie/popular'). */
  readonly endpoint: string
  /** Hash dos parametros que definem o job (fora a pagina). */
  readonly paramsHash: string
  /** Busca uma pagina (1-based). */
  readonly fetchPage: (page: number) => Promise<unknown>
  /** Teto de paginas processadas neste ciclo (nunca varre tudo de uma vez). */
  readonly maxPages: number
  /** Retomar do checkpoint (senao comeca da pagina 1). */
  readonly resume: boolean
}

/** Resultado do ciclo paginado. */
export interface ListSyncResult {
  readonly job: string
  readonly startPage: number
  readonly pagesFetched: number
  readonly lastPage: number
  readonly totalPages: number | null
  readonly done: boolean
  readonly uniqueIds: number
  readonly status: SyncStatus
}

interface PageShape {
  page?: unknown
  total_pages?: unknown
  results?: unknown
}

function readTotalPages(payload: unknown): number | null {
  if (payload && typeof payload === 'object') {
    const tp = (payload as PageShape).total_pages
    if (typeof tp === 'number' && Number.isFinite(tp)) return tp
  }
  return null
}

function extractIds(payload: unknown, into: Set<number>): void {
  if (payload && typeof payload === 'object') {
    const results = (payload as PageShape).results
    if (Array.isArray(results)) {
      for (const item of results) {
        if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'number') {
          into.add((item as { id: number }).id)
        }
      }
    }
  }
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name
  return 'error'
}

/**
 * Executa um job paginado a partir do checkpoint (se `resume`), respeitando
 * `maxPages` e `total_pages`. Persiste o checkpoint apos cada pagina.
 */
export async function runListSync(opts: ListSyncOptions, deps: ListSyncDeps): Promise<ListSyncResult> {
  const previous = opts.resume ? await deps.checkpoint.load(opts.job, opts.paramsHash) : null
  if (previous?.done) {
    return {
      job: opts.job, startPage: previous.lastPage, pagesFetched: 0, lastPage: previous.lastPage,
      totalPages: previous.totalPages, done: true, uniqueIds: 0, status: 'empty',
    }
  }

  const startPage = previous ? previous.lastPage + 1 : 1
  const ids = new Set<number>()
  let pagesFetched = 0
  let lastFetchedPage = previous?.lastPage ?? 0
  let totalPages: number | null = previous?.totalPages ?? null
  let done = false
  let status: SyncStatus = 'success'

  for (let page = startPage; pagesFetched < opts.maxPages; page += 1) {
    let data: unknown
    let payloadHash: string | null = null
    try {
      const result = await deps.cache.getOrFetch<unknown>({
        endpoint: opts.endpoint,
        params: { page },
        fetcher: () => opts.fetchPage(page),
      })
      data = result.data
      payloadHash = result.payloadHash
    } catch (err) {
      status = 'failed'
      await deps.log.write({ endpoint: opts.endpoint, status, errorCode: errorCode(err), itemsProcessed: pagesFetched })
      break
    }

    const tp = readTotalPages(data)
    if (tp !== null) totalPages = tp
    extractIds(data, ids)
    pagesFetched += 1
    lastFetchedPage = page

    done = totalPages !== null && page >= totalPages
    await deps.checkpoint.save(opts.job, opts.paramsHash, { lastPage: page, totalPages, done })
    await deps.log.write({ endpoint: opts.endpoint, status: 'success', itemsProcessed: 1, payloadHash })

    if (done) break
  }

  return {
    job: opts.job, startPage, pagesFetched, lastPage: lastFetchedPage,
    totalPages, done, uniqueIds: ids.size, status,
  }
}
