/**
 * promotion-run.test.ts — Orquestracao da revisao/promocao com portas fake.
 *
 * Trava: a listagem so pede `streaming_availability`+BR ao store; a promocao
 * exige `confirm` para mutar (dry-run nunca chama o store de escrita); com
 * `confirm`, SO os ids elegiveis vao ao store; a reversao usa o caminho certo; a
 * auditoria (api_sync_logs) sai 1x por acao efetiva; nenhuma porta de rede.
 */

import { describe, expect, it, vi } from 'vitest'

import type { SyncLogPort } from '../ports.js'
import { PROMOTION_PROVIDER_API, PROMOTION_PROVIDER_APIS } from '../promotion/guardrails.js'
import {
  PROMOTE_LOG_ENDPOINT,
  REVOKE_LOG_ENDPOINT,
  runPromotion,
  runReview,
  type ReviewStorePort,
} from '../promotion/run.js'
import type { PromotionCandidate } from '../promotion/types.js'

const NOW = new Date('2024-01-01T00:00:00.000Z')

function candidate(overrides: Partial<PromotionCandidate>): PromotionCandidate {
  return {
    id: '1',
    entityType: 'movie',
    entityId: '10',
    title: 'X',
    countryCode: 'BR',
    providerApi: PROMOTION_PROVIDER_API,
    providerKey: 'netflix',
    providerName: 'Netflix',
    offerType: 'subscription',
    deepLink: 'https://n/x',
    webUrl: null,
    price: null,
    currency: null,
    quality: 'hd',
    availableUntil: null,
    fetchedAt: NOW,
    displayAllowed: false,
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por Movie of the Night',
    attributionUrl: 'https://www.movieofthenight.com/about/api',
    ...overrides,
  }
}

interface Harness {
  readonly store: ReviewStorePort
  readonly listCandidates: ReturnType<typeof vi.fn>
  readonly findByIds: ReturnType<typeof vi.fn>
  readonly promote: ReturnType<typeof vi.fn>
  readonly revoke: ReturnType<typeof vi.fn>
  readonly syncLog: SyncLogPort
  readonly syncLogWrite: ReturnType<typeof vi.fn>
}

function makeHarness(rows: readonly PromotionCandidate[]): Harness {
  const listCandidates = vi.fn(async () => rows)
  const findByIds = vi.fn(async () => rows)
  const promote = vi.fn(async (ids: readonly string[], _reviewer: string) => ({ updated: ids.length }))
  const revoke = vi.fn(async (ids: readonly string[]) => ({ updated: ids.length }))
  const store: ReviewStorePort = { listCandidates, findByIds, promote, revoke }

  const syncLogWrite = vi.fn(async () => undefined)
  const syncLog: SyncLogPort = { write: syncLogWrite }

  return { store, listCandidates, findByIds, promote, revoke, syncLog, syncLogWrite }
}

describe('runReview — listagem escopada', () => {
  it('pede ao store SO os fornecedores governados e o pais informado', async () => {
    const h = makeHarness([candidate({ id: '1' })])
    await runReview(
      { kind: 'movie', country: 'BR', entityId: null, limit: 20, providerApis: PROMOTION_PROVIDER_APIS },
      { store: h.store, now: () => NOW },
    )

    expect(h.listCandidates).toHaveBeenCalledTimes(1)
    const query = h.listCandidates.mock.calls[0]?.[0]
    // A listagem traz as DUAS origens governadas: mostrar so uma esconderia do
    // revisor metade das ofertas que ele pode decidir.
    expect([...query.providerApis].sort()).toEqual(['streaming_availability', 'tmdb'])
    expect(query.countryCode).toBe('BR')
    expect(query.entityType).toBe('movie')
    expect(query.limit).toBe(20)
  })

  it('anexa a decisao a cada candidata e resume', async () => {
    const h = makeHarness([
      candidate({ id: '1' }), // elegivel
      candidate({ id: '2', displayAllowed: true }), // already-display-allowed
    ])
    const result = await runReview(
      { kind: null, country: 'BR', entityId: null, limit: 50, providerApis: PROMOTION_PROVIDER_APIS },
      { store: h.store, now: () => NOW },
    )

    expect(result.summary.found).toBe(2)
    expect(result.summary.eligible).toBe(1)
    expect(result.summary.rejected).toBe(1)
    expect(result.summary.byReason).toEqual([{ reason: 'already-display-allowed', count: 1 }])
  })
})

describe('runPromotion — DRY-RUN (sem --confirm) NUNCA muta', () => {
  it('nao chama promote/revoke/syncLog e reporta updated=0', async () => {
    const h = makeHarness([candidate({ id: '1' }), candidate({ id: '4' })])
    const result = await runPromotion(
      { ids: ['1', '4'], country: 'BR', confirm: false, revoke: false, reviewer: 'rev' },
      { store: h.store, syncLog: h.syncLog, now: () => NOW },
    )

    expect(h.promote).not.toHaveBeenCalled()
    expect(h.revoke).not.toHaveBeenCalled()
    expect(h.syncLogWrite).not.toHaveBeenCalled()
    expect(result.updated).toBe(0)
    // Mas ja calcula quem SERIA promovido.
    expect(result.eligibleIds).toEqual(['1', '4'])
  })
})

describe('runPromotion — --confirm muta SO os elegiveis', () => {
  it('promove apenas os ids elegiveis e loga 1x a auditoria', async () => {
    const rows = [
      candidate({ id: '1' }), // elegivel
      candidate({ id: '2', displayAllowed: true }), // already-display-allowed
      candidate({ id: '3', providerApi: 'omdb' }), // wrong-provider (nao e streaming)
      candidate({ id: '4' }), // elegivel
    ]
    const h = makeHarness(rows)
    const result = await runPromotion(
      { ids: ['1', '2', '3', '4'], country: 'BR', confirm: true, revoke: false, reviewer: 'rev' },
      { store: h.store, syncLog: h.syncLog, now: () => NOW },
    )

    expect(h.promote).toHaveBeenCalledTimes(1)
    expect(h.promote).toHaveBeenCalledWith(['1', '4'], 'rev') // nunca 2 (allowed) nem 3 (nao governado)
    expect(h.revoke).not.toHaveBeenCalled()
    expect(result.updated).toBe(2)
    expect(result.eligibleIds).toEqual(['1', '4'])

    expect(h.syncLogWrite).toHaveBeenCalledTimes(1)
    const logInput = h.syncLogWrite.mock.calls[0]?.[0]
    expect(logInput.endpoint).toBe(PROMOTE_LOG_ENDPOINT)
    expect(logInput.status).toBe('success')
    expect(logInput.itemsUpdated).toBe(2)
  })

  it('quando nada e elegivel, nao chama o store nem loga', async () => {
    const h = makeHarness([candidate({ id: '1', displayAllowed: true })])
    const result = await runPromotion(
      { ids: ['1'], country: 'BR', confirm: true, revoke: false, reviewer: 'rev' },
      { store: h.store, syncLog: h.syncLog, now: () => NOW },
    )
    expect(h.promote).not.toHaveBeenCalled()
    expect(h.syncLogWrite).not.toHaveBeenCalled()
    expect(result.updated).toBe(0)
  })
})

describe('runPromotion — reversao', () => {
  it('--revoke --confirm chama revoke (nao promote) com os elegiveis', async () => {
    const rows = [
      candidate({ id: '1', displayAllowed: true }), // revocavel
      candidate({ id: '2', displayAllowed: false }), // already-disallowed
      // `omdb` NAO e fornecedor de streaming governado — continua wrong-provider.
      // (`tmdb` deixou de servir como exemplo aqui: virou origem legitima.)
      candidate({ id: '3', providerApi: 'omdb', displayAllowed: true }), // wrong-provider
    ]
    const h = makeHarness(rows)
    const result = await runPromotion(
      { ids: ['1', '2', '3'], country: 'BR', confirm: true, revoke: true, reviewer: 'rev' },
      { store: h.store, syncLog: h.syncLog, now: () => NOW },
    )

    expect(h.revoke).toHaveBeenCalledTimes(1)
    expect(h.revoke).toHaveBeenCalledWith(['1'])
    expect(h.promote).not.toHaveBeenCalled()
    expect(result.mode).toBe('revoke')
    expect(result.updated).toBe(1)

    const logInput = h.syncLogWrite.mock.calls[0]?.[0]
    expect(logInput.endpoint).toBe(REVOKE_LOG_ENDPOINT)
  })
})

describe('runPromotion — ids ausentes', () => {
  it('ids pedidos que nao existem entram em idsMissing', async () => {
    const h = makeHarness([candidate({ id: '1' }), candidate({ id: '2' })])
    const result = await runPromotion(
      { ids: ['1', '2', '99'], country: 'BR', confirm: false, revoke: false, reviewer: 'rev' },
      { store: h.store, syncLog: h.syncLog, now: () => NOW },
    )
    expect(result.idsFound).toEqual(['1', '2'])
    expect(result.idsMissing).toEqual(['99'])
  })
})

describe('runPromotion — superficie de deps sem rede', () => {
  it('as dependencias NAO expoem nenhuma porta de fetch/rapidapi', () => {
    const h = makeHarness([])
    const deps = { store: h.store, syncLog: h.syncLog, now: () => NOW }
    const keys = Object.keys(deps)
    expect(keys.some((key) => /fetch|rapidapi|http|client/i.test(key))).toBe(false)
    expect(new Set(keys)).toEqual(new Set(['store', 'syncLog', 'now']))
    // O store tambem nao tem porta de rede: so leitura/gate.
    expect(new Set(Object.keys(h.store))).toEqual(
      new Set(['listCandidates', 'findByIds', 'promote', 'revoke']),
    )
  })
})
