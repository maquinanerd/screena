/**
 * O noop de enfileiramento nao pode ser MUDO.
 *
 * Ate 2026-08-27 a idempotencia da fila era obtida com `create` + catch de
 * P2002: para dizer "essa chave ja existe", o PostgreSQL tinha de abortar a
 * transacao, e cada aborto escrevia `ERROR: duplicate key value violates unique
 * constraint "catalog_jobs_idempotency_key_key"` no log do banco. Era um sinal
 * ruim — um erro descrevendo sucesso — mas era o UNICO lugar onde a taxa de
 * repeticao aparecia.
 *
 * Trocar por `ON CONFLICT DO NOTHING` tirou o erro. Sem o que estes testes
 * travam, teria tirado a MEDIDA junto: o mesmo laço continuaria, agora invisivel.
 * Trocar um defeito barulhento por um mudo e pior que nao consertar, porque o
 * segundo ninguem vai procurar.
 *
 * A repeticao NAO e patologia aqui — e o caminho normal, por construcao: a chave
 * do filho (`sync_media:movie:<id>:pt-BR`) nao tem escopo, enquanto a do pai
 * (`sync_details`) tem (dia, no agendador; janela, no incremental). Toda
 * recobertura de um titulo ja coberto passa por este noop. Justamente por ser
 * normal e que a TAXA precisa ser legivel.
 */

import { describe, expect, it } from 'vitest'
import { CATALOG_METRIC_NAMES } from '../../../metrics/index.js'
import { createCatalogHandlerRegistry } from '../registry.js'
import { createFakeContext, createHandlerFakes } from './fakes.js'

const DETAIL_INPUT = {
  entityType: 'movie',
  tmdbId: 603,
  locale: 'pt-BR',
  enqueueDependencies: true,
} as const

describe('visibilidade do noop de enfileiramento', () => {
  it('a PRIMEIRA cobertura conta o filho como created', async () => {
    const fakes = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(fakes.deps)
    const handler = registry.get('sync_details')!
    const { context, metrics } = createFakeContext()

    await handler.execute(context, handler.validateInput(DETAIL_INPUT))

    expect(
      metrics.read(CATALOG_METRIC_NAMES.jobsEnqueuedTotal, {
        job_type: 'sync_media',
        result: 'created',
      }),
    ).toBe(1)
    expect(
      metrics.read(CATALOG_METRIC_NAMES.jobsEnqueuedTotal, {
        job_type: 'sync_media',
        result: 'duplicate',
      }),
    ).toBe(0)
  })

  it('a RECOBERTURA do mesmo titulo conta o filho como duplicate — a taxa fica legivel', async () => {
    const fakes = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(fakes.deps)
    const handler = registry.get('sync_details')!
    const input = handler.validateInput(DETAIL_INPUT)

    // 1a passada: cria. O store fake espelha o unique de `idempotency_key`.
    await handler.execute(createFakeContext().context, input)

    // 2a passada: o MESMO titulo, a MESMA chave de filho (sem escopo). E aqui
    // que a producao batia 85 vezes por minuto.
    const second = createFakeContext()
    await handler.execute(second.context, input)

    expect(
      second.metrics.read(CATALOG_METRIC_NAMES.jobsEnqueuedTotal, {
        job_type: 'sync_media',
        result: 'duplicate',
      }),
    ).toBe(1)
    expect(
      second.metrics.read(CATALOG_METRIC_NAMES.jobsEnqueuedTotal, {
        job_type: 'sync_media',
        result: 'created',
      }),
    ).toBe(0)
  })

  it('o log de debug tambem carrega `duplicated` — planned - created deixa de ser adivinhacao', async () => {
    const fakes = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(fakes.deps)
    const handler = registry.get('sync_details')!
    const input = handler.validateInput(DETAIL_INPUT)

    await handler.execute(createFakeContext().context, input)
    const second = createFakeContext()
    await handler.execute(second.context, input)

    const line = second.logs.find((l) => l.event === 'catalog_sync_details_enqueued')
    expect(line?.fields?.created).toBe(0)
    expect(line?.fields?.duplicated).toBe(1)
  })

  it('a descoberta agrega: 1 amostra por (tipo, desfecho), nao 1 por id', async () => {
    const fakes = createHandlerFakes()
    // O export diario reoferece largamente o MESMO conjunto — se cada id virasse
    // uma amostra, um ciclo de 2000 ids viraria 2000 linhas para dizer uma coisa.
    fakes.setDiscoveredIds([1, 2, 3, 4, 5])
    const registry = createCatalogHandlerRegistry(fakes.deps)
    const handler = registry.get('discover_ids')!

    const first = createFakeContext()
    await handler.execute(
      first.context,
      handler.validateInput({
        strategy: 'daily-exports',
        entityType: 'movie',
        locale: 'pt-BR',
        country: null,
        limit: null,
        maxPages: null,
        ids: null,
        enqueueDetails: true,
      }),
    )

    const created = first.metrics
      .samples()
      .filter((s) => s.name === CATALOG_METRIC_NAMES.jobsEnqueuedTotal)
    expect(created).toHaveLength(1)
    expect(created[0]!.value).toBe(5)
    expect(created[0]!.labels).toMatchObject({ job_type: 'sync_details', result: 'created' })
  })
})
