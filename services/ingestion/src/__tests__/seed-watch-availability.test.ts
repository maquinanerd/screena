/**
 * seed-watch-availability.test.ts — O caminho da SEMENTE carrega disponibilidade,
 * e o comando diz o que NAO trouxe.
 *
 * ============ T2: a semente e o mesmo caminho, nao um segundo lugar ============
 *
 * A cadeia da semente e `bootstrap -> discover_ids -> sync_details -> ...`
 * (`bootstrap-handler.ts`). Ela nao tem import proprio: `sync_details` e o
 * UNICO job que promove detalhe de filme/serie, e ele delega ao mesmo
 * `detailSync.syncDetail` que a CLI usa. Estes testes provam esse elo — se
 * alguem der a semente um caminho paralelo, o elo quebra aqui e nao dez mil
 * titulos depois.
 *
 * ============ T4: o silencio de "39 ok" ============
 *
 * A fila descarta o resultado do handler (`worker.ts` so loga
 * `catalog_job_succeeded`), entao na semente nao ha resumo de CLI para ler. Por
 * isso o desfecho de disponibilidade vira METRICA com label de cardinalidade
 * fechada; e no caminho da CLI vira uma linha explicita de resumo.
 */

import { describe, expect, it } from 'vitest'

import { BootstrapHandler } from '../catalog-jobs/handlers/bootstrap-handler.js'
import { DiscoverIdsHandler } from '../catalog-jobs/handlers/discover-ids-handler.js'
import { SyncDetailsHandler } from '../catalog-jobs/handlers/sync-details-handler.js'
import { createFakeContext, createHandlerFakes } from '../catalog-jobs/handlers/__tests__/fakes.js'
import { CATALOG_METRIC_NAMES } from '../metrics/index.js'
import {
  describeDetailWatchOutcome,
  summarizeDetailWatch,
} from '../watch-providers/from-detail.js'

describe('semente: a cadeia bootstrap -> discover_ids -> sync_details', () => {
  it('o bootstrap so alcanca o detalhe por `discover_ids`, e ele so enfileira `sync_details`', async () => {
    const fakes = createHandlerFakes()
    const bootstrap = new BootstrapHandler({ store: fakes.store })

    await bootstrap.execute(
      createFakeContext().context,
      bootstrap.validateInput({ strategy: 'daily-exports', entityTypes: ['movie'] }),
    )

    // O bootstrap NAO enfileira detalhe direto: quem o faz e a descoberta.
    const bootstrapTypes = [...new Set(fakes.store.enqueued.map((j) => j.jobType))].sort()
    expect(bootstrapTypes).toEqual(['discover_ids', 'sync_lists'])

    const discovery = new DiscoverIdsHandler({ discovery: fakes.deps.discovery, store: fakes.store })
    fakes.store.enqueued.length = 0
    fakes.setDiscoveredIds([603, 604])

    await discovery.execute(
      createFakeContext().context,
      discovery.validateInput({ strategy: 'popular', entityType: 'movie', enqueueDetails: true }),
    )

    // Um unico tipo de job: `sync_details`. Nao ha rota alternativa para a
    // semente promover um filme — logo, consertar `sync_details` conserta os
    // dois caminhos, e este teste e a prova disso.
    const discoveredTypes = [...new Set(fakes.store.enqueued.map((j) => j.jobType))]
    expect(discoveredTypes).toEqual(['sync_details'])
    expect(fakes.store.enqueued.map((j) => j.externalId)).toEqual(['603', '604'])
  })

  it('`sync_details` devolve o desfecho de disponibilidade e o numero de ofertas', async () => {
    const fakes = createHandlerFakes()
    fakes.setDetailOutcome({ watchOutcome: 'applied', watchOffers: 3 })
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })

    const result = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ entityType: 'movie', tmdbId: 603, locale: 'pt-BR' }),
    )

    expect(result.watchOutcome).toBe('applied')
    expect(result.watchOffers).toBe(3)
  })

  it('emite a metrica do desfecho ATE quando o detalhe foi pulado', async () => {
    const fakes = createHandlerFakes()
    fakes.setDetailOutcome({
      skipped: true,
      skipReason: 'entidade nao promovida',
      watchOutcome: 'unresolved',
      watchOffers: 0,
    })
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const fake = createFakeContext()

    const result = await handler.execute(
      fake.context,
      handler.validateInput({ entityType: 'movie', tmdbId: 603, locale: 'pt-BR' }),
    )

    expect(result.skipped).toBe(true)
    expect(result.watchOutcome).toBe('unresolved')

    // Na semente a metrica e o UNICO sinal: o worker joga fora o resultado do
    // handler. Se ela so fosse emitida no caminho feliz, dez mil entidades
    // poderiam nascer sem oferta sem nada acender.
    const samples = fake.metrics
      .samples()
      .filter((s) => s.name === CATALOG_METRIC_NAMES.detailWatchTotal)
    expect(samples).toHaveLength(1)
    expect(samples[0]?.labels).toEqual({ entity_type: 'movie', watch_outcome: 'unresolved' })
    expect(samples[0]?.value).toBe(1)
  })
})

describe('resumo do lote: o comando diz o que NAO trouxe', () => {
  it('lote sem nenhuma oferta materializada emite o aviso explicito', () => {
    // A forma exata do defeito relatado: 39 detalhes sincronizados, nenhuma
    // oferta. Antes disto a saida era `39 ok · 0 falhou` e nada mais.
    const summary = summarizeDetailWatch(
      Array.from({ length: 39 }, () => ({ outcome: 'unrecognized' as const, offersUpserted: 0 })),
    )

    expect(summary.offers).toBe(0)
    expect(summary.missed).toBe(39)
    expect(summary.byOutcome).toEqual({ unrecognized: 39 })
    expect(summary.lines).toEqual([
      'onde assistir: 39 nao reconhecida (+0 ofertas)',
      'ATENCAO: nenhuma oferta de disponibilidade foi gravada neste lote (39 de 39 entidades sem oferta materializada).',
    ])
  })

  it('lote misto lista cada desfecho e NAO grita quando houve materializacao', () => {
    const summary = summarizeDetailWatch([
      { outcome: 'applied', offersUpserted: 4 },
      { outcome: 'applied', offersUpserted: 2 },
      { outcome: 'empty', offersUpserted: 0 },
      { outcome: 'out-of-scope', offersUpserted: 0 },
      { outcome: 'unrecognized', offersUpserted: 0 },
    ])

    expect(summary.offers).toBe(6)
    expect(summary.missed).toBe(3)
    expect(summary.lines).toEqual([
      'onde assistir: 2 com oferta · 1 sem oferta · 1 fora do escopo territorial · 1 nao reconhecida (+6 ofertas)',
    ])
  })

  it('lote so de pessoas nao inventa lacuna: `not-applicable` nao e "sem oferta"', () => {
    const summary = summarizeDetailWatch([
      { outcome: 'not-applicable', offersUpserted: 0 },
      { outcome: 'not-applicable', offersUpserted: 0 },
    ])

    expect(summary.missed).toBe(0)
    expect(summary.lines).toEqual(['onde assistir: 2 nao se aplica (+0 ofertas)'])
  })

  it('cada desfecho tem rotulo proprio: nenhum colapsa no outro', () => {
    const labels = (
      [
        'applied',
        'empty',
        'out-of-scope',
        'unrecognized',
        'unresolved',
        'failed',
        'not-configured',
        'not-applicable',
      ] as const
    ).map((outcome) => describeDetailWatchOutcome(outcome))

    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toEqual([
      'com oferta',
      'sem oferta',
      'fora do escopo territorial',
      'nao reconhecida',
      'entidade nao promovida',
      'falha ao gravar',
      'sink de ofertas nao configurado',
      'nao se aplica',
    ])
  })
})
