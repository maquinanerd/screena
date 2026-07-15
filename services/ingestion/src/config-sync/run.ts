/**
 * run.ts — Orquestracao PURA do sync de TAXONOMIA/CONFIGURACAO do TMDB (Fase 6).
 *
 * Depende SO de portas (nunca do Prisma nem do client concreto) — testavel com
 * fakes em memoria. Para cada endpoint de taxonomia:
 *  1. captura o payload BRUTO integral em `api_cache` (via CachePort.getOrFetch);
 *  2. registra o ciclo em `api_sync_logs` (via SyncLogPort) — todo sync gera log;
 *  3. para `/configuration`, normaliza o subset em `tmdb_image_config`.
 *
 * Idempotente: o cache faz short-circuit por payload hash; a normalizacao so
 * reescreve quando o conteudo muda. Os demais endpoints ficam `raw_captured`
 * (payload preservado; normalizacao propria e roadmap — nunca descartado).
 */

import type { CachePort, SyncLogPort, SyncStatus } from '../ports.js'
import { normalizeGenres, type GenresStorePort } from '../catalog-sync/genres-normalize.js'
import { normalizeImageConfig, type ImageConfigRow } from './normalize.js'

/** Endpoints de genero -> media_type normalizado. */
const GENRE_MEDIA: Readonly<Record<string, 'movie' | 'tv'>> = {
  '/genre/movie/list': 'movie',
  '/genre/tv/list': 'tv',
}

/** Porta de leitura das taxonomias TMDB (client real ou fake de teste). */
export interface TaxonomyReadPort {
  getConfiguration(): Promise<unknown>
  getMovieGenres(): Promise<unknown>
  getTvGenres(): Promise<unknown>
  getMovieCertifications(): Promise<unknown>
  getTvCertifications(): Promise<unknown>
  getCountries(): Promise<unknown>
  getLanguages(): Promise<unknown>
  getJobs(): Promise<unknown>
}

/** Resultado de um upsert de `tmdb_image_config`. */
export interface ImageConfigUpsertOutcome {
  readonly created: boolean
  readonly changed: boolean
}

/** Porta de persistencia da linha singleton `tmdb_image_config`. */
export interface ImageConfigStorePort {
  upsert(row: ImageConfigRow): Promise<ImageConfigUpsertOutcome>
}

/** Especificacao de um endpoint de taxonomia (endpoint canonico + fetcher). */
interface TaxonomySpec {
  readonly endpoint: string
  readonly fetch: (read: TaxonomyReadPort) => Promise<unknown>
}

/** Os 8 endpoints de taxonomia/config capturados nesta fase (ordem estavel). */
export const TAXONOMY_ENDPOINTS: readonly TaxonomySpec[] = [
  { endpoint: '/configuration', fetch: (r) => r.getConfiguration() },
  { endpoint: '/genre/movie/list', fetch: (r) => r.getMovieGenres() },
  { endpoint: '/genre/tv/list', fetch: (r) => r.getTvGenres() },
  { endpoint: '/certification/movie/list', fetch: (r) => r.getMovieCertifications() },
  { endpoint: '/certification/tv/list', fetch: (r) => r.getTvCertifications() },
  { endpoint: '/configuration/countries', fetch: (r) => r.getCountries() },
  { endpoint: '/configuration/languages', fetch: (r) => r.getLanguages() },
  { endpoint: '/configuration/jobs', fetch: (r) => r.getJobs() },
]

/** Dependencias do sync (todas injetaveis). */
export interface TaxonomySyncDeps {
  readonly read: TaxonomyReadPort
  readonly cache: CachePort
  readonly log: SyncLogPort
  readonly imageConfigStore: ImageConfigStorePort
  /** Opcional: quando presente, normaliza /genre/{movie,tv}/list em `genres`. */
  readonly genresStore?: GenresStorePort
  readonly now: () => Date
}

/** Resultado por endpoint. */
export interface TaxonomyEndpointResult {
  readonly endpoint: string
  readonly status: SyncStatus
  readonly changed: boolean
  readonly fromCache: boolean
}

/** Resumo do ciclo de taxonomia. */
export interface TaxonomySyncSummary {
  readonly endpoints: TaxonomyEndpointResult[]
  readonly imageConfig: { readonly normalized: boolean; readonly created: boolean; readonly changed: boolean }
  readonly genres: { readonly normalized: number; readonly created: number; readonly updated: number }
}

const CONFIG_ENDPOINT = '/configuration'

/** Mensagem curta de erro (nunca vaza token/URL/segredo). */
function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name
  return 'error'
}

/**
 * Executa o sync de taxonomia. SEMPRE aplica (fetch/cache/log/normalize) — o modo
 * dry-run e responsabilidade do CLI (nao chamar esta funcao). Nao lanca por
 * endpoint: uma falha isolada e logada como `failed` e o ciclo continua.
 */
export async function runTaxonomySync(deps: TaxonomySyncDeps): Promise<TaxonomySyncSummary> {
  const endpoints: TaxonomyEndpointResult[] = []
  let imageConfig = { normalized: false, created: false, changed: false }
  const genres = { normalized: 0, created: 0, updated: 0 }

  for (const spec of TAXONOMY_ENDPOINTS) {
    let status: SyncStatus = 'success'
    let changed = false
    let fromCache = false
    let payloadHash: string | null = null
    let data: unknown

    try {
      const result = await deps.cache.getOrFetch<unknown>({
        endpoint: spec.endpoint,
        fetcher: () => spec.fetch(deps.read),
      })
      data = result.data
      changed = result.changed
      fromCache = result.fromCache
      payloadHash = result.payloadHash
    } catch (err) {
      status = 'failed'
      await deps.log.write({ endpoint: spec.endpoint, status, errorCode: errorCode(err) })
      endpoints.push({ endpoint: spec.endpoint, status, changed, fromCache })
      continue
    }

    // Normalizacao: /configuration -> tmdb_image_config; /genre/* -> genres.
    const genreMedia = GENRE_MEDIA[spec.endpoint]
    let itemsCreated = 0
    let itemsUpdated = 0
    if (spec.endpoint === CONFIG_ENDPOINT) {
      const row = normalizeImageConfig(data)
      if (row === null) {
        status = 'partial'
        imageConfig = { normalized: false, created: false, changed: false }
      } else {
        const outcome = await deps.imageConfigStore.upsert(row)
        itemsCreated = outcome.created ? 1 : 0
        itemsUpdated = !outcome.created && outcome.changed ? 1 : 0
        imageConfig = { normalized: true, created: outcome.created, changed: outcome.changed }
      }
    } else if (deps.genresStore && genreMedia) {
      // Normalizacao de generos (Fase 6): /genre/{movie,tv}/list -> `genres`.
      const rows = normalizeGenres(genreMedia, data)
      if (rows.length > 0) {
        const outcome = await deps.genresStore.upsert(rows)
        itemsCreated = outcome.created
        itemsUpdated = outcome.updated
        genres.normalized += rows.length
        genres.created += outcome.created
        genres.updated += outcome.updated
      }
    }

    await deps.log.write({
      endpoint: spec.endpoint,
      status,
      itemsProcessed: 1,
      itemsCreated,
      itemsUpdated,
      payloadHash,
    })
    endpoints.push({ endpoint: spec.endpoint, status, changed, fromCache })
  }

  return { endpoints, imageConfig, genres }
}
