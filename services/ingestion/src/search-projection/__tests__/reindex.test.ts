/**
 * Testes do backfill + atualizacao incremental de search_documents (PURO).
 *
 * Fonte e store sao fakes em memoria: nenhum Prisma, nenhuma rede.
 */

import { describe, expect, it } from 'vitest'
import { CATALOG_METRIC_NAMES, createInMemoryMetricsSink } from '../../metrics/index.js'
import type { SearchDocumentRow, SearchEntityType } from '../../search/projection.js'
import type { SearchResultRow, SearchStorePort } from '../../search/store-port.js'
import { buildSubtitle, planSearchDocuments, reindexAll, reindexEntity } from '../index.js'
import type {
  SearchProjectionSourcePort,
  SearchProjectionSourceRow,
  SearchReindexDeps,
} from '../index.js'

const LOCALE = 'pt-BR'

/** Linha de fonte com defaults (cada teste sobrescreve so o que importa). */
function sourceRow(overrides: Partial<SearchProjectionSourceRow> = {}): SearchProjectionSourceRow {
  return {
    entityType: 'movie',
    entityId: '603',
    primaryText: 'Matrix',
    aliases: [],
    year: 1999,
    popularity: 10,
    imagePath: '/poster.jpg',
    canonicalUrl: '/pt/filmes/matrix/',
    subtitle: null,
    ...overrides,
  }
}

/** Store em memoria: guarda documentos por chave natural e registra as deletes. */
interface FakeStore extends SearchStorePort {
  readonly documents: Map<string, SearchDocumentRow>
  readonly deletes: string[]
}

function createFakeStore(): FakeStore {
  const documents = new Map<string, SearchDocumentRow>()
  const deletes: string[] = []
  const keyOf = (entityType: string, entityId: string, locale: string) =>
    `${entityType}:${entityId}:${locale}`

  return {
    documents,
    deletes,
    async upsertDocument(row: SearchDocumentRow): Promise<void> {
      documents.set(keyOf(row.entityType, row.entityId, row.locale), row)
    },
    async deleteDocument(
      entityType: SearchEntityType,
      entityId: string,
      locale: string,
    ): Promise<void> {
      const key = keyOf(entityType, entityId, locale)
      deletes.push(key)
      documents.delete(key)
    },
    async search(): Promise<SearchResultRow[]> {
      return []
    },
  }
}

/** Fonte em memoria: pagina um array por tipo e conta as chamadas de leitura. */
interface FakeSource extends SearchProjectionSourcePort {
  readonly reads: { entityType: SearchEntityType; limit: number; offset: number }[]
}

function createFakeSource(
  rowsByType: Partial<Record<SearchEntityType, readonly SearchProjectionSourceRow[]>>,
): FakeSource {
  const reads: { entityType: SearchEntityType; limit: number; offset: number }[] = []
  const all = (entityType: SearchEntityType) => rowsByType[entityType] ?? []

  return {
    reads,
    async countEntities(entityType: SearchEntityType): Promise<number> {
      return all(entityType).length
    },
    async readEntities(entityType, opts): Promise<SearchProjectionSourceRow[]> {
      reads.push({ entityType, limit: opts.limit, offset: opts.offset })
      return all(entityType).slice(opts.offset, opts.offset + opts.limit)
    },
    async readEntity(entityType, entityId): Promise<SearchProjectionSourceRow | null> {
      return all(entityType).find((row) => row.entityId === entityId) ?? null
    },
  }
}

function createDeps(source: SearchProjectionSourcePort, store: SearchStorePort): SearchReindexDeps {
  return { source, store, metrics: createInMemoryMetricsSink() }
}

describe('buildSubtitle', () => {
  it('junta rotulo e ano para filme e serie', () => {
    expect(buildSubtitle('movie', 1999)).toBe('Filme · 1999')
    expect(buildSubtitle('tv', 2021)).toBe('Serie · 2021')
  })

  it('sem ano fica so o rotulo do tipo', () => {
    expect(buildSubtitle('movie', null)).toBe('Filme')
    expect(buildSubtitle('tv', null)).toBe('Serie')
  })

  it('pessoa nunca carrega ano', () => {
    expect(buildSubtitle('person', null)).toBe('Pessoa')
    expect(buildSubtitle('person', 1974)).toBe('Pessoa')
  })
})

describe('planSearchDocuments', () => {
  it('preenche subtitle quando a fonte nao trouxe um', () => {
    const [doc] = planSearchDocuments([sourceRow()], LOCALE)
    expect(doc?.subtitle).toBe('Filme · 1999')
  })

  it('preserva o subtitle da fonte quando existe', () => {
    const [doc] = planSearchDocuments([sourceRow({ subtitle: 'Filme · Trilogia' })], LOCALE)
    expect(doc?.subtitle).toBe('Filme · Trilogia')
  })

  it('descarta linha com titulo em branco (nunca indexa titulo vazio)', () => {
    const rows = [sourceRow({ entityId: '1', primaryText: '   ' }), sourceRow({ entityId: '2' })]
    const planned = planSearchDocuments(rows, LOCALE)
    expect(planned).toHaveLength(1)
    expect(planned[0]?.entityId).toBe('2')
  })

  it('projeta aliases e locale em cada documento', () => {
    const [doc] = planSearchDocuments([sourceRow({ aliases: ['The Matrix'] })], LOCALE)
    expect(doc?.locale).toBe(LOCALE)
    expect(doc?.normalizedText).toBe('matrix the matrix')
    expect(doc?.normalizedAliases).toBe('the matrix')
  })
})

describe('reindexAll', () => {
  it('pagina em lotes e conta o que varreu e escreveu', async () => {
    const movies = Array.from({ length: 5 }, (_, i) =>
      sourceRow({ entityId: String(i + 1), primaryText: `Filme ${i + 1}` }),
    )
    const source = createFakeSource({ movie: movies })
    const store = createFakeStore()

    const report = await reindexAll(createDeps(source, store), {
      locale: LOCALE,
      entityTypes: ['movie'],
      batchSize: 2,
    })

    expect(report).toEqual({ scanned: 5, upserted: 5, skipped: 0, deleted: 0 })
    expect(store.documents.size).toBe(5)
    // 2 + 2 + 1 + pagina vazia que encerra o tipo.
    expect(source.reads.map((r) => r.offset)).toEqual([0, 2, 4, 6])
    expect(source.reads.every((r) => r.limit === 2)).toBe(true)
  })

  it('varre todos os tipos por default e conta os pulados', async () => {
    const source = createFakeSource({
      movie: [sourceRow({ entityId: '1' }), sourceRow({ entityId: '2', primaryText: '' })],
      tv: [sourceRow({ entityId: '10', entityType: 'tv', primaryText: 'Serie' })],
      person: [
        sourceRow({ entityId: '20', entityType: 'person', primaryText: 'Keanu', year: null }),
      ],
    })
    const store = createFakeStore()

    const report = await reindexAll(createDeps(source, store), { locale: LOCALE })

    expect(report).toEqual({ scanned: 4, upserted: 3, skipped: 1, deleted: 0 })
    expect(store.documents.has('movie:2:pt-BR')).toBe(false)
    expect(store.documents.get('person:20:pt-BR')?.subtitle).toBe('Pessoa')
  })

  it('respeita o teto de linhas (smoke run)', async () => {
    const movies = Array.from({ length: 10 }, (_, i) => sourceRow({ entityId: String(i + 1) }))
    const source = createFakeSource({ movie: movies })
    const store = createFakeStore()

    const report = await reindexAll(createDeps(source, store), {
      locale: LOCALE,
      entityTypes: ['movie'],
      batchSize: 4,
      limit: 3,
    })

    expect(report.scanned).toBe(3)
    expect(report.upserted).toBe(3)
    expect(source.reads).toHaveLength(1)
    expect(source.reads[0]?.limit).toBe(3)
  })

  it('emite o gauge de documentos indexados no fim', async () => {
    const source = createFakeSource({ movie: [sourceRow()] })
    const store = createFakeStore()
    const metrics = createInMemoryMetricsSink()

    await reindexAll(
      { source, store, metrics },
      { locale: LOCALE, entityTypes: ['movie'], batchSize: 10 },
    )

    expect(metrics.read(CATALOG_METRIC_NAMES.searchDocumentsTotal, { locale: LOCALE })).toBe(1)
    const [sample] = metrics.samples()
    expect(sample?.kind).toBe('gauge')
  })

  it('fonte vazia nao escreve nada', async () => {
    const source = createFakeSource({})
    const store = createFakeStore()

    const report = await reindexAll(createDeps(source, store), { locale: LOCALE })

    expect(report).toEqual({ scanned: 0, upserted: 0, skipped: 0, deleted: 0 })
    expect(store.documents.size).toBe(0)
    expect(store.deletes).toEqual([])
  })
})

describe('reindexEntity', () => {
  it('faz upsert quando a entidade existe', async () => {
    const source = createFakeSource({ movie: [sourceRow()] })
    const store = createFakeStore()

    const report = await reindexEntity(createDeps(source, store), 'movie', '603', LOCALE)

    expect(report).toEqual({ scanned: 1, upserted: 1, skipped: 0, deleted: 0 })
    expect(store.documents.get('movie:603:pt-BR')?.primaryText).toBe('Matrix')
    expect(store.deletes).toEqual([])
  })

  it('REMOVE o documento quando a entidade sumiu (limpeza de obsoleto)', async () => {
    const source = createFakeSource({ movie: [] })
    const store = createFakeStore()
    // Documento antigo que ficou para tras no indice.
    await store.upsertDocument({
      entityType: 'movie',
      entityId: '603',
      locale: LOCALE,
      primaryText: 'Matrix',
      alternativeText: '',
      normalizedText: 'matrix',
      normalizedAliases: '',
      subtitle: 'Filme · 1999',
      year: 1999,
      popularity: 10,
      imagePath: null,
      canonicalUrl: '/pt/filmes/matrix/',
    })

    const report = await reindexEntity(createDeps(source, store), 'movie', '603', LOCALE)

    expect(report).toEqual({ scanned: 0, upserted: 0, skipped: 0, deleted: 1 })
    expect(store.deletes).toEqual(['movie:603:pt-BR'])
    expect(store.documents.has('movie:603:pt-BR')).toBe(false)
  })

  it('remove tambem quando a entidade existe porem sem titulo utilizavel', async () => {
    const source = createFakeSource({ movie: [sourceRow({ primaryText: '  ' })] })
    const store = createFakeStore()

    const report = await reindexEntity(createDeps(source, store), 'movie', '603', LOCALE)

    expect(report).toEqual({ scanned: 1, upserted: 0, skipped: 1, deleted: 1 })
    expect(store.deletes).toEqual(['movie:603:pt-BR'])
  })

  it('reprojeta a entidade sobre o documento antigo (idempotente)', async () => {
    const source = createFakeSource({ movie: [sourceRow({ primaryText: 'Matrix Reloaded' })] })
    const store = createFakeStore()

    await reindexEntity(createDeps(source, store), 'movie', '603', LOCALE)
    await reindexEntity(createDeps(source, store), 'movie', '603', LOCALE)

    expect(store.documents.size).toBe(1)
    expect(store.documents.get('movie:603:pt-BR')?.primaryText).toBe('Matrix Reloaded')
  })
})
