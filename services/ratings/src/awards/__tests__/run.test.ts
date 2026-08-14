/**
 * run.test.ts — A promocao `api_cache` -> `entity_awards`, com fakes.
 *
 * As tres coisas que este arquivo existe para provar:
 *  1. ZERO REDE — nao ha porta de rede no run, e `quota_cost = 0` no log;
 *  2. TITULO SEM PREMIO NAO VIRA REGISTRO, e o motivo aparece nomeado (os 10
 *     de 51 payloads medidos em producao que sao `N/A` ou ausentes);
 *  3. SEM LICENCA, a linha e gravada para auditoria com `display_allowed=false`
 *     — e o motivo aparece UMA vez, nao uma por titulo.
 *
 * Controle POSITIVO em cada bloco: com licenca resolvida, a linha sai exibivel.
 */

import { describe, expect, it } from 'vitest'

import type { SyncLogInput } from '../../ports.js'
import { runAwardsPromotion, resolveAwardsDisplay } from '../run.js'
import type {
  AwardsCreditResolution,
  CachedOmdbPayload,
  EntityAwardRow,
  EntityAwardUpsertOutcome,
} from '../types.js'

const NOW = new Date('2026-08-13T12:00:00.000Z')

/** Credito COMPLETO de uma fonte ficticia — nenhuma fonte real e nomeada aqui. */
const FULL_CREDIT: AwardsCreditResolution = {
  kind: 'credit',
  credit: {
    sourceKey: 'fonte-ficticia',
    licenseStatus: 'third_party',
    licenseDisplayAllowed: true,
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Premiacao fornecida por Fonte Ficticia',
    attributionUrl: 'https://exemplo.invalid/premios',
    usageDecisionId: '77',
  },
}

function payload(imdbId: string, awards: unknown): CachedOmdbPayload {
  return {
    requestKey: `i=${imdbId}`,
    payload: { Response: 'True', imdbID: imdbId, Awards: awards },
    payloadHash: `hash-${imdbId}`,
    fetchedAt: NOW,
  }
}

interface Harness {
  readonly written: EntityAwardRow[]
  readonly logs: SyncLogInput[]
  deps: Parameters<typeof runAwardsPromotion>[1]
}

function harness(
  cached: readonly CachedOmdbPayload[],
  credit: AwardsCreditResolution,
  options: { readonly knownIds?: readonly string[]; readonly refuseWrite?: boolean } = {},
): Harness {
  const written: EntityAwardRow[] = []
  const logs: SyncLogInput[] = []
  const known = new Set(options.knownIds ?? cached.map((c) => c.requestKey.replace('i=', '')))

  return {
    written,
    logs,
    deps: {
      cache: { list: async () => cached },
      credit: { resolve: async () => credit },
      entities: {
        findByImdbId: async (entityType, imdbId) =>
          known.has(imdbId) && entityType === 'movie'
            ? { entityType, entityId: `id-${imdbId}` }
            : null,
        findByTmdbId: async () => null,
      },
      awards: {
        upsert: async (row: EntityAwardRow): Promise<EntityAwardUpsertOutcome> => {
          if (options.refuseWrite === true) {
            throw new Error('entity_awards fail-closed: source_key obrigatorio')
          }
          written.push(row)
          return { created: true, changed: true, displayAllowed: row.displayAllowed }
        },
      },
      syncLog: {
        write: async (input: SyncLogInput) => {
          logs.push(input)
        },
      },
      now: () => NOW,
    },
  }
}

const OPTIONS = { apply: true, limit: null, providerApi: 'omdb', entityType: null } as const

describe('zero rede', () => {
  it('o log do ciclo registra cota gasta = 0', async () => {
    const h = harness([payload('tt1', 'Won 4 Oscars. 160 wins & 220 nominations total')], FULL_CREDIT)
    await runAwardsPromotion(OPTIONS, h.deps)
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0]?.quotaCost).toBe(0)
    expect(h.logs[0]?.endpoint).toBe('local:api_cache/omdb/awards')
  })
})

describe('CONTROLE POSITIVO: com licenca, a linha nasce exibivel e completa', () => {
  it('grava bruto E parseado, com o nome do premio verbatim', async () => {
    const raw = 'Won 4 Oscars. 160 wins & 220 nominations total'
    const h = harness([payload('tt1', raw)], FULL_CREDIT)
    const result = await runAwardsPromotion(OPTIONS, h.deps)

    expect(h.written).toHaveLength(1)
    expect(h.written[0]).toMatchObject({
      entityType: 'movie',
      entityId: 'id-tt1',
      // O BRUTO fica junto do parseado: e ele que permite reprocessar sem nova
      // chamada quando o formato do upstream mudar.
      awardsRaw: raw,
      outcome: 'won',
      highlightCount: 4,
      awardName: 'Oscars',
      wins: 160,
      nominations: 220,
      providerApi: 'omdb',
      providerPayloadHash: 'hash-tt1',
      // Credito hidratado NA ESCRITA, a partir da licenca.
      sourceKey: 'fonte-ficticia',
      attributionText: 'Premiacao fornecida por Fonte Ficticia',
      displayAllowed: true,
      dataUsageDecisionId: '77',
    })
    expect(result.counters.displayable).toBe(1)
    expect(result.status).toBe('success')
  })
})

describe('sem licenca: guarda o fato, nao acende a faixa', () => {
  it('grava com display_allowed=false e sem fonte nomeada', async () => {
    const h = harness(
      [payload('tt1', 'Won 4 Oscars. 160 wins & 220 nominations total')],
      { kind: 'no-license' },
    )
    const result = await runAwardsPromotion(OPTIONS, h.deps)

    expect(h.written[0]).toMatchObject({
      displayAllowed: false,
      sourceKey: null,
      attributionText: null,
      licenseStatus: 'unknown',
      dataUsageDecisionId: null,
    })
    expect(result.counters.displayable).toBe(0)
  })

  it('o motivo aparece UMA vez, nao uma por titulo', async () => {
    const cached = ['tt1', 'tt2', 'tt3'].map((id) => payload(id, 'Won 1 Oscar. 2 wins'))
    const h = harness(cached, { kind: 'no-license' })
    const result = await runAwardsPromotion(OPTIONS, h.deps)

    expect(h.written).toHaveLength(3)
    expect(result.rejections.filter((r) => r.reason === 'no-license')).toHaveLength(1)
  })

  it('licenca AMBIGUA nomeia as candidatas em vez de sortear uma', async () => {
    const h = harness([payload('tt1', '2 wins')], {
      kind: 'ambiguous',
      sourceKeys: ['fonte-a', 'fonte-b'],
    })
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    const rejection = result.rejections.find((r) => r.reason === 'no-license')
    expect(rejection?.detail).toContain('fonte-a')
    expect(rejection?.detail).toContain('fonte-b')
    expect(h.written[0]?.displayAllowed).toBe(false)
  })
})

describe('titulo sem premio NAO vira registro — e o motivo vai para o relatorio', () => {
  it('"N/A" e ausencia declarada, nao zero', async () => {
    const h = harness([payload('tt1', 'N/A')], FULL_CREDIT)
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    expect(h.written).toHaveLength(0)
    expect(result.rejections.map((r) => r.reason)).toEqual(['awards-not-available'])
  })

  it('campo ausente ou vazio', async () => {
    const h = harness([payload('tt1', undefined), payload('tt2', '   ')], FULL_CREDIT)
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    expect(h.written).toHaveLength(0)
    expect(result.rejections.map((r) => r.reason)).toEqual(['awards-absent', 'awards-absent'])
  })

  it('formato desconhecido registra o literal BRUTO', async () => {
    const h = harness([payload('tt1', 'Won several Oscars')], FULL_CREDIT)
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    expect(h.written).toHaveLength(0)
    const rejection = result.rejections.find((r) => r.reason === 'awards-unrecognized')
    expect(rejection?.detail).toContain('Won several Oscars')
  })

  it('a proporcao medida em producao (41 de 51) sobrevive ao ciclo', async () => {
    const withAward = Array.from({ length: 41 }, (_, i) =>
      payload(`tt${i + 100}`, 'Won 1 Oscar. 2 wins & 3 nominations total'),
    )
    const withoutAward = Array.from({ length: 10 }, (_, i) => payload(`tt${i + 900}`, 'N/A'))
    const h = harness([...withAward, ...withoutAward], FULL_CREDIT)
    const result = await runAwardsPromotion(OPTIONS, h.deps)

    expect(result.counters.payloadsRead).toBe(51)
    expect(result.counters.recognized).toBe(41)
    expect(h.written).toHaveLength(41)
    expect(result.rejections.filter((r) => r.reason === 'awards-not-available')).toHaveLength(10)
  })
})

describe('recusas estruturais', () => {
  it('payload com Response=False nunca e sucesso (a OMDb erra com HTTP 200)', async () => {
    const h = harness(
      [{ requestKey: 'i=tt1', payload: { Response: 'False', Error: 'x' }, payloadHash: 'h', fetchedAt: NOW }],
      FULL_CREDIT,
    )
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    expect(result.rejections.map((r) => r.reason)).toEqual(['payload-unusable'])
  })

  it('sem imdbID valido, o titulo e indeterminavel', async () => {
    const h = harness(
      [{ requestKey: 'i=?', payload: { Response: 'True', Awards: '2 wins' }, payloadHash: 'h', fetchedAt: NOW }],
      FULL_CREDIT,
    )
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    expect(result.rejections.map((r) => r.reason)).toEqual(['no-imdb-id'])
  })

  it('entidade local ausente e recusa nomeada, nao silencio', async () => {
    const h = harness([payload('tt1', '2 wins')], FULL_CREDIT, { knownIds: [] })
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    expect(result.rejections.map((r) => r.reason)).toEqual(['entity-not-found'])
  })

  it('RECUSA DO BANCO nunca e muda: vira write-refused e derruba o status', async () => {
    const h = harness([payload('tt1', '2 wins')], FULL_CREDIT, { refuseWrite: true })
    const result = await runAwardsPromotion(OPTIONS, h.deps)
    expect(result.rejections.map((r) => r.reason)).toEqual(['write-refused'])
    expect(result.rejections[0]?.detail).toContain('fail-closed')
    expect(result.status).toBe('failed')
  })
})

describe('dry-run e o default', () => {
  it('sem --apply nada e escrito, e o reconhecimento acontece igual', async () => {
    const h = harness([payload('tt1', 'Won 4 Oscars. 160 wins & 220 nominations total')], FULL_CREDIT)
    const result = await runAwardsPromotion({ ...OPTIONS, apply: false }, h.deps)
    expect(h.written).toHaveLength(0)
    expect(result.counters.recognized).toBe(1)
    expect(result.counters.written).toBe(0)
    // O log do ciclo sai mesmo em dry-run: nenhuma execucao e silenciosa.
    expect(h.logs).toHaveLength(1)
  })
})

describe('resolveAwardsDisplay — a politica pura', () => {
  const credit = FULL_CREDIT.credit

  it('CONTROLE POSITIVO: credito completo libera', () => {
    expect(resolveAwardsDisplay(credit)).toBe(true)
  })

  it.each([
    ['sem credito nenhum', null],
    ['licenca unknown', { ...credit, licenseStatus: 'unknown' }],
    ['licenca proibe exibir', { ...credit, licenseDisplayAllowed: false }],
    ['atribuicao exigida e ausente', { ...credit, attributionText: '  ' }],
    ['linkback exigido e ausente', { ...credit, attributionUrl: null }],
    ['linkback nao-HTTPS', { ...credit, attributionUrl: 'http://exemplo.invalid' }],
    ['sem decisao de uso', { ...credit, usageDecisionId: null }],
  ])('%s => nao exibe', (_label, input) => {
    expect(resolveAwardsDisplay(input)).toBe(false)
  })

  it('linkback DISPENSADO exibe sem link', () => {
    expect(
      resolveAwardsDisplay({ ...credit, requiresLinkback: false, attributionUrl: null }),
    ).toBe(true)
  })
})
