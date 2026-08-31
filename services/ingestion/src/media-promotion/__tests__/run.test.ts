/**
 * run.test.ts — O CONTROLE NEGATIVO DE PONTA A PONTA que o dono pediu.
 *
 * ============================================================================
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE
 * ============================================================================
 * "Se a licenca vigente sumir, o comando escreve mesmo assim?"
 *
 * Testar `authorizeMediaPromotion` isolado prova que a FUNCAO nega. Nao prova
 * que o `run` a CHAMA — e um `run` que consultasse a licenca, ignorasse o
 * resultado e mutasse assim mesmo passaria em `license.test.ts` inteiro.
 *
 * A prova aqui e por CONTAGEM DE ESCRITA: o store falso conta cada chamada de
 * mutacao. Zero escritas com licenca ausente, e o par positivo mostrando que o
 * mesmo cenario COM licenca escreve — senao o zero seria vacuo.
 */

import { describe, expect, it } from 'vitest'

import type { MediaLicenseRow } from '../license.js'
import { runMediaPromotion, type MediaPromotionStorePort, type SyncLogPort } from '../run.js'
import type { PromotionCandidate, PromotionTarget } from '../types.js'

const LICENCA_VIGENTE: MediaLicenseRow = {
  sourceKey: 'tmdb',
  contentType: 'video',
  licenseStatus: 'official',
  displayAllowed: true,
  isCurrent: true,
  policyVersion: 'cinerie-source-auth/tmdb-video/2026-08-v3',
}

function candidatas(n: number): PromotionCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'video' as const,
    id: String(i + 1),
    providerApi: 'tmdb',
    entityType: 'movie',
    tmdbId: 550 + i,
    site: 'YouTube',
    videoKey: 'BdJKm16Co6M',
    name: null,
    videoType: 'Trailer',
    official: true,
    languageCode: 'pt-BR',
    displayAllowed: false,
    licenseStatus: 'unknown',
  }))
}

/** Store falso que CONTA escritas. O contador e a prova. */
function fakeStore(input: {
  licenses: readonly MediaLicenseRow[]
  rows: readonly PromotionCandidate[]
  total: number
}) {
  const writes: Array<{ op: 'promote' | 'revoke'; ids: readonly string[]; licenseStatus?: string }> = []
  const store: MediaPromotionStorePort = {
    async readLicenses() {
      return input.licenses
    },
    async countTarget() {
      return input.total
    },
    async listCandidates() {
      return input.rows
    },
    async promote(_target: PromotionTarget, ids: readonly string[], licenseStatus: string) {
      writes.push({ op: 'promote', ids, licenseStatus })
      return { updated: ids.length }
    },
    async revoke(_target: PromotionTarget, ids: readonly string[]) {
      writes.push({ op: 'revoke', ids })
      return { updated: ids.length }
    },
  }
  return { store, writes }
}

function fakeLog() {
  const written: unknown[] = []
  const syncLog: SyncLogPort = {
    async write(entry) {
      written.push(entry)
    },
  }
  return { syncLog, written }
}

const NOW = () => new Date('2026-08-25T12:00:00.000Z')

const escopo = { target: 'video' as const, entityType: null, tmdbId: null, limit: null }
const base = {
  scope: escopo,
  confirm: true,
  revoke: false,
  confirmMassChange: true,
  guardrails: { onlyOfficial: false },
}

describe('CONTROLE NEGATIVO — sem licenca vigente, o comando NAO escreve', () => {
  it('licenca AUSENTE: zero escritas, mesmo com --confirm e --confirm-mass-change', async () => {
    const { store, writes } = fakeStore({ licenses: [], rows: candidatas(50), total: 1119 })
    const { syncLog, written } = fakeLog()

    const result = await runMediaPromotion(base, { store, syncLog, now: NOW })

    expect(writes).toHaveLength(0)
    expect(result.updated).toBe(0)
    expect(result.outcome).toBe('license-denied')
    // Nem log de mutacao: nao houve mutacao a registrar.
    expect(written).toHaveLength(0)
  })

  it('licenca SUPERADA (is_current=false): zero escritas', async () => {
    const { store, writes } = fakeStore({
      licenses: [{ ...LICENCA_VIGENTE, isCurrent: false }],
      rows: candidatas(50),
      total: 1119,
    })
    const result = await runMediaPromotion(base, { store, syncLog: fakeLog().syncLog, now: NOW })
    expect(writes).toHaveLength(0)
    expect(result.outcome).toBe('license-denied')
  })

  it('licenca vigente com display_allowed=false: zero escritas', async () => {
    const { store, writes } = fakeStore({
      licenses: [{ ...LICENCA_VIGENTE, displayAllowed: false }],
      rows: candidatas(50),
      total: 1119,
    })
    const result = await runMediaPromotion(base, { store, syncLog: fakeLog().syncLog, now: NOW })
    expect(writes).toHaveLength(0)
    expect(result.outcome).toBe('license-denied')
  })

  it('licenca vigente blocked: zero escritas', async () => {
    const { store, writes } = fakeStore({
      licenses: [{ ...LICENCA_VIGENTE, licenseStatus: 'blocked' }],
      rows: candidatas(50),
      total: 1119,
    })
    const result = await runMediaPromotion(base, { store, syncLog: fakeLog().syncLog, now: NOW })
    expect(writes).toHaveLength(0)
    expect(result.outcome).toBe('license-denied')
  })
})

describe('CONTROLE POSITIVO — o mesmo cenario COM licenca escreve (senao o zero acima e vacuo)', () => {
  it('licenca vigente: escreve, e o license_status gravado vem da LICENCA', async () => {
    const { store, writes } = fakeStore({
      licenses: [LICENCA_VIGENTE],
      rows: candidatas(50),
      total: 1119,
    })
    const { syncLog, written } = fakeLog()

    const result = await runMediaPromotion(base, { store, syncLog, now: NOW })

    expect(result.outcome).toBe('applied')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.op).toBe('promote')
    expect(writes[0]?.ids).toHaveLength(50)
    expect(writes[0]?.licenseStatus).toBe('official')
    expect(result.updated).toBe(50)
    // Todo sync/mutacao gera log; quota zero prova que nao houve rede.
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ endpoint: 'promote:tmdb_media', status: 'success', quotaCost: 0 })
  })

  it('o status gravado ACOMPANHA a licenca: third_party na licenca -> third_party na linha', async () => {
    const { store, writes } = fakeStore({
      licenses: [{ ...LICENCA_VIGENTE, licenseStatus: 'third_party' }],
      rows: candidatas(3),
      total: 1119,
    })
    await runMediaPromotion(base, { store, syncLog: fakeLog().syncLog, now: NOW })
    expect(writes[0]?.licenseStatus).toBe('third_party')
  })
})

describe('FREIO — travado, calcula tudo e escreve ZERO', () => {
  it('sem --confirm-mass-change, 1119/1119 nao escreve nada', async () => {
    const { store, writes } = fakeStore({
      licenses: [LICENCA_VIGENTE],
      rows: candidatas(1119),
      total: 1119,
    })
    const result = await runMediaPromotion(
      { ...base, confirmMassChange: false },
      { store, syncLog: fakeLog().syncLog, now: NOW },
    )
    expect(result.outcome).toBe('mass-change-blocked')
    expect(writes).toHaveLength(0)
    // O censo continua completo: o operador precisa VER o que travou.
    expect(result.census.changing).toBe(1119)
    expect(result.brake?.blocked).toBe(true)
  })

  it('O FREIO VALE EM DRY-RUN: sair verde ali diria "pode aplicar" para quem nao pode', async () => {
    const { store } = fakeStore({ licenses: [LICENCA_VIGENTE], rows: candidatas(1119), total: 1119 })
    const result = await runMediaPromotion(
      { ...base, confirm: false, confirmMassChange: false },
      { store, syncLog: fakeLog().syncLog, now: NOW },
    )
    expect(result.outcome).toBe('mass-change-blocked')
  })
})

describe('DRY-RUN nao escreve, e le exatamente o que o apply leria', () => {
  it('sem --confirm: zero escritas, censo cheio, ids elegiveis listados', async () => {
    const { store, writes } = fakeStore({
      licenses: [LICENCA_VIGENTE],
      rows: candidatas(50),
      total: 1119,
    })
    const result = await runMediaPromotion(
      { ...base, confirm: false },
      { store, syncLog: fakeLog().syncLog, now: NOW },
    )
    expect(result.outcome).toBe('dry-run')
    expect(writes).toHaveLength(0)
    expect(result.eligibleIds).toHaveLength(50)
    // A licenca FOI consultada no dry-run — nao ha caminho curto.
    expect(result.authorization.authorized).toBe(true)
    expect(result.authorization.policyVersion).toBe('cinerie-source-auth/tmdb-video/2026-08-v3')
  })
})

describe('REVERSAO nao depende de licenca', () => {
  it('sem licenca nenhuma, revoke ainda apaga — apagar nunca precisa de permissao', async () => {
    const acesas = candidatas(10).map((row) => ({ ...row, displayAllowed: true, licenseStatus: 'official' }))
    const { store, writes } = fakeStore({ licenses: [], rows: acesas, total: 1119 })
    const result = await runMediaPromotion(
      { ...base, revoke: true },
      { store, syncLog: fakeLog().syncLog, now: NOW },
    )
    expect(result.outcome).toBe('applied')
    expect(writes[0]?.op).toBe('revoke')
    expect(result.updated).toBe(10)
  })
})
