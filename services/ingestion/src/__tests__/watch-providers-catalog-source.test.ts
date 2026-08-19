/**
 * watch-providers-catalog-source.test.ts — O leitor enxerga a entidade que so
 * existe no store de OBJETOS, e o universo do reprocessamento e o CATALOGO.
 *
 * Contexto: o raw sync passou a escrever objetos (`TMDB_RAW_STORE_DRIVER=r2`)
 * enquanto os leitores continuaram falando `prisma.tmdbRaw`. Nenhum erro era
 * emitido — a consulta simplesmente respondia com o residuo anterior a troca.
 *
 * Estes testes exercitam o CAMINHO REAL: `createObjectRawPayloadReader` sobre o
 * store de objetos que roda a mesma suite de contrato do adapter S3
 * (`memory-object-store.ts`), `createCatalogRawWatchSource` e
 * `runWatchProvidersReprocess`. Nenhum duble substitui o codigo sob teste.
 */

import { describe, expect, it } from 'vitest'

import { createMemoryRawObjectStore } from '../raw-store/memory-object-store.js'
import { rawObjectKey, RawStoreUnavailableError } from '../raw-store/object-store.js'
import {
  createObjectRawPayloadReader,
  RawPayloadDecodeError,
} from '../raw-store/payload-reader.js'
import { stableStringify } from '../utils/hash.js'
import { createCatalogRawWatchSource } from '../watch-providers/catalog-source.js'
import { describeCorpusCoverage } from '../watch-providers/coverage.js'
import { runWatchProvidersReprocess } from '../watch-providers/run.js'
import type { RawPayloadReader } from '../raw-store/payload-reader.js'
import type {
  CatalogEntityIndex,
  RawWatchSourceRow,
  WatchEntityResolver,
  WatchOfferStore,
} from '../watch-providers/types.js'

const BASE_LANGUAGE = 'pt-BR'
const FIXED_NOW = new Date('2026-08-19T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

/** Payload minimo com uma oferta BR reconhecivel. */
function payloadFor(tmdbId: number): unknown {
  return {
    id: tmdbId,
    'watch/providers': {
      results: {
        BR: {
          link: 'https://www.themoviedb.org/tv/' + String(tmdbId) + '/watch?locale=BR',
          flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
        },
      },
    },
  }
}

/** Grava um payload no store de objetos pela MESMA serializacao da escrita real. */
async function seedObject(
  store: ReturnType<typeof createMemoryRawObjectStore>,
  kind: 'movie' | 'tv',
  tmdbId: number,
): Promise<void> {
  const body = stableStringify(payloadFor(tmdbId))
  await store.put({ key: rawObjectKey(kind, tmdbId), body, payloadHash: 'hash-' + String(tmdbId) })
}

/** Um leitor apoiado SO em Postgres — o comportamento cego, em forma de duble. */
function postgresOnlyReader(known: readonly number[]): RawPayloadReader {
  return {
    description: 'leitura=postgres (duble)',
    async read(key) {
      return known.includes(key.tmdbId)
        ? { present: true, payload: payloadFor(key.tmdbId) }
        : { present: false }
    },
  }
}

function catalogOf(ids: readonly number[]): CatalogEntityIndex {
  return {
    count: async () => ids.length,
    listTmdbIds: async (_type, limit) => ids.slice(0, limit),
  }
}

describe('createObjectRawPayloadReader — enxerga o que so existe no store de objetos', () => {
  it('NOS DOIS SENTIDOS: presente no objeto e visto; ausente no objeto e present=false', async () => {
    const objectStore = createMemoryRawObjectStore()
    await seedObject(objectStore, 'tv', 1396) // Breaking Bad, so no store de objetos
    const reader = createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE })

    const visto = await reader.read({ entityType: 'tv', tmdbId: 1396, baseLanguage: BASE_LANGUAGE })
    const ausente = await reader.read({ entityType: 'tv', tmdbId: 1399, baseLanguage: BASE_LANGUAGE })

    expect(visto.present).toBe(true)
    if (!visto.present) throw new Error('inalcancavel')
    expect((visto.payload as { id: number }).id).toBe(1396)
    expect(ausente.present).toBe(false)
  })

  it('SENTIDO OPOSTO: o mesmo id e invisivel para um leitor apoiado so no Postgres', async () => {
    const objectStore = createMemoryRawObjectStore()
    await seedObject(objectStore, 'tv', 1396)
    const objeto = createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE })
    // O Postgres tem as 100 antigas; 1396 nao esta entre elas.
    const postgres = postgresOnlyReader([550])

    const key = { entityType: 'tv' as const, tmdbId: 1396, baseLanguage: BASE_LANGUAGE }
    expect((await objeto.read(key)).present).toBe(true)
    expect((await postgres.read(key)).present).toBe(false)
  })

  it('indisponibilidade do store SOBE como erro — nunca vira ausencia', async () => {
    const objectStore = createMemoryRawObjectStore()
    await seedObject(objectStore, 'tv', 1396)
    const reader = createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE })
    objectStore.failNext('get')

    await expect(
      reader.read({ entityType: 'tv', tmdbId: 1396, baseLanguage: BASE_LANGUAGE }),
    ).rejects.toBeInstanceOf(RawStoreUnavailableError)
  })

  it('corpo presente e ilegivel e CORRUPCAO nomeada, nao ausencia', async () => {
    const objectStore = createMemoryRawObjectStore()
    await objectStore.put({
      key: rawObjectKey('tv', 1399),
      body: '{ isto nao e json',
      payloadHash: 'x',
    })
    const reader = createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE })

    await expect(
      reader.read({ entityType: 'tv', tmdbId: 1399, baseLanguage: BASE_LANGUAGE }),
    ).rejects.toBeInstanceOf(RawPayloadDecodeError)
  })
})

describe('createCatalogRawWatchSource — o universo e o catalogo', () => {
  it('count responde pelo CATALOGO, nunca pelo deposito', async () => {
    const objectStore = createMemoryRawObjectStore()
    await seedObject(objectStore, 'tv', 1396) // 1 objeto so
    const source = createCatalogRawWatchSource({
      catalog: catalogOf([1396, 1399, 1402, 100088]), // 4 no catalogo
      reader: createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE }),
      baseLanguage: BASE_LANGUAGE,
    })
    // Se alguem reconectar count ao deposito, este numero vira 1 e reprova.
    expect(await source.count('tv')).toBe(4)
  })

  it('id do catalogo sem bruto volta como present=false, na ordem do catalogo', async () => {
    const objectStore = createMemoryRawObjectStore()
    await seedObject(objectStore, 'tv', 1396)
    await seedObject(objectStore, 'tv', 1402)
    const source = createCatalogRawWatchSource({
      catalog: catalogOf([1396, 1399, 1402, 100088]),
      reader: createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE }),
      baseLanguage: BASE_LANGUAGE,
      concurrency: 3,
    })

    const rows = await source.list('tv', 10)
    expect(rows.map((row) => row.tmdbId)).toEqual([1396, 1399, 1402, 100088])
    expect(rows.map((row) => row.present)).toEqual([true, false, true, false])
  })

  it('o --limit continua sendo um prefixo estavel do catalogo', async () => {
    const objectStore = createMemoryRawObjectStore()
    const source = createCatalogRawWatchSource({
      catalog: catalogOf([10, 20, 30, 40, 50]),
      reader: createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE }),
      baseLanguage: BASE_LANGUAGE,
    })
    const rows = await source.list('movie', 3)
    expect(rows.map((row) => row.tmdbId)).toEqual([10, 20, 30])
  })
})

describe('CONTROLE NEGATIVO REAL — a cegueira reintroduzida no codigo de verdade', () => {
  const resolver: WatchEntityResolver = {
    resolve: async (_type, tmdbIds) =>
      tmdbIds.map((id) => ({ tmdbId: id, entityId: String(id * 10) })),
  }
  const store: WatchOfferStore = {
    replaceSnapshot: async (input) => ({ upserted: input.offers.length, revoked: 0 }),
  }

  /**
   * O deposito tem MENOS entidades que o catalogo — exatamente o estado de
   * producao (100 no deposito, 139 no catalogo). O ciclo roda inteiro pelo
   * codigo real e o veredito precisa RECUSAR completude.
   */
  it('deposito menor que o catalogo: missingRaw contado e cobertura RECUSADA', async () => {
    const objectStore = createMemoryRawObjectStore()
    const catalogIds = [1, 2, 3, 4, 5]
    for (const id of [1, 2]) await seedObject(objectStore, 'tv', id)

    const catalog = catalogOf(catalogIds)
    const report = await runWatchProvidersReprocess({
      entityType: 'tv',
      source: createCatalogRawWatchSource({
        catalog,
        reader: createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE }),
        baseLanguage: BASE_LANGUAGE,
      }),
      resolver,
      store,
      limit: 100,
      territories: ['BR'],
      staleAfterMs: DAY_MS,
      now: () => FIXED_NOW,
      dryRun: false,
    })

    expect(report.counts.scanned).toBe(5)
    expect(report.counts.applied).toBe(2)
    expect(report.counts.missingRaw).toBe(3)
    // As tres ausencias NAO podem ter virado `unrecognized`: "o payload nao
    // serve" e uma afirmacao diferente de "nao ha payload".
    expect(report.counts.unrecognized).toBe(0)
    expect(report.counts.failed).toBe(0)

    const verdict = describeCorpusCoverage({
      catalogTotal: await catalog.count('tv'),
      scanned: report.counts.scanned,
      missingFromDepot: report.counts.missingRaw,
    })
    expect(verdict.complete).toBe(false)
    if (verdict.complete) throw new Error('inalcancavel')
    expect(verdict.gap).toBe('depot-gap')
    expect(verdict.missingFromDepot).toBe(3)
  })

  it('deposito COMPLETO pelo mesmo caminho: so entao a cobertura e total', async () => {
    const objectStore = createMemoryRawObjectStore()
    const catalogIds = [1, 2, 3, 4, 5]
    for (const id of catalogIds) await seedObject(objectStore, 'tv', id)

    const catalog = catalogOf(catalogIds)
    const report = await runWatchProvidersReprocess({
      entityType: 'tv',
      source: createCatalogRawWatchSource({
        catalog,
        reader: createObjectRawPayloadReader({ objectStore, baseLanguage: BASE_LANGUAGE }),
        baseLanguage: BASE_LANGUAGE,
      }),
      resolver,
      store,
      limit: 100,
      territories: ['BR'],
      staleAfterMs: DAY_MS,
      now: () => FIXED_NOW,
      dryRun: false,
    })

    expect(report.counts.missingRaw).toBe(0)
    expect(report.counts.applied).toBe(5)
    const verdict = describeCorpusCoverage({
      catalogTotal: await catalog.count('tv'),
      scanned: report.counts.scanned,
      missingFromDepot: report.counts.missingRaw,
    })
    expect(verdict.complete).toBe(true)
  })

  it('a fonte antiga (universo = deposito) seria ESTRUTURALMENTE incapaz de contar as ausencias', async () => {
    // Reproduz a fonte antiga: enumera o proprio deposito. Com 2 objetos e 5
    // entidades no catalogo, ela devolve 2 linhas e conta scanned=2 — as 3
    // ausencias nao aparecem em lugar nenhum do relatorio.
    const presentes: readonly RawWatchSourceRow[] = [1, 2].map((tmdbId) => ({
      tmdbId,
      baseLanguage: BASE_LANGUAGE,
      payload: payloadFor(tmdbId),
      present: true,
    }))
    const report = await runWatchProvidersReprocess({
      entityType: 'tv',
      source: { count: async () => presentes.length, list: async () => presentes },
      resolver,
      store,
      limit: 100,
      territories: ['BR'],
      staleAfterMs: DAY_MS,
      now: () => FIXED_NOW,
      dryRun: false,
    })

    expect(report.counts.scanned).toBe(2)
    expect(report.counts.missingRaw).toBe(0)
    // E o veredito com o denominador do CATALOGO ainda recusa completude: e
    // exatamente esta discordancia que o comando precisa imprimir.
    const verdict = describeCorpusCoverage({
      catalogTotal: 5,
      scanned: report.counts.scanned,
      missingFromDepot: report.counts.missingRaw,
    })
    expect(verdict.complete).toBe(false)
    if (verdict.complete) throw new Error('inalcancavel')
    expect(verdict.notScanned).toBe(3)
  })
})
