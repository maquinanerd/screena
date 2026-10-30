/**
 * detail-watch-empty-revokes.test.ts — O titulo que sai de TODO servico no
 * Brasil perde a oferta na pagina.
 *
 * REGRESSAO QUE ESTE ARQUIVO TRAVA (2026-10-30): `empty` e `out-of-scope` voltavam
 * ANTES do escritor, e o snapshot anterior ficava de pe. Desde que a oferta acende
 * por politica (decisao do dono de 2026-10-29), a oferta velha continuava
 * APARECENDO. Agora o snapshot vazio do pais tambem e gravado, e o replace revoga
 * o que sumiu. So `unrecognized` (corpo do qual nao se aprende nada) preserva.
 */

import { describe, expect, it } from 'vitest'

import {
  ingestWatchProvidersFromDetail,
  type DetailWatchSink,
} from '../watch-providers/from-detail.js'
import type { WatchProviderOffer } from '../normalizers/watch-providers.js'

interface Written {
  readonly countryCode: string
  readonly offers: readonly WatchProviderOffer[]
}

function fakeSink(): { sink: DetailWatchSink; written: Written[] } {
  const written: Written[] = []
  return {
    written,
    sink: {
      territories: ['BR'],
      staleAfterMs: 24 * 60 * 60 * 1000,
      resolver: {
        async resolve(_entityType, tmdbIds) {
          return tmdbIds.map((tmdbId) => ({ tmdbId, entityId: '10' }))
        },
      },
      store: {
        async replaceSnapshot(input) {
          written.push({ countryCode: input.countryCode, offers: input.offers })
          // O snapshot anterior tinha 2 ofertas: elas somem no replace.
          return { upserted: input.offers.length, revoked: 2 }
        },
      },
    },
  }
}

const NOW = () => new Date('2026-10-30T12:00:00Z')

const country = (code: string) => ({
  [code]: {
    link: `https://www.themoviedb.org/movie/1/watch?locale=${code}`,
    flatrate: [{ provider_id: 8, provider_name: 'Netflix', display_priority: 1, logo_path: '/n.jpg' }],
  },
})

async function ingest(payload: unknown, sink: DetailWatchSink) {
  return ingestWatchProvidersFromDetail({
    entityType: 'movie',
    tmdbId: 1,
    entityId: null,
    payload,
    sink,
    now: NOW,
  })
}

describe('snapshot vazio revoga a oferta que saiu do Brasil', () => {
  it('sem oferta em pais nenhum: grava o BR vazio e conta o revogado', async () => {
    const { sink, written } = fakeSink()
    const report = await ingest({ 'watch/providers': { results: {} } }, sink)
    expect(report.outcome).toBe('empty')
    expect(written).toEqual([{ countryCode: 'BR', offers: [] }])
    expect(report.offersRevoked).toBe(2)
  })

  it('oferta so fora do Brasil: grava o BR vazio, mantem o desfecho `out-of-scope`', async () => {
    const { sink, written } = fakeSink()
    const report = await ingest({ 'watch/providers': { results: country('US') } }, sink)
    expect(report.outcome).toBe('out-of-scope')
    expect(written).toEqual([{ countryCode: 'BR', offers: [] }])
    expect(report.offersOutOfScope).toBe(1)
    expect(report.offersRevoked).toBe(2)
  })

  it('com oferta no Brasil: continua `applied`, com as ofertas do pais', async () => {
    const { sink, written } = fakeSink()
    const report = await ingest({ 'watch/providers': { results: country('BR') } }, sink)
    expect(report.outcome).toBe('applied')
    expect(written).toHaveLength(1)
    expect(written[0]?.offers).toHaveLength(1)
  })

  it('CONTROLE NEGATIVO: corpo nao reconhecido NAO toca o snapshot', async () => {
    const { sink, written } = fakeSink()
    const report = await ingest({ semBloco: true }, sink)
    expect(report.outcome).toBe('unrecognized')
    expect(written).toHaveLength(0)
  })
})
