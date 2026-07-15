/**
 * watch-store.test.ts — Adapter Prisma de `watch_availability` com Prisma FAKE.
 *
 * O adapter agora RECONCILIA por IDENTIDADE ESTAVEL via SQL bruto
 * (`$executeRaw` com ON CONFLICT no indice unico funcional), em vez de
 * `deleteMany` + `create`. Este teste FAKE captura o SQL emitido e trava as
 * garantias estruturais SEM banco real; o comportamento fim-a-fim vive no
 * integration test `scripts/validate-stores-real-postgres.ts` (PostgreSQL efemero).
 *
 * Trava:
 *  - fail-closed: o sync nasce `display_allowed=false` e NUNCA liga display;
 *  - SEM DELETE cego: nenhum `DELETE FROM watch_availability`;
 *  - upsert por identidade: `ON CONFLICT (watch_offer_identity_key_v1(...))`, e
 *    a revogacao de aprovacao usa `watch_offer_payload_fingerprint_v1`;
 *  - escopo `provider_api = streaming_availability` em todo statement;
 *  - ofertas sumidas: revogadas (`display_allowed=false`) + `stale_after`, nao apagadas.
 */

import { describe, expect, it } from 'vitest'

import { createPrismaWatchStore } from '../watch-store.js'
import type { WatchOfferRow } from '../../streaming-availability/types.js'

interface Emitted {
  readonly sql: string
  readonly values: readonly unknown[]
}
interface FakeTx {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>
}
interface FakePrisma {
  $transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T>
}

type StoreArg = Parameters<typeof createPrismaWatchStore>[0]

function offer(overrides: Partial<WatchOfferRow> = {}): WatchOfferRow {
  return {
    entityType: 'movie',
    entityId: '42',
    countryCode: 'BR',
    externalOfferId: null,
    providerKey: 'netflix',
    providerName: 'Netflix',
    package: null,
    offerType: 'subscription',
    deepLink: 'https://www.netflix.com/br/title/1',
    webUrl: null,
    price: null,
    currency: null,
    quality: 'uhd',
    availableFrom: null,
    availableUntil: null,
    ...overrides,
  }
}

/** Prisma fake que grava cada `$executeRaw` (SQL + valores) e retorna 1 linha. */
function makeFake(): { prisma: StoreArg; emitted: Emitted[] } {
  const emitted: Emitted[] = []
  const tx: FakeTx = {
    $executeRaw: async (strings, ...values) => {
      emitted.push({ sql: strings.join(' ? '), values })
      return 1
    },
  }
  const prisma: FakePrisma = { $transaction: async (fn) => fn(tx) }
  return { prisma: prisma as unknown as StoreArg, emitted }
}

describe('createPrismaWatchStore — reconciliacao por identidade, fail-closed', () => {
  it('upsert por identidade (nao DELETE), fail-closed e escopo por provider_api', async () => {
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

    // 2 upserts + 1 statement de "sumidas" = 3 comandos SQL.
    expect(fake.emitted).toHaveLength(3)
    const upserts = fake.emitted.slice(0, 2)
    const disappeared = fake.emitted[2]!

    for (const cmd of upserts) {
      expect(cmd.sql).toContain('INSERT INTO "watch_availability"')
      expect(cmd.sql).toContain('ON CONFLICT (watch_offer_identity_key_v1(')
      expect(cmd.sql).toContain('DO UPDATE SET')
      // Revogacao de aprovacao ao mudar payload usa o fingerprint do payload.
      expect(cmd.sql).toContain('watch_offer_payload_fingerprint_v1(')
      // Fail-closed: display nasce false; NUNCA ligado no sync.
      expect(cmd.sql).toMatch(/false,\s*now\(\)/)
      expect(cmd.sql).not.toMatch(/display_allowed"\s*=\s*true/i)
      // Escopo tecnico deste worker entre os valores parametrizados.
      expect(cmd.values).toContain('streaming_availability')
      expect(cmd.values).toContain(42n)
    }

    // "Sumidas": revoga (display false) + marca stale; NUNCA apaga.
    expect(disappeared.sql).toContain('UPDATE "watch_availability"')
    expect(disappeared.sql).toContain('"display_allowed" = false')
    expect(disappeared.sql).toContain('"stale_after" = now()')
    expect(disappeared.sql).toContain('"provider_api" =')
    expect(disappeared.values).toContain('streaming_availability')

    // NENHUM statement apaga linha as cegas.
    for (const cmd of fake.emitted) {
      expect(cmd.sql).not.toMatch(/DELETE\s+FROM/i)
    }

    // outcome: 1 revogada (sumidas) + 2 upsertadas.
    expect(outcome).toEqual({ deleted: 1, created: 2 })
  })

  it('snapshot vazio: nenhum upsert, so revoga as sumidas (nao apaga)', async () => {
    const fake = makeFake()
    const store = createPrismaWatchStore(fake.prisma)

    const outcome = await store.replaceSnapshot({
      entityType: 'movie',
      entityId: '42',
      countryCode: 'BR',
      offers: [],
      fetchedAt: new Date('2026-07-13T00:00:00.000Z'),
      staleAfter: new Date('2026-07-14T00:00:00.000Z'),
    })

    expect(fake.emitted).toHaveLength(1)
    expect(fake.emitted[0]!.sql).toContain('UPDATE "watch_availability"')
    expect(fake.emitted[0]!.sql).not.toMatch(/DELETE\s+FROM/i)
    expect(outcome).toEqual({ deleted: 1, created: 0 })
  })
})
