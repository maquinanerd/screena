/**
 * entity-awards-projection.test.ts — O projetor do read path de premiacao.
 *
 * Mesma licao dos ratings (achados A1/A2 da PR #74): o trigger do banco e trava
 * de ESCRITA. Decisao que vence pelo tempo e licenca supersedida depois da
 * aprovacao NAO geram nenhum write na linha — so a leitura enxerga. Cada elo
 * podre e derrubado aqui, e a linha integra passa (controle POSITIVO).
 *
 * O elo especifico da premiacao e o `use_case`: uma decisao de `rating_display`
 * NAO pode acender a faixa de premios de carona.
 */

import { describe, expect, it } from 'vitest'

import {
  awardsAbsenceReasonFor,
  toAwardsPanelView,
  type AwardsRow,
} from '../../apps/web/src/server/entity-awards'

const NOW = new Date('2026-08-13T12:00:00.000Z')

const healthy: AwardsRow = {
  outcome: 'won',
  highlightCount: 4,
  awardName: 'Oscars',
  wins: 160,
  nominations: 220,
  sourceKey: 'fonte-ficticia',
  attributionText: 'Premiacao fornecida por Fonte Fictícia',
  attributionUrl: 'https://exemplo.invalid/premios',
  requiresAttribution: true,
  requiresLinkback: true,
  dataUsageDecision: {
    useCase: 'awards_display',
    isCurrent: true,
    stage: 'approved_for_display',
    displayAllowed: true,
    territory: 'BR',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    sourceLicense: {
      isCurrent: true,
      licenseStatus: 'third_party',
      displayAllowed: true,
      sourceKey: 'fonte-ficticia',
    },
  },
}

function withDecision(over: Record<string, unknown>): AwardsRow {
  return {
    ...healthy,
    dataUsageDecision: { ...healthy.dataUsageDecision!, ...over },
  } as AwardsRow
}

function withLicense(over: Record<string, unknown>): AwardsRow {
  return {
    ...healthy,
    dataUsageDecision: {
      ...healthy.dataUsageDecision!,
      sourceLicense: { ...healthy.dataUsageDecision!.sourceLicense, ...over },
    },
  } as AwardsRow
}

describe('CONTROLE POSITIVO: a linha integra passa', () => {
  it('devolve a frase em pt-BR e o credito colado nela', () => {
    expect(toAwardsPanelView(healthy, NOW)).toEqual({
      view: {
        headline: 'Venceu 4 Oscars',
        tally: { wins: 160, nominations: 220, label: '160 vitórias · 220 indicações' },
      },
      credit: {
        text: 'Premiacao fornecida por Fonte Fictícia',
        url: 'https://exemplo.invalid/premios',
      },
    })
  })
})

describe('a decisao de uso', () => {
  it('SEM decisao nao exibe', () => {
    expect(toAwardsPanelView({ ...healthy, dataUsageDecision: null }, NOW)).toBeNull()
  })

  it('decisao de RATING nao acende a faixa de PREMIOS (o eixo use_case)', () => {
    // O defeito que este caso impede: uma decisao aprovada para exibir nota
    // autorizando, de carona, a exibicao de outro tipo de afirmacao.
    expect(toAwardsPanelView(withDecision({ useCase: 'rating_display' }), NOW)).toBeNull()
  })

  it('decisao superada, fora de estagio ou nao exibivel', () => {
    expect(toAwardsPanelView(withDecision({ isCurrent: false }), NOW)).toBeNull()
    expect(toAwardsPanelView(withDecision({ stage: 'approved_for_internal_use' }), NOW)).toBeNull()
    expect(toAwardsPanelView(withDecision({ displayAllowed: false }), NOW)).toBeNull()
  })

  it('decisao VENCIDA pelo tempo — o caso que so a leitura pega', () => {
    expect(
      toAwardsPanelView(
        withDecision({ validUntil: new Date('2026-08-01T00:00:00.000Z') }),
        NOW,
      ),
    ).toBeNull()
  })

  it('decisao ainda nao vigente', () => {
    expect(
      toAwardsPanelView(withDecision({ validFrom: new Date('2027-01-01T00:00:00.000Z') }), NOW),
    ).toBeNull()
  })

  it('decisao de OUTRO territorio nao autoriza aqui', () => {
    expect(toAwardsPanelView(withDecision({ territory: 'PT' }), NOW)).toBeNull()
    // Global (null) continua valendo.
    expect(toAwardsPanelView(withDecision({ territory: null }), NOW)).not.toBeNull()
  })
})

describe('a licenca-mae continua sendo a autoridade', () => {
  it('supersedida, bloqueada ou sem permissao de exibir', () => {
    expect(toAwardsPanelView(withLicense({ isCurrent: false }), NOW)).toBeNull()
    expect(toAwardsPanelView(withLicense({ licenseStatus: 'unknown' }), NOW)).toBeNull()
    expect(toAwardsPanelView(withLicense({ licenseStatus: 'blocked' }), NOW)).toBeNull()
    expect(toAwardsPanelView(withLicense({ displayAllowed: false }), NOW)).toBeNull()
  })

  it('licenca de OUTRA fonte nao credita esta linha', () => {
    // Credito de uma fonte com autorizacao de outra e proveniencia falsa.
    expect(toAwardsPanelView(withLicense({ sourceKey: 'outra-fonte' }), NOW)).toBeNull()
  })

  it('linha sem fonte nomeada nunca exibe', () => {
    expect(toAwardsPanelView({ ...healthy, sourceKey: null }, NOW)).toBeNull()
  })
})

describe('credito obrigatorio', () => {
  it('sem texto de atribuicao nao exibe, mesmo se a licenca nao exigisse', () => {
    expect(toAwardsPanelView({ ...healthy, attributionText: null }, NOW)).toBeNull()
    expect(toAwardsPanelView({ ...healthy, attributionText: '   ' }, NOW)).toBeNull()
    expect(
      toAwardsPanelView(
        { ...healthy, attributionText: null, requiresAttribution: false },
        NOW,
      ),
    ).toBeNull()
  })

  it('linkback exigido e ausente nao exibe', () => {
    expect(toAwardsPanelView({ ...healthy, attributionUrl: null }, NOW)).toBeNull()
  })

  it('linkback DISPENSADO exibe sem link', () => {
    const view = toAwardsPanelView(
      { ...healthy, attributionUrl: null, requiresLinkback: false },
      NOW,
    )
    expect(view?.credit).toEqual({ text: healthy.attributionText, url: null })
  })

  it('URL de credito nao-HTTPS e recusada', () => {
    expect(
      toAwardsPanelView({ ...healthy, attributionUrl: 'http://exemplo.invalid/x' }, NOW),
    ).toBeNull()
  })
})

describe('integridade do fato', () => {
  it('destaque pela METADE nao vira texto quebrado', () => {
    expect(toAwardsPanelView({ ...healthy, awardName: null }, NOW)).toBeNull()
    expect(toAwardsPanelView({ ...healthy, highlightCount: null }, NOW)).toBeNull()
  })

  it('sem destaque, so a contagem, ainda e faixa', () => {
    const view = toAwardsPanelView(
      { ...healthy, outcome: null, highlightCount: null, awardName: null },
      NOW,
    )
    expect(view?.view).toEqual({
      headline: null,
      tally: { wins: 160, nominations: 220, label: '160 vitórias · 220 indicações' },
    })
  })

  it('linha sem nada a dizer nao vira faixa', () => {
    expect(
      toAwardsPanelView(
        { ...healthy, outcome: null, highlightCount: null, awardName: null, wins: null, nominations: null },
        NOW,
      ),
    ).toBeNull()
  })
})

describe('o motivo da ausencia separa passo pendente de fato sobre a obra', () => {
  it('catalogo inteiro sem faixa = alguem precisa decidir a licenca', () => {
    expect(awardsAbsenceReasonFor(false)).toBe('no_awards_source')
  })
  it('ha faixa em outros titulos = este titulo nao ganhou nada', () => {
    expect(awardsAbsenceReasonFor(true)).toBe('no_awards_for_entity')
  })
})
