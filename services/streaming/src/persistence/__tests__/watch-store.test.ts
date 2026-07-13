/**
 * watch-store.test.ts — Adapter Prisma de `watch_availability` com um Prisma FAKE.
 *
 * Fica em `persistence/__tests__/`: EXCLUIDO do `tsc` (o tsconfig raiz exclui
 * o diretorio `persistence` de todo servico), mas EXECUTADO pelo vitest (que
 * roda qualquer `*.test.ts` sob `services`). Assim testamos o adapter sem exigir
 * o Prisma Client gerado no typecheck.
 *
 * Trava duas garantias estruturais:
 *  - INVARIANTE 6: toda linha nasce `displayAllowed: false` (nao e parametro);
 *  - IDEMPOTENCIA/escopo: o DELETE do replace e sempre escopado por
 *    `provider_api = streaming_availability` (nunca apaga snapshot de outro
 *    fornecedor), e `providerApi` gravado e sempre `streaming_availability`.
 */

import { describe, expect, it } from 'vitest'

import { createPrismaWatchStore } from '../watch-store.js'
import type { WatchOfferRow } from '../../streaming-availability/types.js'

interface DeleteArgs {
  readonly where: Record<string, unknown>
}
interface CreateArgs {
  readonly data: Record<string, unknown>
}
interface FakeTx {
  watchAvailability: {
    deleteMany(args: DeleteArgs): Promise<{ count: number }>
    create(args: CreateArgs): Promise<Record<string, unknown>>
  }
}
interface FakePrisma {
  $transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T>
}

type StoreArg = Parameters<typeof createPrismaWatchStore>[0]

/** Uma oferta minima ja mapeada (o mapper e testado a parte). */
function offer(overrides: Partial<WatchOfferRow> = {}): WatchOfferRow {
  return {
    entityType: 'movie',
    entityId: '42',
    countryCode: 'BR',
    providerKey: 'netflix',
    providerName: 'Netflix',
    offerType: 'subscription',
    deepLink: 'https://www.netflix.com/br/title/1',
    price: null,
    currency: null,
    quality: 'uhd',
    availableFrom: null,
    availableUntil: null,
    ...overrides,
  }
}

/** Monta um Prisma fake que apenas registra as chamadas. */
function makeFake(deletedCount = 2): {
  prisma: StoreArg
  created: Record<string, unknown>[]
  deletes: Record<string, unknown>[]
} {
  const created: Record<string, unknown>[] = []
  const deletes: Record<string, unknown>[] = []
  const tx: FakeTx = {
    watchAvailability: {
      deleteMany: async (args) => {
        deletes.push(args.where)
        return { count: deletedCount }
      },
      create: async (args) => {
        created.push(args.data)
        return args.data
      },
    },
  }
  const prisma: FakePrisma = {
    $transaction: async (fn) => fn(tx),
  }
  return { prisma: prisma as unknown as StoreArg, created, deletes }
}

describe('createPrismaWatchStore — display_allowed e escopo do replace', () => {
  it('grava toda linha com displayAllowed=false e providerApi=streaming_availability', async () => {
    const fake = makeFake()
    const store = createPrismaWatchStore(fake.prisma)

    const outcome = await store.replaceSnapshot({
      entityType: 'movie',
      entityId: '42',
      countryCode: 'BR',
      offers: [offer(), offer({ offerType: 'rent', providerKey: 'apple', providerName: 'Apple TV' })],
      fetchedAt: new Date('2026-07-13T00:00:00.000Z'),
      staleAfter: new Date('2026-07-14T00:00:00.000Z'),
    })

    expect(fake.created).toHaveLength(2)
    for (const row of fake.created) {
      // Invariante 6: nada nasce exibivel.
      expect(row.displayAllowed).toBe(false)
      // provider_api tecnico correto (nunca vazio, nunca outro fornecedor).
      expect(row.providerApi).toBe('streaming_availability')
      // entityId convertido para BigInt.
      expect(row.entityId).toBe(42n)
    }

    expect(outcome).toEqual({ deleted: 2, created: 2 })
  })

  it('o DELETE do replace e escopado por provider_api (nunca apaga outro fornecedor)', async () => {
    const fake = makeFake()
    const store = createPrismaWatchStore(fake.prisma)

    await store.replaceSnapshot({
      entityType: 'movie',
      entityId: '42',
      countryCode: 'BR',
      offers: [offer()],
      fetchedAt: new Date('2026-07-13T00:00:00.000Z'),
      staleAfter: new Date('2026-07-14T00:00:00.000Z'),
    })

    expect(fake.deletes).toHaveLength(1)
    const where = fake.deletes[0] ?? {}
    expect(where.providerApi).toBe('streaming_availability')
    expect(where.entityType).toBe('movie')
    expect(where.entityId).toBe(42n)
    expect(where.countryCode).toBe('BR')
  })

  it('snapshot vazio (saiu do catalogo) apaga e nao cria nada', async () => {
    const fake = makeFake(3)
    const store = createPrismaWatchStore(fake.prisma)

    const outcome = await store.replaceSnapshot({
      entityType: 'movie',
      entityId: '42',
      countryCode: 'BR',
      offers: [],
      fetchedAt: new Date('2026-07-13T00:00:00.000Z'),
      staleAfter: new Date('2026-07-14T00:00:00.000Z'),
    })

    expect(fake.created).toHaveLength(0)
    expect(outcome).toEqual({ deleted: 3, created: 0 })
  })
})
