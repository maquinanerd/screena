/**
 * entity-ratings-projection.test.ts — O projetor do read path de ratings.
 *
 * Regressao dos achados A1/A2 da revisao adversarial da PR #74: o trigger do
 * banco e trava de ESCRITA; decisao que expira pelo tempo e licenca supersedida
 * depois da promocao nao geram nenhum write na nota — SO a leitura enxerga.
 * Estes testes provam que o projetor derruba cada elo podre sozinho, e que a
 * linha integra passa (both-ways).
 */

import { describe, expect, it } from 'vitest'

import { toPublicRating, type RatingRow } from '../../apps/web/src/server/entity-ratings'

const NOW = new Date('2026-07-17T12:00:00.000Z')
/** Coleta 2 dias antes: dentro da janela do imdb (168h). */
const FETCHED = new Date('2026-07-15T12:00:00.000Z')

const healthy: RatingRow = {
  ratingSource: 'imdb',
  ratingLabel: 'IMDb Rating',
  scoreType: 'audience',
  ratingValue: 8.4,
  ratingScale: 10,
  ratingCount: 12000,
  fetchedAt: FETCHED,
  attributionText: 'Nota fornecida por IMDb',
  attributionUrl: 'https://www.imdb.com/title/tt1/',
  requiresAttribution: true,
  requiresLinkback: true,
  dataUsageDecision: {
    useCase: 'rating_display',
    isCurrent: true,
    stage: 'approved_for_display',
    displayAllowed: true,
    territory: 'BR',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    sourceLicense: {
      isCurrent: true,
      licenseStatus: 'licensed',
      displayAllowed: true,
      scoreAllowed: true,
      contentType: 'rating',
      ratingSourceKey: 'imdb',
    },
  },
}

/** Deep-override do healthy (decision/license aninhados). */
function row(overrides: {
  root?: Partial<RatingRow>
  decision?: Partial<NonNullable<RatingRow['dataUsageDecision']>>
  license?: Partial<NonNullable<RatingRow['dataUsageDecision']>['sourceLicense']>
}): RatingRow {
  const decision = {
    ...healthy.dataUsageDecision!,
    ...overrides.decision,
    sourceLicense: { ...healthy.dataUsageDecision!.sourceLicense, ...overrides.license },
  }
  return { ...healthy, ...overrides.root, dataUsageDecision: decision }
}

describe('projetor de ratings — a linha integra passa (referencia)', () => {
  it('projeta a nota governada para o contrato publico', () => {
    const projected = toPublicRating(healthy, NOW)
    expect(projected).not.toBeNull()
    expect(projected!.sourceKey).toBe('imdb')
    expect(projected!.value).toBe(8.4)
    expect(projected!.best).toBe(10)
    expect(projected!.updatedAt).toBe(FETCHED.toISOString())
  })

  it('decisao GLOBAL (territory null) tambem autoriza', () => {
    expect(toPublicRating(row({ decision: { territory: null } }), NOW)).not.toBeNull()
  })
})

describe('projetor de ratings — A1: a licenca-mae continua sendo a autoridade', () => {
  it('licenca supersedida (is_current=false) derruba a nota SEM nenhum write', () => {
    expect(toPublicRating(row({ license: { isCurrent: false } }), NOW)).toBeNull()
  })

  it.each(['unknown', 'blocked'])('licenca com status "%s" derruba a nota', (licenseStatus) => {
    expect(toPublicRating(row({ license: { licenseStatus } }), NOW)).toBeNull()
  })

  it('licenca sem display_allowed derruba a nota', () => {
    expect(toPublicRating(row({ license: { displayAllowed: false } }), NOW)).toBeNull()
  })

  it('licenca sem score_allowed derruba a nota (exibir a nota E exibir o numero)', () => {
    expect(toPublicRating(row({ license: { scoreAllowed: false } }), NOW)).toBeNull()
  })

  it('licenca de OUTRA fonte nao autoriza esta (decisao emprestada)', () => {
    expect(toPublicRating(row({ license: { ratingSourceKey: 'metacritic' } }), NOW)).toBeNull()
  })

  it('licenca de outro content_type nao autoriza rating', () => {
    expect(toPublicRating(row({ license: { contentType: 'watch_availability' } }), NOW)).toBeNull()
  })
})

describe('projetor de ratings — decisao expirada/invalida (so a leitura pega)', () => {
  it('decisao vencida pelo TEMPO derruba a nota (validUntil no passado)', () => {
    expect(
      toPublicRating(row({ decision: { validUntil: new Date('2026-07-01T00:00:00.000Z') } }), NOW),
    ).toBeNull()
  })

  it('decisao ainda nao vigente derruba a nota', () => {
    expect(
      toPublicRating(row({ decision: { validFrom: new Date('2027-01-01T00:00:00.000Z') } }), NOW),
    ).toBeNull()
  })

  it('decisao nao-vigente / estagio errado / sem display derrubam', () => {
    expect(toPublicRating(row({ decision: { isCurrent: false } }), NOW)).toBeNull()
    expect(toPublicRating(row({ decision: { stage: 'license_pending' } }), NOW)).toBeNull()
    expect(toPublicRating(row({ decision: { displayAllowed: false } }), NOW)).toBeNull()
  })

  it('sem decisao anexada, nada aparece', () => {
    expect(toPublicRating({ ...healthy, dataUsageDecision: null }, NOW)).toBeNull()
  })

  it('decisao de outro use case nao autoriza exibicao', () => {
    expect(toPublicRating(row({ decision: { useCase: 'internal_analytics' } }), NOW)).toBeNull()
  })
})

describe('projetor de ratings — A2: territorio', () => {
  it('decisao territorial de OUTRO territorio (US) nao autoriza o site BR', () => {
    expect(toPublicRating(row({ decision: { territory: 'US' } }), NOW)).toBeNull()
  })
})

describe('projetor de ratings — demais elos', () => {
  it('fonte fora de RATING_SOURCES nao vaza pelo cast (6a fonte no banco)', () => {
    expect(toPublicRating(row({ root: { ratingSource: 'fonte_nova' } }), NOW)).toBeNull()
  })

  it('nota expirada pela stale policy nao aparece', () => {
    const old = new Date(NOW.getTime() - 800 * 3600_000)
    expect(toPublicRating(row({ root: { fetchedAt: old } }), NOW)).toBeNull()
  })

  it('score_type nao classificado nao aparece', () => {
    expect(toPublicRating(row({ root: { scoreType: null } }), NOW)).toBeNull()
  })

  it('atribuicao exigida e ausente nao aparece', () => {
    expect(toPublicRating(row({ root: { attributionText: null } }), NOW)).toBeNull()
  })
})
