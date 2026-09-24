/**
 * country-backfill.ts — GRAVA o pais de origem que JA ESTA no payload guardado,
 * so em titulo que nao tem pais nenhum. Coberto por `tsconfig.runtime.json`.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * Medido em producao em 24/09/2026: 24 titulos (19 filmes e 5 series do
 * bootstrap de 10/07 — ex.: filmes tmdb 272, 602, 605, 607, 621; series 36, 186,
 * 314, 433, 500) tem pais no payload de `api_cache` e NENHUM pais gravado. Duas
 * causas juntas:
 *
 *   1. `movie_production_countries` e `tv_show_origin_countries` nasceram em
 *      20/08 SEM backfill — quem ja estava no catalogo ficou sem pais;
 *   2. o caminho de payload inalterado (`!result.changed && touch*`, em
 *      `import/import-movie.ts` e `import-tv.ts`) so atualizava carimbos de
 *      frescor e nunca gravava o pais. Com o hash igual, nenhum sync posterior
 *      passava pelo upsert.
 *
 * A causa 2 e fechada no import (`EntityStorePort.fillMissingTitleCountries`).
 * Este modulo fecha a causa 1, sem esperar o payload do TMDB mudar.
 *
 * ============================================================================
 * O QUE NAO E DEFEITO — E O RELATORIO SEPARA
 * ============================================================================
 * Dos 14.963 titulos sem pais, 14.939 tem a lista VAZIA no proprio payload do
 * TMDB. Isso e dado medido, nao lacuna nossa: o backfill conta esses como
 * `empty_country_list_in_payload` e NAO inventa pais para eles.
 *
 * ============================================================================
 * ZERO CHAMADAS AO TMDB · SO PREENCHE VAZIO · A CONSULTA NAO DECIDE
 * ============================================================================
 * - Le `api_cache` (por `endpoint`, o mais recente) e `tmdb_raw` como reserva.
 *   `externalCallsMade` e SEMPRE 0 e esta no relatorio para ser verificavel.
 * - Quem transforma o JSON em codigos e `normalizeMovieProductionCountries` /
 *   `normalizeTvOriginCountries` — as MESMAS funcoes da ingestao. O SQL so
 *   extrai o campo (para nao transportar payload de 300 KB por titulo).
 * - A escrita e UM `INSERT ... SELECT ... WHERE NOT EXISTS (pais do titulo)`: o
 *   guard esta na instrucao que grava, nao num SELECT anterior que uma execucao
 *   concorrente invalidaria. Titulo que ja tem pais nunca e reescrito, e o
 *   titulo em si (`movies`/`tv_shows`, `updated_at`) nao e tocado.
 * - Retomavel por construcao: gravar pais RETIRA o titulo do conjunto de
 *   candidatos (`NOT EXISTS`).
 *
 * ============================================================================
 * POR QUE A LEITURA E EM LOTE, E NAO UMA SUBCONSULTA POR TITULO
 * ============================================================================
 * `api_cache` nao tem indice em `endpoint` (o unico e
 * `(provider_api, request_key, params_hash)`). Uma subconsulta correlacionada
 * por candidato seria uma varredura de `api_cache` POR TITULO — ~15 mil
 * varreduras. Lendo por lote (`endpoint = ANY($1)`) sao poucas varreduras no
 * total. `tmdb_raw` tem indice unico em `(entity_type, tmdb_id, base_language)`.
 */

import type { PrismaClient } from '@screena/db/server'

import {
  normalizeMovieProductionCountries,
  normalizeTvOriginCountries,
  type NormalizedTitleCountries,
} from '../normalizers/detail-facts.js'
import type { TitleCountryLink } from '../types.js'

/** Tipos com pais de origem. */
export const COUNTRY_BACKFILLABLE_TYPES = ['movie', 'tv'] as const

/** Um tipo elegivel. */
export type CountryBackfillEntityType = (typeof COUNTRY_BACKFILLABLE_TYPES)[number]

/** De qual tabela o payload veio. */
export type CountryPayloadSource = 'api_cache' | 'tmdb_raw'

/** Motivo de um candidato NAO ter ganho pais. */
export type CountryBackfillSkipReason =
  /** Nao ha payload guardado (nem `api_cache`, nem `tmdb_raw`) para o tmdb_id. */
  | 'no_stored_payload'
  /** Ha payload, mas ele nao traz o campo de pais (payload antigo/parcial). */
  | 'no_country_field_in_payload'
  /**
   * O TMDB mandou a lista VAZIA (ou so com codigos invalidos). E o caso dos
   * ~14.939 titulos medidos: dado do upstream, nao defeito nosso.
   */
  | 'empty_country_list_in_payload'

/** O acesso ao banco que o backfill usa — so SQL cru (fakeavel em teste). */
export type CountryBackfillDb = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

/** Relatorio de UMA execucao. */
export interface CountryBackfillReport {
  readonly dryRun: boolean
  /** Titulos SEM nenhum pais gravado, visitados nesta execucao. */
  readonly candidates: number
  /** Titulos com pais legivel no payload guardado (gravado, ou gravavel em dry-run). */
  readonly recovered: number
  /** Titulos que ganharam pais de fato. `0` em dry-run, sempre. */
  readonly titlesWritten: number
  /** Linhas de pais inseridas. `0` em dry-run, sempre. */
  readonly rowsWritten: number
  /**
   * Escritas que o `NOT EXISTS` RECUSOU porque o titulo ganhou pais entre a
   * leitura e a escrita (outra execucao, ou o proprio sync). Prova do guard.
   */
  readonly refusedAlreadyFilled: number
  /** Recuperados por tipo. */
  readonly byType: Readonly<Record<string, number>>
  /** De qual tabela o pais foi lido. */
  readonly byPayloadSource: Readonly<Record<CountryPayloadSource, number>>
  /** Pais na PRIMEIRA posicao dos recuperados (conferencia rapida). */
  readonly byFirstCountry: Readonly<Record<string, number>>
  /** Candidatos nao recuperados, por motivo. */
  readonly skipped: Readonly<Record<string, number>>
  /** SEMPRE 0 — verificavel no relatorio, nao so no comentario. */
  readonly externalCallsMade: 0
  /** Ultimo id visitado por tipo. */
  readonly checkpoint: Readonly<Record<string, string>>
  /** Amostra para conferencia humana. */
  readonly samples: readonly {
    readonly entityType: CountryBackfillEntityType
    readonly entityId: string
    readonly tmdbId: number
    readonly title: string
    readonly countries: readonly string[]
    readonly from: CountryPayloadSource
  }[]
}

/** Opcoes de uma execucao. */
export interface CountryBackfillOptions {
  readonly entityTypes?: readonly CountryBackfillEntityType[]
  /** Teto de candidatos POR TIPO nesta execucao. */
  readonly limit?: number
  readonly batchSize?: number
  readonly dryRun: boolean
  readonly resumeFrom?: Readonly<Record<string, string>>
  readonly onBatch?: (progress: {
    readonly entityType: CountryBackfillEntityType
    readonly seen: number
    readonly recovered: number
    readonly lastId: string
  }) => void
}

/** Tabela, coluna de titulo, tabela de vinculo e campo do payload, por tipo. */
const SHAPE: Record<
  CountryBackfillEntityType,
  {
    readonly table: string
    readonly titleColumn: string
    readonly link: string
    readonly fk: string
    readonly payloadField: string
    readonly endpointPrefix: string
    readonly normalize: (raw: unknown) => NormalizedTitleCountries
  }
> = {
  movie: {
    table: 'movies',
    titleColumn: 'title_original',
    link: 'movie_production_countries',
    fk: 'movie_id',
    payloadField: 'production_countries',
    endpointPrefix: '/movie/',
    normalize: normalizeMovieProductionCountries,
  },
  tv: {
    table: 'tv_shows',
    titleColumn: 'name_original',
    link: 'tv_show_origin_countries',
    fk: 'tv_show_id',
    payloadField: 'origin_country',
    endpointPrefix: '/tv/',
    normalize: normalizeTvOriginCountries,
  },
}

/**
 * Grava os paises SO se o titulo nao tem nenhum. UM statement, guard incluso.
 *
 * `by` escolhe a chave: `tmdb_id` (o import, que so conhece o id do TMDB) ou
 * `id` (o backfill, que ja leu o id interno). EXPORTADA de proposito: rodando o
 * backfill inteiro, titulo com pais nem entra nos candidatos — entao "nao
 * sobrescreveu" passaria VERDE sem o `NOT EXISTS` ter sido exercido. So chamando
 * direto da para provar que o PostgreSQL recusa.
 *
 * Devolve o numero de linhas inseridas; `0` = recusada (ja tinha pais), lista
 * vazia, ou titulo inexistente. O titulo (`movies`/`tv_shows`) nao e tocado.
 */
export async function writeTitleCountriesIfEmpty(
  db: Pick<PrismaClient, '$executeRawUnsafe'>,
  kind: CountryBackfillEntityType,
  by: 'id' | 'tmdb_id',
  key: bigint | number,
  countries: readonly TitleCountryLink[],
): Promise<number> {
  if (countries.length === 0) return 0
  const { table, link, fk } = SHAPE[kind]
  const keyCast = by === 'id' ? 'bigint' : 'integer'
  return db.$executeRawUnsafe(
    `INSERT INTO ${link} (${fk}, country_code, position)
     SELECT e.id, c.code, c.pos
       FROM ${table} e
      CROSS JOIN unnest($1::text[], $2::integer[]) AS c(code, pos)
      WHERE e.${by} = $3::${keyCast}
        AND NOT EXISTS (SELECT 1 FROM ${link} x WHERE x.${fk} = e.id)
     ON CONFLICT DO NOTHING`,
    countries.map((c) => c.countryCode),
    countries.map((c) => c.position),
    key.toString(),
  )
}

/** Candidato: titulo sem nenhum pais gravado. */
interface CandidateRow {
  readonly entity_id: bigint
  readonly tmdb_id: number
  readonly title: string
}

/**
 * O campo de pais de UM payload guardado, embrulhado: `{ v: <campo> }`.
 * Linha ausente = nao ha payload; `v: null` = payload sem o campo.
 */
interface StoredCountriesRow {
  readonly key: string | number
  readonly countries: { readonly v: unknown } | null
}

async function readCandidates(
  db: CountryBackfillDb,
  kind: CountryBackfillEntityType,
  limit: number,
  afterId: bigint,
): Promise<CandidateRow[]> {
  const { table, titleColumn, link, fk } = SHAPE[kind]
  return db.$queryRawUnsafe<CandidateRow[]>(
    `SELECT e.id AS entity_id, e.tmdb_id, e.${titleColumn} AS title
       FROM ${table} e
      WHERE e.id > $1::bigint
        AND NOT EXISTS (SELECT 1 FROM ${link} x WHERE x.${fk} = e.id)
      ORDER BY e.id
      LIMIT $2::integer`,
    afterId.toString(),
    Math.max(1, Math.floor(limit)),
  )
}

/** O campo de pais do `api_cache` mais recente de cada endpoint do lote. */
async function readCacheCountries(
  db: CountryBackfillDb,
  kind: CountryBackfillEntityType,
  tmdbIds: readonly number[],
): Promise<Map<number, unknown>> {
  const { payloadField, endpointPrefix } = SHAPE[kind]
  const endpoints = tmdbIds.map((id) => `${endpointPrefix}${id}`)
  const rows = await db.$queryRawUnsafe<StoredCountriesRow[]>(
    `SELECT DISTINCT ON (c.endpoint)
            c.endpoint AS key,
            jsonb_build_object('v', c.payload -> '${payloadField}') AS countries
       FROM api_cache c
      WHERE c.provider_api = 'tmdb'
        AND c.endpoint = ANY($1::text[])
      ORDER BY c.endpoint, c.fetched_at DESC`,
    endpoints,
  )
  const byId = new Map<number, unknown>()
  for (const row of rows) {
    const id = Number(String(row.key).slice(endpointPrefix.length))
    if (Number.isInteger(id)) byId.set(id, row.countries?.v ?? null)
  }
  return byId
}

/** O campo de pais do `tmdb_raw` mais recente de cada tmdb_id do lote. */
async function readRawCountries(
  db: CountryBackfillDb,
  kind: CountryBackfillEntityType,
  tmdbIds: readonly number[],
): Promise<Map<number, unknown>> {
  const { payloadField } = SHAPE[kind]
  const rows = await db.$queryRawUnsafe<StoredCountriesRow[]>(
    `SELECT DISTINCT ON (r.tmdb_id)
            r.tmdb_id AS key,
            jsonb_build_object('v', r.payload -> '${payloadField}') AS countries
       FROM tmdb_raw r
      WHERE r.entity_type = '${kind}'::"TmdbEntityKind"
        AND r.tmdb_id = ANY($1::integer[])
      ORDER BY r.tmdb_id, r.fetched_at DESC`,
    [...tmdbIds],
  )
  const byId = new Map<number, unknown>()
  for (const row of rows) byId.set(Number(row.key), row.countries?.v ?? null)
  return byId
}

/** Lote default: poucas varreduras de `api_cache` no total (ver cabecalho). */
export const DEFAULT_COUNTRY_BATCH_SIZE = 2_000

/** Executa o backfill de pais de origem. NUNCA chama o TMDB. */
export async function backfillTitleCountries(
  db: CountryBackfillDb,
  options: CountryBackfillOptions,
): Promise<CountryBackfillReport> {
  const types = options.entityTypes ?? COUNTRY_BACKFILLABLE_TYPES
  const batchSize = options.batchSize ?? DEFAULT_COUNTRY_BATCH_SIZE
  const cap = options.limit ?? null

  const skipped: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const byFirstCountry: Record<string, number> = {}
  const byPayloadSource: Record<CountryPayloadSource, number> = { api_cache: 0, tmdb_raw: 0 }
  const checkpoint: Record<string, string> = {}
  const samples: CountryBackfillReport['samples'][number][] = []
  let candidates = 0
  let recovered = 0
  let titlesWritten = 0
  let rowsWritten = 0
  let refusedAlreadyFilled = 0

  const skip = (reason: CountryBackfillSkipReason): void => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const kind of types) {
    const { normalize } = SHAPE[kind]
    let after = BigInt(options.resumeFrom?.[kind] ?? '0')
    let seen = 0

    for (;;) {
      const room = cap === null ? batchSize : Math.min(batchSize, cap - seen)
      if (room <= 0) break
      const rows = await readCandidates(db, kind, room, after)
      if (rows.length === 0) break

      const ids = rows.map((row) => row.tmdb_id)
      const fromCache = await readCacheCountries(db, kind, ids)
      const fromRaw = await readRawCountries(db, kind, ids)

      for (const row of rows) {
        candidates += 1
        seen += 1
        after = row.entity_id
        checkpoint[kind] = String(row.entity_id)

        // `api_cache` primeiro (mais recente e mais populado), `tmdb_raw` depois.
        // Ganha a primeira fonte com pais LEGIVEL, nao a primeira que existir:
        // um cache com lista vazia nao pode esconder um bruto com pais.
        let chosen: { links: TitleCountryLink[]; from: CountryPayloadSource } | null = null
        let hadPayload = false
        let hadField = false
        for (const [stored, from] of [
          [fromCache, 'api_cache'],
          [fromRaw, 'tmdb_raw'],
        ] as const) {
          if (!stored.has(row.tmdb_id)) continue
          hadPayload = true
          const normalized = normalize(stored.get(row.tmdb_id))
          if (!normalized.present) continue
          hadField = true
          if (normalized.links.length > 0) {
            chosen = { links: normalized.links, from }
            break
          }
        }

        if (chosen === null) {
          skip(
            !hadPayload
              ? 'no_stored_payload'
              : !hadField
                ? 'no_country_field_in_payload'
                : 'empty_country_list_in_payload',
          )
          continue
        }

        recovered += 1
        byType[kind] = (byType[kind] ?? 0) + 1
        byPayloadSource[chosen.from] += 1
        const first = chosen.links[0]!.countryCode
        byFirstCountry[first] = (byFirstCountry[first] ?? 0) + 1
        if (samples.length < 30) {
          samples.push({
            entityType: kind,
            entityId: String(row.entity_id),
            tmdbId: row.tmdb_id,
            title: row.title,
            countries: chosen.links.map((link) => link.countryCode),
            from: chosen.from,
          })
        }

        if (options.dryRun) continue

        const inserted = await writeTitleCountriesIfEmpty(db, kind, 'id', row.entity_id, chosen.links)
        if (inserted > 0) {
          titlesWritten += 1
          rowsWritten += inserted
        } else {
          refusedAlreadyFilled += 1
        }
      }

      options.onBatch?.({ entityType: kind, seen, recovered, lastId: String(after) })
      if (rows.length < room) break
    }
  }

  return {
    dryRun: options.dryRun,
    candidates,
    recovered,
    titlesWritten,
    rowsWritten,
    refusedAlreadyFilled,
    byType: Object.freeze(byType),
    byPayloadSource: Object.freeze(byPayloadSource),
    byFirstCountry: Object.freeze(
      Object.fromEntries(Object.entries(byFirstCountry).sort((a, b) => b[1] - a[1])),
    ),
    skipped: Object.freeze(skipped),
    externalCallsMade: 0,
    checkpoint: Object.freeze(checkpoint),
    samples,
  }
}
