/**
 * media-authorization.test.ts — Quem recebe os bytes de uma midia, e para que.
 *
 * A politica vive no CMS porque so ele conhece a licenca. O worker nunca deve
 * reimplementar esta regra: duas copias divergem no primeiro campo novo.
 */

import { describe, expect, it } from 'vitest'

import {
  authorizeMediaDelivery,
  isMediaPurpose,
  MEDIA_PURPOSES,
  type MediaDocumentFacts,
} from '../media-authorization.js'

const NOW = '2026-07-29T12:00:00.000Z'
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']

function facts(overrides: Partial<MediaDocumentFacts> = {}): MediaDocumentFacts {
  return {
    exists: true,
    licenseStatus: 'approved',
    licenseExpiresAtIso: null,
    requiresAttribution: false,
    credit: null,
    allowedForEditorial: true,
    allowedForHero: true,
    allowedForSocial: true,
    mimeType: 'image/jpeg',
    filesize: 100_000,
    hasFile: true,
    ...overrides,
  }
}

function check(overrides: Partial<MediaDocumentFacts> = {}, purpose: 'editorial' | 'hero' | 'social' = 'hero') {
  return authorizeMediaDelivery({
    facts: facts(overrides),
    purpose,
    nowIso: NOW,
    allowedMimeTypes: MIMES,
    maxBytes: 15 * 1024 * 1024,
  })
}

describe('finalidades', () => {
  it('so reconhece as finalidades declaradas', () => {
    expect(MEDIA_PURPOSES).toEqual(['editorial', 'hero', 'social'])
    expect(isMediaPurpose('hero')).toBe(true)
    expect(isMediaPurpose('qualquer')).toBe(false)
    expect(isMediaPurpose(null)).toBe(false)
  })
})

describe('autorizacao de entrega', () => {
  it('CONTROLE POSITIVO: midia aprovada e completa e entregue', () => {
    // Sem ele, uma politica que recusasse tudo passaria em todos os testes
    // negativos abaixo sem entregar nada.
    expect(check()).toEqual({ allowed: true })
  })

  it('documento inexistente', () => {
    const verdict = check({ exists: false })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.code).toBe('media_not_found')
  })

  it('so `approved` publica — allowlist, nao denylist', () => {
    // Um status novo no enum do CMS nasce PROIBIDO, nao permitido por descuido.
    for (const status of ['unknown', 'pending', 'prohibited', 'restricted', 'status_novo', '', null]) {
      const verdict = check({ licenseStatus: status })
      expect(verdict.allowed, String(status)).toBe(false)
      if (verdict.allowed) continue
      expect(verdict.code).toBe('license_not_approved')
    }
  })

  it('licenca vencida e recusada; futura e aceita', () => {
    const expired = check({ licenseExpiresAtIso: '2026-07-28T12:00:00.000Z' })
    expect(expired.allowed).toBe(false)
    if (!expired.allowed) expect(expired.code).toBe('license_expired')
    expect(check({ licenseExpiresAtIso: '2027-01-01T00:00:00.000Z' }).allowed).toBe(true)
  })

  it('validade ILEGIVEL conta como vencida, nao como eterna', () => {
    const verdict = check({ licenseExpiresAtIso: 'quando-der' })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.code).toBe('license_expired')
  })

  it('cada finalidade exige a SUA permissao', () => {
    const semHero = check({ allowedForHero: false }, 'hero')
    expect(semHero.allowed).toBe(false)
    if (!semHero.allowed) expect(semHero.code).toBe('purpose_not_allowed')
    // A mesma midia continua servindo para uso editorial no corpo.
    expect(check({ allowedForHero: false }, 'editorial').allowed).toBe(true)
    expect(check({ allowedForSocial: false }, 'social').allowed).toBe(false)
    expect(check({ allowedForEditorial: false }, 'editorial').allowed).toBe(false)
  })

  it('atribuicao obrigatoria sem credito e recusada (invariante 6)', () => {
    const verdict = check({ requiresAttribution: true, credit: '   ' })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.code).toBe('attribution_missing')
    // Com credito, passa.
    expect(check({ requiresAttribution: true, credit: 'Divulgacao' }).allowed).toBe(true)
  })

  it('documento sem arquivo nao entrega bytes', () => {
    const verdict = check({ hasFile: false })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.code).toBe('file_missing')
  })

  it('MIME fora da allowlist e recusado', () => {
    for (const mime of ['image/svg+xml', 'image/gif', 'text/html', 'application/pdf', '', null]) {
      const verdict = check({ mimeType: mime })
      expect(verdict.allowed, String(mime)).toBe(false)
    }
  })

  it('arquivo acima do limite e recusado', () => {
    const verdict = check({ filesize: 20 * 1024 * 1024 })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.code).toBe('file_too_large')
  })

  it('a ORDEM da recusa e util: licenca antes de formato', () => {
    // "MIME nao permitido" sobre midia cuja licenca ja tinha vencido mandaria o
    // editor reprocessar o arquivo a toa.
    const verdict = check({ licenseStatus: 'expired', mimeType: 'image/gif' })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.code).toBe('license_not_approved')
  })
})
