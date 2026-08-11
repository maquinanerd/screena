/**
 * Testes de `resolveDisplayAllowed`.
 *
 * DISCIPLINA DE FIXTURE (o motivo de este bloco existir):
 * uma leva anterior de 5 testes negativos passava pelo MOTIVO ERRADO — a fixture
 * nao tinha `displayAllowed` e usava nomes de campo trocados, entao o codigo sob
 * teste devolvia `null` para TUDO e cada `expect(...).toBe(false)` ficava verde
 * sem exercitar a regra.
 *
 * A defesa aqui e dupla e ambas as pecas sao obrigatorias:
 *   1. `expectedCreditKeys` — trava o CONTRATO da fixture. Renomear/remover um
 *      campo quebra este teste, nao os outros silenciosamente.
 *   2. `controle positivo` — prova que a fixture BASE resolve `true`. Como todo
 *      teste negativo e a fixture base com UM campo estragado, o controle
 *      garante que a recusa veio daquele campo, e nao de uma fixture podre.
 */

import { describe, expect, it } from 'vitest'

import {
  resolveDisplayAllowed,
  type DisplaySubject,
  type SourceCredit,
} from '../display-authorization.js'

/** Fonte que EXIGE credito (o caso do IMDb via agregador tecnico). */
function baseSubject(overrides: Partial<DisplaySubject> = {}): DisplaySubject {
  return {
    sourceKey: 'imdb',
    needsScorePermission: true,
    classified: true,
    ...overrides,
  }
}

/** Licenca vigente COM credito satisfeito. Espelha authorization-spec.ts. */
function baseCredit(overrides: Partial<SourceCredit> = {}): SourceCredit {
  return {
    licenseStatus: 'third_party',
    licenseDisplayAllowed: true,
    licenseScoreAllowed: true,
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Nota fornecida por IMDb',
    attributionUrl: 'https://www.imdb.com/title/tt0111161/',
    usageDecisionId: '42',
    ...overrides,
  }
}

/** Contrato da fixture. Se um campo sumir ou for renomeado, ESTE teste cai. */
const expectedCreditKeys = [
  'attributionText',
  'attributionUrl',
  'licenseDisplayAllowed',
  'licenseScoreAllowed',
  'licenseStatus',
  'requiresAttribution',
  'requiresLinkback',
  'usageDecisionId',
] as const

describe('integridade da fixture (controle positivo)', () => {
  it('a fixture declara EXATAMENTE os campos do contrato', () => {
    // Sem isto, um campo renomeado viraria `undefined`, o codigo recusaria por
    // outro motivo, e os testes negativos ficariam verdes sem provar nada.
    expect(Object.keys(baseCredit()).sort()).toEqual([...expectedCreditKeys])
  })

  it('CONTROLE POSITIVO: a fixture base resolve para exibivel', () => {
    // Se este teste falhar, TODOS os negativos abaixo perdem o valor: eles
    // passariam por fixture podre, nao pela regra que dizem exercitar.
    const result = resolveDisplayAllowed(baseSubject(), baseCredit())
    expect(result).toEqual({ displayAllowed: true, reason: null, detail: null })
  })
})

describe('credito obrigatorio', () => {
  it('fonte exige credito + credito presente -> true', () => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit())
    expect(result.displayAllowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('fonte exige credito + attribution_text AUSENTE -> false', () => {
    const result = resolveDisplayAllowed(
      baseSubject(),
      baseCredit({ attributionText: null }),
    )
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('missing-attribution')
  })

  it('fonte exige credito + attribution_text VAZIO -> false', () => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ attributionText: '' }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('missing-attribution')
  })

  it('fonte exige credito + attribution_text so-espaco -> false', () => {
    // Whitespace nao e credito. `'   '` seria truthy num teste ingenuo.
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ attributionText: '   \t\n ' }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('missing-attribution')
  })

  it('fonte exige linkback + attribution_url AUSENTE -> false', () => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ attributionUrl: null }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('missing-linkback')
  })

  it('fonte exige linkback + attribution_url so-espaco -> false', () => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ attributionUrl: '  ' }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('missing-linkback')
  })

  it('attribution_url nao-HTTPS -> false', () => {
    const result = resolveDisplayAllowed(
      baseSubject(),
      baseCredit({ attributionUrl: 'http://www.imdb.com/' }),
    )
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('unsafe-attribution-url')
  })

  it('fonte que NAO exige credito exibe sem attribution_text', () => {
    // Prova que a recusa acima vem de `requiresAttribution`, e nao do simples
    // fato de o texto estar vazio.
    const result = resolveDisplayAllowed(
      baseSubject(),
      baseCredit({
        requiresAttribution: false,
        requiresLinkback: false,
        attributionText: null,
        attributionUrl: null,
      }),
    )
    expect(result.displayAllowed).toBe(true)
  })
})

describe('autoridade da licenca (fail-closed)', () => {
  it('sem licenca resolvida -> false', () => {
    const result = resolveDisplayAllowed(baseSubject(), null)
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('no-license')
  })

  it.each(['unknown', 'blocked'])('license_status "%s" -> false', (licenseStatus) => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ licenseStatus }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('license-not-displayable')
  })

  it('licenca com display_allowed=false -> false', () => {
    const result = resolveDisplayAllowed(
      baseSubject(),
      baseCredit({ licenseDisplayAllowed: false }),
    )
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('license-forbids-display')
  })

  it('score_allowed=false bloqueia quem precisa mostrar NUMERO', () => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ licenseScoreAllowed: false }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('license-forbids-score')
  })

  it('score_allowed=false NAO bloqueia quem nao mostra numero (oferta de streaming)', () => {
    const result = resolveDisplayAllowed(
      baseSubject({ sourceKey: 'netflix', needsScorePermission: false }),
      baseCredit({ licenseScoreAllowed: false }),
    )
    expect(result.displayAllowed).toBe(true)
  })

  it('sem decisao de uso vigente -> false', () => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ usageDecisionId: null }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('no-usage-decision')
  })

  it('decisao de uso so-espaco conta como AUSENTE', () => {
    const result = resolveDisplayAllowed(baseSubject(), baseCredit({ usageDecisionId: '  ' }))
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('no-usage-decision')
  })

  it('dado nao classificado -> false (critics != audience)', () => {
    const result = resolveDisplayAllowed(baseSubject({ classified: false }), baseCredit())
    expect(result.displayAllowed).toBe(false)
    expect(result.reason).toBe('unclassified')
  })
})

describe('forma do resultado', () => {
  it('reason e null se e somente se displayAllowed', () => {
    const allowed = resolveDisplayAllowed(baseSubject(), baseCredit())
    expect(allowed.reason === null).toBe(allowed.displayAllowed)

    const refused = resolveDisplayAllowed(baseSubject(), null)
    expect(refused.reason === null).toBe(refused.displayAllowed)
  })

  it('toda recusa carrega detail diagnostico nao vazio', () => {
    const refused = resolveDisplayAllowed(baseSubject(), baseCredit({ attributionText: null }))
    expect(refused.detail).toBeTruthy()
    expect((refused.detail as string).trim()).not.toBe('')
  })
})
