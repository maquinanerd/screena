/**
 * Testes de comportamento dos 11 handlers (PURO: fakes, sem DB, sem rede).
 *
 * O foco nao e "o handler roda", e sim que ele DELEGA ao servico real, propaga
 * abort/heartbeat, classifica erro e nao inventa efeito colateral.
 */

import { describe, expect, it } from 'vitest'
import { CATALOG_METRIC_NAMES } from '../../../metrics/index.js'
import { CatalogJobInputError } from '../../handler.js'
import { BootstrapHandler } from '../bootstrap-handler.js'
import { DiscoverIdsHandler } from '../discover-ids-handler.js'
import { ReprocessRawHandler } from '../reprocess-raw-handler.js'
import { SyncChangesHandler } from '../sync-changes-handler.js'
import { SyncCreditsHandler } from '../sync-credits-handler.js'
import { SyncDetailsHandler } from '../sync-details-handler.js'
import { SyncEpisodesHandler } from '../sync-episodes-handler.js'
import { SyncExternalIdsHandler } from '../sync-external-ids-handler.js'
import { SyncListsHandler } from '../sync-lists-handler.js'
import { SyncMediaHandler } from '../sync-media-handler.js'
import { SyncSeasonsHandler } from '../sync-seasons-handler.js'
import { ALLOWED_METRIC_LABELS } from '../support.js'
import { createFakeContext, createHandlerFakes } from './fakes.js'

describe('SyncDetailsHandler', () => {
  it('delega ao detailSync e enfileira as dependencias', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const { context } = createFakeContext()

    const input = handler.validateInput({ entityType: 'movie', tmdbId: 603, locale: 'pt-BR' })
    const result = await handler.execute(context, input)

    // Delegou de fato (nao devolveu sucesso fingido).
    expect(fakes.calls.detail).toHaveLength(1)
    expect(fakes.calls.detail[0]?.tmdbId).toBe(603)
    expect(result.created).toBe(true)

    // movie => so sync_media. credits/external_ids JA vieram no append do
    // detalhe: enfileira-los seria refetch da mesma cota pelo mesmo dado.
    const types = fakes.store.enqueued.map((j) => j.jobType).sort()
    expect(types).toEqual(['sync_media'])
    expect(result.enqueued).toBe(1)
  })

  it('nao enfileira credits/external_ids (o append do detalhe ja os trouxe)', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })

    await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'tv', tmdbId: 1399 }),
    )

    const types = fakes.store.enqueued.map((j) => j.jobType)
    expect(types).not.toContain('sync_credits')
    expect(types).not.toContain('sync_external_ids')
  })

  it('para tv tambem enfileira sync_seasons (nivel de episodio nao vem no append)', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const { context } = createFakeContext()

    const input = handler.validateInput({ entityType: 'tv', tmdbId: 1399, locale: 'pt-BR' })
    await handler.execute(context, input)

    expect(fakes.store.enqueued.map((j) => j.jobType).sort()).toEqual(['sync_media', 'sync_seasons'])
  })

  it('detalhe pulado NAO enfileira dependencia (nao teriam dono)', async () => {
    const fakes = createHandlerFakes()
    fakes.setDetailOutcome({ skipped: true, skipReason: 'nao promovida', created: false })
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const { context } = createFakeContext()

    const result = await handler.execute(
      context,
      handler.validateInput({ entityType: 'movie', tmdbId: 1 }),
    )

    expect(result.skipped).toBe(true)
    expect(fakes.store.enqueued).toHaveLength(0)
    expect(fakes.calls.reindex).toHaveLength(0)
  })

  it('reprojeta a busca quando criou/atualizou, mas nao quando inalterado', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })

    await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'movie', tmdbId: 603 }),
    )
    expect(fakes.calls.reindex).toHaveLength(1)

    // Inalterado: reindexar seria escrita a toa a cada ciclo de sync.
    fakes.setDetailOutcome({ created: false, updated: false, unchanged: true })
    await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'movie', tmdbId: 604 }),
    )
    expect(fakes.calls.reindex).toHaveLength(1)
  })

  it('enqueue repetido e noop idempotente (mesma chave)', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const input = handler.validateInput({ entityType: 'movie', tmdbId: 603 })

    const first = await handler.execute(createFakeContext().context, input)
    const second = await handler.execute(createFakeContext().context, input)

    expect(first.enqueued).toBe(1)
    expect(second.enqueued).toBe(0) // chaves ja existiam
    expect(fakes.store.enqueued).toHaveLength(1)
  })

  it('propaga o erro do servico e conta a falha por classe', async () => {
    const fakes = createHandlerFakes()
    const notFound = Object.assign(new Error('nao existe'), { status: 404 })
    fakes.failDetailWith(notFound)
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const fake = createFakeContext()

    await expect(
      handler.execute(fake.context, handler.validateInput({ entityType: 'movie', tmdbId: 1 })),
    ).rejects.toThrow('nao existe')

    expect(
      fake.metrics.read(CATALOG_METRIC_NAMES.jobsFailedTotal, {
        job_type: 'sync_details',
        entity_type: 'movie',
        error_class: 'not_found',
      }),
    ).toBe(1)
  })

  it('aborta antes de tocar o servico quando o sinal ja disparou', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const fake = createFakeContext()
    fake.abort()

    await expect(
      handler.execute(fake.context, handler.validateInput({ entityType: 'movie', tmdbId: 1 })),
    ).rejects.toThrow(/abortada/)
    expect(fakes.calls.detail).toHaveLength(0)
  })

  it('emite heartbeat', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const fake = createFakeContext()

    await handler.execute(fake.context, handler.validateInput({ entityType: 'movie', tmdbId: 603 }))

    expect(fake.heartbeats()).toBeGreaterThan(0)
  })

  it('recusa tmdbId string (sem coercao silenciosa)', () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })

    expect(() => handler.validateInput({ entityType: 'movie', tmdbId: '603' })).toThrow(
      CatalogJobInputError,
    )
    expect(() => handler.validateInput({ entityType: 'nope', tmdbId: 1 })).toThrow(
      CatalogJobInputError,
    )
  })
})

describe('SyncSeasonsHandler', () => {
  it('enfileira um sync_episodes por temporada REPORTADA (inclui a 0)', async () => {
    const fakes = createHandlerFakes()
    fakes.setSeasonNumbers([0, 1, 2])
    const handler = new SyncSeasonsHandler({ seasonsSync: fakes.deps.seasonsSync, store: fakes.store })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ tmdbId: 1399, locale: 'pt-BR' }),
    )

    expect(result.enqueued).toBe(3)
    const seasons = fakes.store.enqueued.map((j) => (j.payload as { seasonNumber: number }).seasonNumber)
    // Temporada 0 (especiais) e real: nunca inferir intervalo 1..N.
    expect(seasons.sort()).toEqual([0, 1, 2])
  })

  it('nao enfileira episodios quando enqueueEpisodes=false', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncSeasonsHandler({ seasonsSync: fakes.deps.seasonsSync, store: fakes.store })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ tmdbId: 1399, enqueueEpisodes: false }),
    )

    expect(result.enqueued).toBe(0)
    expect(fakes.store.enqueued).toHaveLength(0)
  })
})

describe('SyncEpisodesHandler', () => {
  it('conta episodio sem tmdbId como skip, sem derrubar a temporada', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncEpisodesHandler({ episodesSync: fakes.deps.episodesSync })
    const fake = createFakeContext()

    const result = await handler.execute(
      fake.context,
      handler.validateInput({ tmdbId: 1399, seasonNumber: 1 }),
    )

    expect(result.episodes).toBe(10)
    expect(result.skippedNoTmdbId).toBe(1)
    expect(
      fake.metrics.read(CATALOG_METRIC_NAMES.entitiesSyncedTotal, {
        job_type: 'sync_episodes',
        entity_type: 'episode',
        result: 'skipped_no_tmdb_id',
      }),
    ).toBe(1)
  })

  it('aceita temporada 0 e recusa seasonNumber ausente', () => {
    const fakes = createHandlerFakes()
    const handler = new SyncEpisodesHandler({ episodesSync: fakes.deps.episodesSync })

    expect(handler.validateInput({ tmdbId: 1, seasonNumber: 0 }).seasonNumber).toBe(0)
    expect(() => handler.validateInput({ tmdbId: 1 })).toThrow(CatalogJobInputError)
    expect(() => handler.validateInput({ tmdbId: 1, seasonNumber: -1 })).toThrow(CatalogJobInputError)
  })
})

describe('SyncCreditsHandler', () => {
  it('delega ao creditsSync e exige chave natural de episodio', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncCreditsHandler({ creditsSync: fakes.deps.creditsSync })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'episode', tmdbId: 1399, seasonNumber: 1, episodeNumber: 2 }),
    )

    expect(fakes.calls.credits).toHaveLength(1)
    expect(result.guestStars).toBe(1)
    // Sem seasonNumber/episodeNumber nao existe episodio: adivinhar seria inventar fato.
    expect(() => handler.validateInput({ entityType: 'episode', tmdbId: 1 })).toThrow(
      CatalogJobInputError,
    )
    expect(() => handler.validateInput({ entityType: 'season', tmdbId: 1 })).toThrow(
      CatalogJobInputError,
    )
  })
})

describe('SyncExternalIdsHandler', () => {
  it('delega e registra mudanca de identidade externa', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncExternalIdsHandler({ externalIdsSync: fakes.deps.externalIdsSync })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'movie', tmdbId: 603 }),
    )

    expect(fakes.calls.externalIds).toHaveLength(1)
    expect(result.upserted).toBe(2)
    expect(() => handler.validateInput({ entityType: 'episode', tmdbId: 1 })).toThrow(
      CatalogJobInputError,
    )
  })
})

describe('SyncMediaHandler', () => {
  it('delega ao mediaSync e observa duracao', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncMediaHandler({ mediaSync: fakes.deps.mediaSync })
    const fake = createFakeContext()

    const result = await handler.execute(
      fake.context,
      handler.validateInput({ entityType: 'movie', tmdbId: 603 }),
    )

    expect(fakes.calls.media).toHaveLength(1)
    expect(result.images).toBe(5)
    expect(
      fake.metrics.samples().some((s) => s.name === CATALOG_METRIC_NAMES.syncDurationSeconds),
    ).toBe(true)
  })
})

describe('DiscoverIdsHandler', () => {
  it('enfileira sync_details por id descoberto', async () => {
    const fakes = createHandlerFakes()
    fakes.setDiscoveredIds([1, 2, 3])
    const handler = new DiscoverIdsHandler({ discovery: fakes.deps.discovery, store: fakes.store })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ strategy: 'daily-exports', entityType: 'movie' }),
    )

    expect(result.enqueued).toBe(3)
    expect(fakes.store.enqueued.every((j) => j.jobType === 'sync_details')).toBe(true)
  })

  it('conta rejeitado por conteudo adulto em metrica propria', async () => {
    const fakes = createHandlerFakes()
    const handler = new DiscoverIdsHandler({ discovery: fakes.deps.discovery, store: fakes.store })
    const fake = createFakeContext()

    const result = await handler.execute(
      fake.context,
      handler.validateInput({ strategy: 'daily-exports', entityType: 'movie' }),
    )

    expect(result.rejectedAdult).toBe(1)
    expect(
      fake.metrics.read(CATALOG_METRIC_NAMES.entitiesSyncedTotal, {
        job_type: 'discover_ids',
        entity_type: 'movie',
        result: 'rejected_adult',
      }),
    ).toBe(1)
  })

  it('strategy explicit-ids exige ids nao-vazio', () => {
    const fakes = createHandlerFakes()
    const handler = new DiscoverIdsHandler({ discovery: fakes.deps.discovery, store: fakes.store })

    expect(() => handler.validateInput({ strategy: 'explicit-ids', entityType: 'movie' })).toThrow(
      CatalogJobInputError,
    )
    expect(() =>
      handler.validateInput({ strategy: 'explicit-ids', entityType: 'movie', ids: [] }),
    ).toThrow(CatalogJobInputError)
    expect(
      handler.validateInput({ strategy: 'explicit-ids', entityType: 'movie', ids: [1, 1, 2] }).ids,
    ).toEqual([1, 2])
  })

  it('nao enfileira quando enqueueDetails=false', async () => {
    const fakes = createHandlerFakes()
    const handler = new DiscoverIdsHandler({ discovery: fakes.deps.discovery, store: fakes.store })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ strategy: 'popular', entityType: 'tv', enqueueDetails: false }),
    )

    expect(result.enqueued).toBe(0)
    expect(fakes.store.enqueued).toHaveLength(0)
  })
})

describe('SyncListsHandler', () => {
  it('captura, pagina e persiste o snapshot', async () => {
    const fakes = createHandlerFakes()
    fakes.setListPages([
      { results: [{ id: 1, popularity: 9 }], page: 1, total_pages: 2 },
      { results: [{ id: 2, popularity: 8 }], page: 2, total_pages: 2 },
    ])
    const handler = new SyncListsHandler({
      listFetch: fakes.deps.listFetch,
      snapshots: fakes.deps.snapshots,
      now: fakes.deps.now,
    })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ listType: 'popular', entityType: 'movie', locale: 'pt-BR' }),
    )

    expect(result.pages).toBe(2)
    expect(result.items).toBe(2)
    // Posicao densa e continua entre paginas: a ordem da lista E o dado.
    expect(fakes.calls.snapshots[0]?.items.map((i) => i.position)).toEqual([0, 1])
    expect(fakes.calls.snapshots[0]?.items.map((i) => i.entityTmdbId)).toEqual([1, 2])
  })

  it('lista inalterada e hash-noop (created=false)', async () => {
    const fakes = createHandlerFakes()
    fakes.setSnapshotResult({ id: 'snap-1', created: false, items: 0 })
    const handler = new SyncListsHandler({
      listFetch: fakes.deps.listFetch,
      snapshots: fakes.deps.snapshots,
      now: fakes.deps.now,
    })
    const fake = createFakeContext()

    const result = await handler.execute(
      fake.context,
      handler.validateInput({ listType: 'popular', entityType: 'movie' }),
    )

    expect(result.created).toBe(false)
    expect(fake.logs.some((l) => l.event === 'catalog_snapshot_noop')).toBe(true)
  })

  it('o hash ignora page/total_pages (so o conteudo conta)', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncListsHandler({
      listFetch: fakes.deps.listFetch,
      snapshots: fakes.deps.snapshots,
      now: fakes.deps.now,
    })
    const input = handler.validateInput({ listType: 'popular', entityType: 'movie' })

    fakes.setListPages([{ results: [{ id: 1, popularity: 9 }], page: 1, total_pages: 1 }])
    await handler.execute(createFakeContext().context, input)
    const firstHash = fakes.calls.snapshots[0]?.payloadHash

    // Mesmo conteudo, `total_pages` diferente => MESMO hash.
    fakes.setListPages([{ results: [{ id: 1, popularity: 9 }], page: 1, total_pages: 7 }])
    await handler.execute(createFakeContext().context, input)

    expect(fakes.calls.snapshots[1]?.payloadHash).toBe(firstHash)
  })

  it('recusa combinacao de lista que o provider nao expoe', () => {
    const fakes = createHandlerFakes()
    const handler = new SyncListsHandler({
      listFetch: fakes.deps.listFetch,
      snapshots: fakes.deps.snapshots,
    })

    expect(() => handler.validateInput({ listType: 'upcoming', entityType: 'tv' })).toThrow(
      CatalogJobInputError,
    )
    expect(() => handler.validateInput({ listType: 'on_the_air', entityType: 'movie' })).toThrow(
      CatalogJobInputError,
    )
    expect(() =>
      handler.validateInput({ listType: 'trending', entityType: 'movie', window: 'month' }),
    ).toThrow(CatalogJobInputError)
  })
})

describe('SyncChangesHandler', () => {
  it('executa a janela, enfileira e avanca o checkpoint', async () => {
    const fakes = createHandlerFakes()
    fakes.setChangesPages({
      movie: [{ results: [{ id: 10 }, { id: 11 }], page: 1, total_pages: 1 }],
    })
    const handler = new SyncChangesHandler({ changes: fakes.deps.changes })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }),
    )

    expect(result.totalEnqueued).toBe(2)
    expect(result.kinds[0]?.done).toBe(true)
    expect(fakes.store.enqueued.every((j) => j.jobType === 'sync_details')).toBe(true)
  })

  it('janela ja concluida e noop na reexecucao', async () => {
    const fakes = createHandlerFakes()
    fakes.setChangesPages({
      movie: [{ results: [{ id: 10 }], page: 1, total_pages: 1 }],
    })
    const handler = new SyncChangesHandler({ changes: fakes.deps.changes })
    const input = handler.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' })

    await handler.execute(createFakeContext().context, input)
    const second = await handler.execute(createFakeContext().context, input)

    expect(second.kinds[0]?.skipped).toBe(true)
    expect(second.totalEnqueued).toBe(0)
  })

  it('descarta item marcado adult (fail-closed)', async () => {
    const fakes = createHandlerFakes()
    fakes.setChangesPages({
      movie: [{ results: [{ id: 10 }, { id: 11, adult: true }], page: 1, total_pages: 1 }],
    })
    const handler = new SyncChangesHandler({ changes: fakes.deps.changes })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }),
    )

    expect(result.totalEnqueued).toBe(1)
    expect(fakes.store.enqueued.map((j) => j.externalId)).toEqual(['10'])
  })

  it('recusa janela invertida ANTES de tocar o provider', () => {
    const fakes = createHandlerFakes()
    const handler = new SyncChangesHandler({ changes: fakes.deps.changes })

    expect(() => handler.validateInput({ from: '2026-07-16', to: '2026-07-15' })).toThrow(
      CatalogJobInputError,
    )
    // Cota nao se gasta com pergunta impossivel.
    expect(fakes.calls.changesFetch).toHaveLength(0)
  })

  it('recusa data inexistente', () => {
    const fakes = createHandlerFakes()
    const handler = new SyncChangesHandler({ changes: fakes.deps.changes })

    expect(() => handler.validateInput({ from: '2026-02-31' })).toThrow(CatalogJobInputError)
    expect(() => handler.validateInput({ from: '16-07-2026' })).toThrow(CatalogJobInputError)
  })

  // REGRESSAO: o payload enfileirado por /changes vinha com apenas
  // { reason, window } — entityType/tmdbId iam so como COLUNAS do job, e o
  // handler valida o PAYLOAD. Resultado: todo sync_details vindo do incremental
  // falhava validateInput e ia DIRETO para dead-letter; o /changes inteiro
  // virava fila morta. So apareceu ao rodar a fila ponta a ponta.
  it('o payload que /changes enfileira PASSA no validador de sync_details', async () => {
    const fakes = createHandlerFakes()
    fakes.setChangesPages({
      movie: [{ results: [{ id: 603 }], page: 1, total_pages: 1 }],
    })
    const changes = new SyncChangesHandler({ changes: fakes.deps.changes })
    await changes.execute(
      createFakeContext().context,
      changes.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }),
    )

    const enqueued = fakes.store.enqueued.find((j) => j.jobType === 'sync_details')
    expect(enqueued).toBeDefined()

    const details = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const parsed = details.validateInput(enqueued?.payload)
    expect(parsed.entityType).toBe('movie')
    expect(parsed.tmdbId).toBe(603)
  })

  it('propaga o locale para o payload dos jobs de re-sync', async () => {
    const fakes = createHandlerFakes()
    fakes.setChangesPages({ movie: [{ results: [{ id: 1 }], page: 1, total_pages: 1 }] })
    const changes = new SyncChangesHandler({ changes: fakes.deps.changes })

    await changes.execute(
      createFakeContext().context,
      changes.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }),
    )

    const payload = fakes.store.enqueued[0]?.payload as { locale?: string }
    expect(payload.locale).toBe('pt-BR')
  })
})

describe('ReprocessRawHandler', () => {
  it('reprocessa sem tocar o provider e respeita dry-run', async () => {
    const fakes = createHandlerFakes()
    const handler = new ReprocessRawHandler({ reprocessRaw: fakes.deps.reprocessRaw })

    const applied = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'movie' }),
    )
    expect(applied.promoted).toBe(3)

    const dry = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'movie', dryRun: true }),
    )
    expect(dry.dryRun).toBe(true)
    expect(dry.promoted).toBe(0)

    // Reprocessar NUNCA chama o TMDB: seria sync disfarcado, com cota escondida.
    expect(fakes.calls.detail).toHaveLength(0)
    expect(fakes.calls.changesFetch).toHaveLength(0)
    expect(fakes.calls.listFetch).toHaveLength(0)
  })
})

describe('BootstrapHandler', () => {
  it('enfileira descoberta + listas e nao duplica no resume', async () => {
    const fakes = createHandlerFakes()
    const handler = new BootstrapHandler({ store: fakes.store })
    const input = handler.validateInput({ strategy: 'daily-exports', entityTypes: ['movie'] })

    const first = await handler.execute(createFakeContext().context, input)
    // Mesmo requestId => resume: tudo ja enfileirado vira alreadyQueued.
    const second = await handler.execute(createFakeContext().context, input)

    expect(first.enqueued).toBeGreaterThan(0)
    expect(first.alreadyQueued).toBe(0)
    expect(second.enqueued).toBe(0)
    expect(second.alreadyQueued).toBe(first.planned)
    expect(fakes.store.enqueued).toHaveLength(first.planned)
  })

  it('requestId novo e execucao nova (nao colide com a anterior)', async () => {
    const fakes = createHandlerFakes()
    const handler = new BootstrapHandler({ store: fakes.store })
    const input = handler.validateInput({ strategy: 'daily-exports', entityTypes: ['movie'] })

    await handler.execute(createFakeContext({ requestId: 'run-a' }).context, input)
    const other = await handler.execute(createFakeContext({ requestId: 'run-b' }).context, input)

    expect(other.enqueued).toBe(other.planned)
    expect(other.alreadyQueued).toBe(0)
  })

  it('mode=status nao enfileira nada', async () => {
    const fakes = createHandlerFakes()
    const handler = new BootstrapHandler({ store: fakes.store })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ strategy: 'daily-exports', mode: 'status' }),
    )

    expect(result.enqueued).toBe(0)
    expect(fakes.store.enqueued).toHaveLength(0)
  })

  it('a descoberta abre o funil (prioridade menor que a das listas)', async () => {
    const fakes = createHandlerFakes()
    const handler = new BootstrapHandler({ store: fakes.store })

    await handler.execute(
      createFakeContext().context,
      handler.validateInput({ strategy: 'daily-exports', entityTypes: ['movie'] }),
    )

    const discover = fakes.store.enqueued.find((j) => j.jobType === 'discover_ids')
    const lists = fakes.store.enqueued.find((j) => j.jobType === 'sync_lists')
    expect(discover?.priority).toBeLessThan(lists?.priority ?? 0)
  })
})

describe('cardinalidade de metricas', () => {
  it('nenhum handler emite label proibida', async () => {
    const fakes = createHandlerFakes()
    const fake = createFakeContext()

    const details = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    await details.execute(fake.context, details.validateInput({ entityType: 'tv', tmdbId: 1399 }))

    const media = new SyncMediaHandler({ mediaSync: fakes.deps.mediaSync })
    await media.execute(fake.context, media.validateInput({ entityType: 'movie', tmdbId: 603 }))

    const lists = new SyncListsHandler({
      listFetch: fakes.deps.listFetch,
      snapshots: fakes.deps.snapshots,
      now: fakes.deps.now,
    })
    await lists.execute(fake.context, lists.validateInput({ listType: 'popular', entityType: 'movie' }))

    const seen = new Set<string>()
    for (const sample of fake.metrics.samples()) {
      for (const key of Object.keys(sample.labels)) seen.add(key)
    }

    expect(seen.size).toBeGreaterThan(0)
    for (const label of seen) {
      // entity_id / tmdb_id / query como label explodiriam a cardinalidade.
      expect(ALLOWED_METRIC_LABELS as readonly string[], `label proibida: ${label}`).toContain(label)
    }
  })

  it('nenhuma amostra carrega id de entidade ou request id', async () => {
    const fakes = createHandlerFakes()
    const fake = createFakeContext()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })

    await handler.execute(fake.context, handler.validateInput({ entityType: 'movie', tmdbId: 603 }))

    for (const sample of fake.metrics.samples()) {
      const values = Object.values(sample.labels)
      expect(values).not.toContain('603')
      expect(values).not.toContain('req-1')
      expect(values).not.toContain('entity-1')
    }
  })
})
