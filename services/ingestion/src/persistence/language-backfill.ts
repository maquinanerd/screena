/**
 * language-backfill.ts — RECUPERA `original_language` do payload que JA ESTA no
 * banco. Coberto por `tsconfig.runtime.json`.
 *
 * ============================================================================
 * ZERO CHAMADAS AO TMDB
 * ============================================================================
 * O idioma ja foi baixado e pago: `original_language` e um campo de TOPO de
 * `/movie/{id}` e `/tv/{id}`, e a resposta inteira esta em `api_cache.payload` e
 * em `tmdb_raw.payload`. O que faltava era LEITURA — `normalizeOriginalLanguage`
 * validava contra uma tabela `languages` de TRES linhas e jogava fora tudo o
 * que nao fosse `en`/`es`.
 *
 * `externalCallsMade` e SEMPRE 0, e existe no relatorio exatamente para que essa
 * afirmacao seja verificavel e nao apenas escrita num comentario.
 *
 * ============================================================================
 * A CONSULTA NAO DECIDE NADA — QUEM DECIDE E `readOriginalLanguage`
 * ============================================================================
 * O SQL devolve o codigo CRU dos dois payloads e para por ai. Quem julga se o
 * codigo e gravavel e `readOriginalLanguage` (TypeScript), que e a MESMA funcao
 * que a ingestao usa em tempo de sync. Duas regras diferentes — uma no SQL do
 * backfill, outra no normalizador — dariam um acervo com criterio distinto do
 * fluxo, que e como se produz uma coluna que ninguem consegue explicar.
 *
 * Note que este backfill NAO aplica o recorte de cinco idiomas. Ele grava o
 * idioma REAL, seja qual for. Aplicar o recorte aqui destruiria a medicao da
 * Parte B (nao daria para contar quantos titulos `te` existem se `te` nunca
 * fosse escrito) e apagaria o criterio do apagamento da Parte D. O recorte e
 * decisao de PORTA (`./admission.ts`) e de DELETE, nunca de leitura.
 *
 * ============================================================================
 * SO PREENCHE VAZIO — E A GARANTIA E DO POSTGRES
 * ============================================================================
 * A escrita e `UPDATE ... WHERE original_language IS NULL`. O predicado esta na
 * MESMA instrucao que grava, nao num `SELECT` anterior que uma execucao
 * concorrente invalidaria. Numa segunda execucao o numero de linhas afetadas e
 * zero, e esse zero aparece no relatorio como `refusedAlreadyFilled` — nao como
 * silencio.
 *
 * ============================================================================
 * RETOMAVEL SEM CHECKPOINT EXTERNO
 * ============================================================================
 * O conjunto de candidatos e "linhas com `original_language IS NULL`". Preencher
 * uma linha a RETIRA do conjunto. Entao reexecutar continua de onde parou por
 * construcao, sem arquivo de estado — e `resumeFrom`/`checkpoint` existem so
 * para retomar dentro de uma MESMA passagem longa (o cursor por `id`).
 */

import type { PrismaClient } from '@screena/db/server'

import { readOriginalLanguage } from '../utils/normalize.js'

/** Tipos com idioma original recuperavel. */
export const LANGUAGE_BACKFILLABLE_TYPES = ['movie', 'tv'] as const

/** Um tipo elegivel. */
export type LanguageBackfillEntityType = (typeof LANGUAGE_BACKFILLABLE_TYPES)[number]

/** De qual tabela o payload veio. */
export type StoredPayloadSource = 'api_cache' | 'tmdb_raw'

/** Motivo de um candidato nao ter tido o idioma recuperado. */
export type LanguageBackfillSkipReason =
  /** Nao ha payload guardado (nem `api_cache`, nem `tmdb_raw`) para o tmdb_id. */
  | 'no_stored_payload'
  /** Ha payload, e ele nao traz `original_language` (ou traz vazio). */
  | 'no_language_in_payload'
  /**
   * O payload traz um codigo que NAO existe em `languages`.
   *
   * Gravar estouraria a FK e derrubaria o lote. Fica contado por codigo em
   * `unknownCodes` — se este balde tiver volume, o vocabulario ISO 639-1 em
   * `@screena/db` precisa de mais uma linha, e o relatorio diz exatamente qual.
   */
  | 'language_not_in_dictionary'

/** Relatorio de UMA execucao do backfill de idioma. */
export interface LanguageBackfillReport {
  readonly dryRun: boolean
  /** Entidades com `original_language IS NULL` encontradas nesta execucao. */
  readonly candidates: number
  /** Idioma efetivamente lido do payload (gravado, ou gravavel em dry-run). */
  readonly recovered: number
  /** Linhas realmente escritas. `0` em dry-run, sempre. */
  readonly written: number
  /**
   * Escritas que o `WHERE original_language IS NULL` RECUSOU porque outra
   * execucao ja havia preenchido. Numa segunda passagem isto e a prova de
   * idempotencia.
   */
  readonly refusedAlreadyFilled: number
  /** Distribuicao do que foi recuperado, por codigo de idioma. */
  readonly byLanguage: Readonly<Record<string, number>>
  /** Distribuicao por tipo de entidade. */
  readonly byType: Readonly<Record<string, number>>
  /** De qual tabela o payload foi lido. */
  readonly byPayloadSource: Readonly<Record<StoredPayloadSource, number>>
  /** Candidatos nao recuperados, por motivo. */
  readonly skipped: Readonly<Record<string, number>>
  /** Codigos recusados pelo dicionario, com quantas vezes cada um apareceu. */
  readonly unknownCodes: Readonly<Record<string, number>>
  /**
   * SEMPRE 0. A afirmacao "este backfill nao chama o TMDB" precisa ser
   * verificavel no relatorio, nao so no comentario de cabecalho.
   */
  readonly externalCallsMade: 0
  /** Ultimo id visitado por tipo (retomada dentro da mesma passagem). */
  readonly checkpoint: Readonly<Record<string, string>>
  /** Amostra para conferencia humana. */
  readonly samples: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly tmdbId: number
    readonly title: string
    readonly language: string
    readonly from: StoredPayloadSource
  }[]
}

/** Opcoes de uma execucao. */
export interface LanguageBackfillOptions {
  readonly entityTypes?: readonly LanguageBackfillEntityType[]
  /** Teto de candidatos POR TIPO nesta execucao. */
  readonly limit?: number
  readonly batchSize?: number
  readonly dryRun: boolean
  readonly resumeFrom?: Readonly<Record<string, string>>
  readonly onBatch?: (progress: {
    readonly entityType: LanguageBackfillEntityType
    readonly seen: number
    readonly recovered: number
    readonly lastId: string
  }) => void
}

/** Tabela canonica e coluna de titulo por tipo. */
const TABLE: Record<LanguageBackfillEntityType, { table: string; titleColumn: string }> = {
  movie: { table: 'movies', titleColumn: 'title_original' },
  tv: { table: 'tv_shows', titleColumn: 'name_original' },
}

/**
 * Endpoint de `api_cache` e `entity_type` de `tmdb_raw`, por tipo.
 *
 * `api_cache.request_key` carrega a querystring, e ela ja mudou de forma nesta
 * base. Casar por `endpoint`, que e estavel, e o que mantem o backfill
 * funcionando sobre linhas de varias epocas; `ORDER BY fetched_at DESC`
 * desempata quando ha mais de uma variante de chave.
 */
const CACHE_ENDPOINT: Record<LanguageBackfillEntityType, string> = {
  movie: '/movie/',
  tv: '/tv/',
}

/** Enum de `tmdb_raw.entity_type` por tipo. */
const RAW_KIND: Record<LanguageBackfillEntityType, string> = {
  movie: 'movie',
  tv: 'tv',
}

/** Uma linha candidata, com o codigo cru dos dois depositos. */
interface CandidateRow {
  readonly entity_id: bigint
  readonly tmdb_id: number
  readonly fallback_title: string
  readonly cache_language: string | null
  readonly raw_language: string | null
}

/**
 * Candidatos: entidades com `original_language IS NULL`, com o codigo cru dos
 * dois depositos ja anexado.
 *
 * A reducao para `->> 'original_language'` e o ponto: um detalhe de filme
 * popular com todos os appends passa de 300 KB, e um lote de 1.000 linhas
 * traria centenas de megabytes para ler duas letras. Extrair o campo no SQL nao
 * DECIDE nada (a decisao e de `readOriginalLanguage`); so evita transportar o
 * payload inteiro.
 */
async function readCandidates(
  prisma: PrismaClient,
  entityType: LanguageBackfillEntityType,
  limit: number,
  afterId: bigint,
): Promise<CandidateRow[]> {
  const { table, titleColumn } = TABLE[entityType]

  return prisma.$queryRawUnsafe<CandidateRow[]>(
    `SELECT e.id AS entity_id,
            e.tmdb_id,
            e.${titleColumn} AS fallback_title,
            (SELECT c.payload ->> 'original_language'
               FROM api_cache c
              WHERE c.provider_api = 'tmdb'
                AND c.endpoint = '${CACHE_ENDPOINT[entityType]}' || e.tmdb_id::text
              ORDER BY c.fetched_at DESC
              LIMIT 1) AS cache_language,
            (SELECT r.payload ->> 'original_language'
               FROM tmdb_raw r
              WHERE r.entity_type = '${RAW_KIND[entityType]}'::"TmdbEntityKind"
                AND r.tmdb_id = e.tmdb_id
              ORDER BY r.fetched_at DESC
              LIMIT 1) AS raw_language
       FROM ${table} e
      WHERE e.id > ${afterId.toString()}
        AND e.original_language IS NULL
      ORDER BY e.id
      LIMIT ${Math.max(1, Math.floor(limit))}`,
  )
}

/**
 * Grava o idioma. UM statement, com o guard na propria instrucao.
 *
 * EXPORTADA de proposito: rodando o backfill inteiro, uma linha que ja tem
 * idioma simplesmente nao entra no conjunto de candidatos — entao um check do
 * tipo "nao sobrescreveu" passa VERDE sem que o `WHERE` tenha sido exercido uma
 * unica vez. O que ele protege e a CORRIDA (outro processo gravando entre a
 * leitura e a escrita), e so chamando a funcao diretamente da para provar que o
 * PostgreSQL recusa. Devolve o numero de linhas afetadas; `0` = recusada.
 */
export async function writeOriginalLanguageIfEmpty(
  prisma: PrismaClient,
  entityType: LanguageBackfillEntityType,
  entityId: bigint,
  language: string,
): Promise<number> {
  const { table } = TABLE[entityType]
  // `updated_at` NAO e bumpado: recuperar um campo que sempre esteve no payload
  // nao e uma mudanca de conteudo, e bumpar faria a fila de frescor considerar
  // 41 mil titulos "recem-tocados" e adiar o sync real deles.
  return prisma.$executeRawUnsafe(
    `UPDATE ${table} SET original_language = $1
      WHERE id = $2::bigint AND original_language IS NULL`,
    language,
    entityId.toString(),
  )
}

/** Lote default. Uma linha por candidato tem ~40 bytes; 1.000 e folgado. */
export const DEFAULT_LANGUAGE_BATCH_SIZE = 1_000

/** Executa o backfill de idioma original. NUNCA chama o TMDB. */
export async function backfillOriginalLanguage(
  prisma: PrismaClient,
  options: LanguageBackfillOptions,
): Promise<LanguageBackfillReport> {
  const types = options.entityTypes ?? LANGUAGE_BACKFILLABLE_TYPES
  const batchSize = options.batchSize ?? DEFAULT_LANGUAGE_BATCH_SIZE
  const cap = options.limit ?? null

  const skipped: Record<string, number> = {}
  const byLanguage: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const unknownCodes: Record<string, number> = {}
  const byPayloadSource: Record<StoredPayloadSource, number> = { api_cache: 0, tmdb_raw: 0 }
  const checkpoint: Record<string, string> = {}
  const samples: LanguageBackfillReport['samples'][number][] = []
  let candidates = 0
  let recovered = 0
  let written = 0
  let refusedAlreadyFilled = 0

  const skip = (reason: LanguageBackfillSkipReason): void => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const entityType of types) {
    let after = BigInt(options.resumeFrom?.[entityType] ?? '0')
    let vistos = 0

    for (;;) {
      const restante = cap === null ? batchSize : Math.min(batchSize, cap - vistos)
      if (restante <= 0) break
      const rows = await readCandidates(prisma, entityType, restante, after)
      if (rows.length === 0) break

      for (const row of rows) {
        candidates += 1
        vistos += 1
        after = row.entity_id
        checkpoint[entityType] = String(row.entity_id)

        // `api_cache` primeiro (muito mais populado), `tmdb_raw` depois. O
        // primeiro que produzir um codigo GRAVAVEL ganha — nao o primeiro que
        // existir. Sem isso, um `api_cache` com codigo fora do dicionario
        // impediria a leitura de um `tmdb_raw` perfeitamente bom.
        let gravavel: { code: string; from: StoredPayloadSource } | null = null
        let recusado: string | null = null
        let havia = false
        for (const [cru, from] of [
          [row.cache_language, 'api_cache' as const],
          [row.raw_language, 'tmdb_raw' as const],
        ] as const) {
          if (cru === null) continue
          havia = true
          const leitura = readOriginalLanguage(cru)
          if (leitura.code !== null) {
            gravavel = { code: leitura.code, from }
            break
          }
          if (leitura.rejected !== null) recusado = leitura.rejected
        }

        if (gravavel === null) {
          if (recusado !== null) {
            unknownCodes[recusado] = (unknownCodes[recusado] ?? 0) + 1
            skip('language_not_in_dictionary')
          } else if (havia) {
            // Havia payload, e o campo veio vazio/em branco.
            skip('no_language_in_payload')
          } else {
            skip('no_stored_payload')
          }
          continue
        }

        recovered += 1
        byLanguage[gravavel.code] = (byLanguage[gravavel.code] ?? 0) + 1
        byType[entityType] = (byType[entityType] ?? 0) + 1
        byPayloadSource[gravavel.from] += 1
        if (samples.length < 20) {
          samples.push({
            entityType,
            entityId: String(row.entity_id),
            tmdbId: row.tmdb_id,
            title: row.fallback_title,
            language: gravavel.code,
            from: gravavel.from,
          })
        }

        if (options.dryRun) continue

        const afetadas = await writeOriginalLanguageIfEmpty(
          prisma,
          entityType,
          row.entity_id,
          gravavel.code,
        )
        if (afetadas > 0) written += afetadas
        else refusedAlreadyFilled += 1
      }

      options.onBatch?.({ entityType, seen: vistos, recovered, lastId: String(after) })
      if (rows.length < restante) break
    }
  }

  return {
    dryRun: options.dryRun,
    candidates,
    recovered,
    written,
    refusedAlreadyFilled,
    byLanguage: Object.freeze(
      Object.fromEntries(Object.entries(byLanguage).sort((a, b) => b[1] - a[1])),
    ),
    byType: Object.freeze(byType),
    byPayloadSource: Object.freeze(byPayloadSource),
    skipped: Object.freeze(skipped),
    unknownCodes: Object.freeze(
      Object.fromEntries(Object.entries(unknownCodes).sort((a, b) => b[1] - a[1])),
    ),
    externalCallsMade: 0,
    checkpoint: Object.freeze(checkpoint),
    samples,
  }
}
