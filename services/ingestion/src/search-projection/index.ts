/**
 * search-projection — Backfill + atualizacao incremental de search_documents
 * (Backend A, secao 9). PURO: sem DB, sem rede.
 *
 * A leitura das entidades entra pela porta `SearchProjectionSourcePort` (o
 * adapter Prisma vive em persistence/, fora do typecheck) e a escrita sai pela
 * `SearchStorePort`. Este modulo so orquestra: pagina, projeta e conta.
 *
 * Duas entradas:
 *  - `reindexAll` — backfill: varre o universo indexavel por tipo, em lotes.
 *  - `reindexEntity` — incremental: reprojeta UMA entidade. Quando a entidade
 *    deixa de existir (ou de ser indexavel), REMOVE o documento — e o caminho
 *    de limpeza de documento obsoleto, sem o qual a busca devolveria link morto.
 *
 * Governanca: worker-only (invariantes 3/4 — nada disto roda no render).
 */

import { CatalogJobInputError } from '../catalog-jobs/handler.js'
import type { StructuredLogger } from '../catalog-jobs/handler.js'
import { CATALOG_METRIC_NAMES } from '../metrics/index.js'
import type { MetricsSink } from '../metrics/index.js'
import { buildSearchDocument } from '../search/projection.js'
import type { SearchDocumentRow, SearchEntityType } from '../search/projection.js'
import type { SearchStorePort } from '../search/store-port.js'

/** Tipos indexaveis varridos por default no backfill. */
const DEFAULT_ENTITY_TYPES: readonly SearchEntityType[] = ['movie', 'tv', 'person']

/** Tamanho de lote default da paginacao. */
const DEFAULT_BATCH_SIZE = 200

/** Rotulo pt-BR por tipo de entidade (invariante 11: o tipo e sempre textual). */
const ENTITY_LABEL_PT: Readonly<Record<SearchEntityType, string>> = {
  movie: 'Filme',
  tv: 'Serie',
  person: 'Pessoa',
}

/**
 * Linha crua de entidade lida do PostgreSQL, pronta para projetar.
 *
 * `subtitle` nulo delega a linha de apoio a `buildSubtitle`; a fonte so preenche
 * quando tem algo melhor que "tipo · ano".
 */
export interface SearchProjectionSourceRow {
  readonly entityType: SearchEntityType
  readonly entityId: string
  readonly primaryText: string
  readonly aliases: string[]
  readonly year: number | null
  readonly popularity: number | null
  /** file_path cru (a URL e montada no render por buildTmdbImageUrl). */
  readonly imagePath: string | null
  readonly canonicalUrl: string | null
  readonly subtitle: string | null
}

/**
 * Monta a linha de apoio do resultado: "Filme · 1999", "Serie · 2021", "Pessoa".
 *
 * Sem ano (ou ano de pessoa, que nunca entra), fica so o rotulo do tipo. Pura.
 */
export function buildSubtitle(entityType: SearchEntityType, year: number | null): string | null {
  const label = ENTITY_LABEL_PT[entityType]
  // Pessoa nunca carrega ano na linha de apoio (nascimento nao e "ano da obra").
  if (entityType === 'person' || year === null || !Number.isFinite(year)) return label
  return `${label} · ${year}`
}

/**
 * Projeta as linhas cruas em documentos de busca.
 *
 * Preenche `subtitle` via `buildSubtitle` quando a fonte nao trouxe um. Linhas
 * com `primaryText` em branco sao DESCARTADAS: documento sem titulo vira
 * resultado vazio na busca.
 */
export function planSearchDocuments(
  rows: readonly SearchProjectionSourceRow[],
  locale: string,
): SearchDocumentRow[] {
  const planned: SearchDocumentRow[] = []
  for (const row of rows) {
    if (row.primaryText.trim().length === 0) continue
    planned.push(
      buildSearchDocument({
        entityType: row.entityType,
        entityId: row.entityId,
        locale,
        primaryText: row.primaryText,
        alternativeTitles: row.aliases,
        subtitle: row.subtitle ?? buildSubtitle(row.entityType, row.year),
        year: row.year,
        popularity: row.popularity,
        imagePath: row.imagePath,
        canonicalUrl: row.canonicalUrl,
      }),
    )
  }
  return planned
}

/** Contagens de uma execucao de reindexacao. */
export interface SearchReindexReport {
  /** Linhas lidas da fonte. */
  scanned: number
  /** Documentos escritos (upsert idempotente). */
  upserted: number
  /** Linhas lidas porem nao indexaveis (ex.: titulo em branco). */
  skipped: number
  /** Documentos removidos (entidade sumiu / deixou de ser indexavel). */
  deleted: number
}

/**
 * Porta de leitura das entidades indexaveis.
 *
 * Contrato de paginacao: `readEntities` devolve ate `limit` linhas da fatia que
 * comeca em `offset` do conjunto INDEXAVEL daquele tipo (a fonte ja exclui quem
 * nao pode ser indexado, ex.: entidade sem slug canonico). Por isso uma pagina
 * curta NAO significa fim do conjunto — so a pagina vazia significa.
 */
export interface SearchProjectionSourcePort {
  /** Total de entidades do tipo (estimativa para log; nao e gate). */
  countEntities(entityType: SearchEntityType): Promise<number>
  readEntities(
    entityType: SearchEntityType,
    opts: { limit: number; offset: number; locale: string },
  ): Promise<SearchProjectionSourceRow[]>
  /** Uma entidade; `null` quando nao existe ou nao e indexavel. */
  readEntity(
    entityType: SearchEntityType,
    entityId: string,
    locale: string,
  ): Promise<SearchProjectionSourceRow | null>
}

/** Dependencias injetadas (tudo por porta: nada de Prisma aqui). */
export interface SearchReindexDeps {
  source: SearchProjectionSourcePort
  store: SearchStorePort
  metrics: MetricsSink
  log?: StructuredLogger
}

/** Opcoes do backfill. */
export interface ReindexAllOptions {
  readonly locale: string
  /** Default: movie, tv, person. */
  readonly entityTypes?: readonly SearchEntityType[]
  /** Linhas por pagina (default 200). */
  readonly batchSize?: number
  /** Teto TOTAL de linhas varridas na execucao (smoke run). Sem teto por default. */
  readonly limit?: number
}

/** Rejeita locale em branco: indexar sob locale vazio corrompe a chave natural. */
function requireLocale(locale: string): string {
  const trimmed = locale.trim()
  if (trimmed.length === 0) throw new CatalogJobInputError('locale obrigatorio')
  return trimmed
}

/** Normaliza o tamanho de lote para um inteiro >= 1. */
function normalizeBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) return DEFAULT_BATCH_SIZE
  const size = Math.floor(batchSize)
  return size < 1 ? 1 : size
}

/**
 * Backfill: varre e reprojeta todas as entidades indexaveis dos tipos pedidos.
 *
 * Emite `search_documents_total` (gauge) no fim: apos um backfill completo o
 * valor e a contagem de documentos indexados naquele locale (com `limit`, e
 * parcial). Nunca remove documento — remocao e trabalho de `reindexEntity`.
 */
export async function reindexAll(
  deps: SearchReindexDeps,
  opts: ReindexAllOptions,
): Promise<SearchReindexReport> {
  const locale = requireLocale(opts.locale)
  const entityTypes = opts.entityTypes ?? DEFAULT_ENTITY_TYPES
  const batchSize = normalizeBatchSize(opts.batchSize)
  const maxRows = opts.limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, opts.limit)
  const report: SearchReindexReport = { scanned: 0, upserted: 0, skipped: 0, deleted: 0 }

  for (const entityType of entityTypes) {
    if (report.scanned >= maxRows) break

    const total = await deps.source.countEntities(entityType)
    deps.log?.log('info', 'search_reindex_type_started', { entityType, locale, total, batchSize })

    let typeUpserted = 0
    // Avanca por `batchSize` (nao por batch.length): a fonte pode devolver pagina
    // curta ao filtrar linhas nao indexaveis dentro da fatia. So a pagina VAZIA
    // encerra o tipo.
    for (let offset = 0; ; offset += batchSize) {
      const remaining = maxRows - report.scanned
      if (remaining <= 0) break
      const pageSize = Math.min(batchSize, remaining)

      const batch = await deps.source.readEntities(entityType, { limit: pageSize, offset, locale })
      if (batch.length === 0) break

      const planned = planSearchDocuments(batch, locale)
      for (const row of planned) {
        await deps.store.upsertDocument(row)
      }

      report.scanned += batch.length
      report.upserted += planned.length
      report.skipped += batch.length - planned.length
      typeUpserted += planned.length
    }

    deps.log?.log('info', 'search_reindex_type_finished', {
      entityType,
      locale,
      upserted: typeUpserted,
    })
  }

  deps.metrics.gauge(CATALOG_METRIC_NAMES.searchDocumentsTotal, report.upserted, { locale })
  deps.log?.log('info', 'search_reindex_finished', { locale, ...report })
  return report
}

/**
 * Incremental: reprojeta UMA entidade.
 *
 * Encontrada e indexavel -> upsert. Ausente (deletada, despublicada, sem slug
 * canonico) -> `deleteDocument`: e a remocao de documento obsoleto, que impede a
 * busca de apontar para pagina que nao existe mais. Titulo em branco tambem
 * remove: o que nao pode ser indexado nao pode ficar indexado.
 */
export async function reindexEntity(
  deps: SearchReindexDeps,
  entityType: SearchEntityType,
  entityId: string,
  locale: string,
): Promise<SearchReindexReport> {
  const normalizedLocale = requireLocale(locale)
  const row = await deps.source.readEntity(entityType, entityId, normalizedLocale)

  if (row === null) {
    await deps.store.deleteDocument(entityType, entityId, normalizedLocale)
    deps.log?.log('info', 'search_document_deleted', {
      entityType,
      entityId,
      locale: normalizedLocale,
      reason: 'entity_not_indexable',
    })
    return { scanned: 0, upserted: 0, skipped: 0, deleted: 1 }
  }

  const planned = planSearchDocuments([row], normalizedLocale)
  const document = planned[0]
  if (document === undefined) {
    // Existe, mas nao projeta (titulo em branco): remove qualquer documento antigo.
    await deps.store.deleteDocument(entityType, entityId, normalizedLocale)
    deps.log?.log('warn', 'search_document_deleted', {
      entityType,
      entityId,
      locale: normalizedLocale,
      reason: 'blank_primary_text',
    })
    return { scanned: 1, upserted: 0, skipped: 1, deleted: 1 }
  }

  await deps.store.upsertDocument(document)
  return { scanned: 1, upserted: 1, skipped: 0, deleted: 0 }
}
