/**
 * guardrails-and-brake.test.ts — Guardrails por linha + freio de volume.
 *
 * Cada guardrail e afirmado SOZINHO. Um gate com sete checagens testado so pelo
 * resultado final passa verde com seis delas apagadas.
 */

import { describe, expect, it } from 'vitest'

import { evaluateMassChangeBrake, DEFAULT_MASS_CHANGE_THRESHOLDS } from '../brake.js'
import { evaluatePromotion, evaluateRevocation } from '../guardrails.js'
import { censusPromotion, type EvaluatedCandidate } from '../run.js'
import type { PersonPhotoCandidate, VideoCandidate } from '../types.js'

function video(overrides: Partial<VideoCandidate> = {}): VideoCandidate {
  return {
    kind: 'video',
    id: '1',
    providerApi: 'tmdb',
    entityType: 'movie',
    tmdbId: 550,
    site: 'YouTube',
    videoKey: 'BdJKm16Co6M', // 11 caracteres, alfabeto seguro
    name: 'Trailer oficial',
    videoType: 'Trailer',
    official: true,
    languageCode: 'pt-BR',
    displayAllowed: false,
    licenseStatus: 'unknown',
    ...overrides,
  }
}

function foto(overrides: Partial<PersonPhotoCandidate> = {}): PersonPhotoCandidate {
  return {
    kind: 'person-photo',
    id: '1',
    providerApi: 'tmdb',
    entityType: 'person',
    tmdbId: 287,
    imageType: 'profile',
    filePath: '/abc123.jpg',
    languageCode: null,
    displayAllowed: false,
    licenseStatus: 'unknown',
    ...overrides,
  }
}

describe('CONTROLE POSITIVO', () => {
  it('video de nascimento (display=false, status=unknown) e ELEGIVEL', () => {
    expect(evaluatePromotion(video())).toEqual({ eligible: true, reason: null })
  })
  it('foto de pessoa de nascimento e ELEGIVEL', () => {
    expect(evaluatePromotion(foto())).toEqual({ eligible: true, reason: null })
  })
})

describe('guardrails de VIDEO, um a um', () => {
  it('provider fora de tmdb -> wrong-provider', () => {
    expect(evaluatePromotion(video({ providerApi: 'rapidapi' })).reason).toBe('wrong-provider')
  })

  it('linha com license_status=blocked -> row-blocked (bloqueio deliberado nunca e sobrescrito)', () => {
    expect(evaluatePromotion(video({ licenseStatus: 'blocked' })).reason).toBe('row-blocked')
  })

  it('row-blocked vence already-promoted — o desfecho grave nao se esconde atras do inofensivo', () => {
    const linha = video({ displayAllowed: true, licenseStatus: 'blocked' })
    expect(evaluatePromotion(linha).reason).toBe('row-blocked')
  })

  it('ja acesa (display + status nao bloqueante) -> already-promoted', () => {
    expect(evaluatePromotion(video({ displayAllowed: true, licenseStatus: 'official' })).reason).toBe(
      'already-promoted',
    )
  })

  it('MEIO-PROMOVIDA (display=true, status=unknown) NAO conta como acesa — e o que promover conserta', () => {
    // Se este estado fosse tratado como "ja promovida", ele congelaria para
    // sempre: invisivel na tela e inelegivel na CLI.
    expect(evaluatePromotion(video({ displayAllowed: true, licenseStatus: 'unknown' }))).toEqual({
      eligible: true,
      reason: null,
    })
  })

  it('site que nao e YouTube -> wrong-site (comparacao EXATA)', () => {
    expect(evaluatePromotion(video({ site: 'Vimeo' })).reason).toBe('wrong-site')
    expect(evaluatePromotion(video({ site: 'YouTube Kids' })).reason).toBe('wrong-site')
  })

  it.each(['curto', 'id-com/barra', 'BdJKm16Co6MX', ''])(
    'video_key invalido "%s" -> invalid-video-key',
    (key) => {
      expect(evaluatePromotion(video({ videoKey: key })).reason).toBe('invalid-video-key')
    },
  )

  /**
   * A DECISAO DO DONO (2026-08-25), afirmada nos dois sentidos.
   *
   * `video_type` deixou de ser gate de promocao. Um teste que so afirmasse
   * "Trailer passa" continuaria verde se o filtro voltasse.
   */
  it.each(['Trailer', 'Teaser', 'Featurette', 'Behind the Scenes', 'Bloopers', 'Clip', 'Recap', null])(
    'video_type "%s" NAO e mais gate: passa',
    (tipo) => {
      expect(evaluatePromotion(video({ videoType: tipo })).eligible).toBe(true)
    },
  )

  it('official NAO filtra por padrao', () => {
    expect(evaluatePromotion(video({ official: false })).eligible).toBe(true)
    expect(evaluatePromotion(video({ official: null })).eligible).toBe(true)
  })

  it('com --only-official, nao-oficial -> not-official', () => {
    const opts = { onlyOfficial: true }
    expect(evaluatePromotion(video({ official: false }), opts).reason).toBe('not-official')
    expect(evaluatePromotion(video({ official: null }), opts).reason).toBe('not-official')
    expect(evaluatePromotion(video({ official: true }), opts).eligible).toBe(true)
  })
})

describe('guardrails de FOTO DE PESSOA', () => {
  it('imagem que nao e de pessoa -> wrong-image-scope', () => {
    expect(evaluatePromotion(foto({ entityType: 'movie' })).reason).toBe('wrong-image-scope')
  })
  it('imagem de pessoa que nao e profile -> wrong-image-scope', () => {
    expect(evaluatePromotion(foto({ imageType: 'backdrop' })).reason).toBe('wrong-image-scope')
  })
  it.each(['sem-barra.jpg', '//host/x.jpg', '/media/legado.jpg', '/a b.jpg', '/x?y=1'])(
    'file_path "%s" que buildTmdbImageUrl recusa -> invalid-file-path',
    (p) => {
      expect(evaluatePromotion(foto({ filePath: p })).reason).toBe('invalid-file-path')
    },
  )
})

describe('reversao: direcao segura, quase sem guardrail', () => {
  it('linha acesa e revogavel', () => {
    expect(evaluateRevocation(video({ displayAllowed: true })).eligible).toBe(true)
  })
  it('linha ja apagada -> already-dark', () => {
    expect(evaluateRevocation(video({ displayAllowed: false })).reason).toBe('already-dark')
  })
  it('meio-promovida (display=true, status bloqueante) AINDA e revogavel — normalizar e trabalho', () => {
    expect(evaluateRevocation(video({ displayAllowed: true, licenseStatus: 'unknown' })).eligible).toBe(
      true,
    )
  })
  it('provider nao governado -> wrong-provider (nem para apagar tocamos em dado alheio)', () => {
    expect(evaluateRevocation(video({ displayAllowed: true, providerApi: 'omdb' })).reason).toBe(
      'wrong-provider',
    )
  })
})

// ---------------------------------------------------------------------------

function avaliar(candidatas: readonly VideoCandidate[]): EvaluatedCandidate[] {
  return candidatas.map((candidate) => {
    const d = evaluatePromotion(candidate)
    return { candidate, eligible: d.eligible, reason: d.reason }
  })
}

describe('FREIO de mudanca em massa', () => {
  it('o denominador e o ALVO INTEIRO, nao a selecao — senao a razao seria sempre 100%', () => {
    const evaluated = avaliar([video({ id: '1' }), video({ id: '2' })])
    const census = censusPromotion('video', 10_000, evaluated)
    expect(census.totalInTarget).toBe(10_000)
    expect(census.changing).toBe(2)
    const verdict = evaluateMassChangeBrake({ census, confirmed: false })
    expect(verdict.changeRatio).toBeCloseTo(0.0002)
    expect(verdict.blocked).toBe(false)
  })

  it('promover o acervo inteiro (1119/1119) TRAVA nos dois tetos', () => {
    // O caso real da primeira execucao. Nao e o freio atrapalhando: acender o
    // acervo inteiro de uma vez e o ato que precisa de assinatura humana.
    const evaluated = avaliar(Array.from({ length: 1119 }, (_, i) => video({ id: String(i + 1) })))
    const census = censusPromotion('video', 1119, evaluated)
    const verdict = evaluateMassChangeBrake({ census, confirmed: false })
    expect(verdict.exceeded).toBe(true)
    expect([...verdict.exceededBy].sort()).toEqual(['absolute', 'ratio'])
    expect(verdict.blocked).toBe(true)
    expect(verdict.explanation).toContain('RECUSADA')
  })

  it('--confirm-mass-change desbloqueia mas REGISTRA que houve mudanca em massa', () => {
    const evaluated = avaliar(Array.from({ length: 1119 }, (_, i) => video({ id: String(i + 1) })))
    const census = censusPromotion('video', 1119, evaluated)
    const verdict = evaluateMassChangeBrake({ census, confirmed: true })
    expect(verdict.exceeded).toBe(true) // o fato nao e apagado pelo opt-in
    expect(verdict.blocked).toBe(false)
    expect(verdict.explanation).toContain('CONFIRMADA')
  })

  it('teto e o ultimo valor ACEITO: 500 passa, 501 trava (comparacao estrita)', () => {
    const mk = (n: number) => censusPromotion('video', 1_000_000, avaliar(Array.from({ length: n }, (_, i) => video({ id: String(i + 1) }))))
    expect(evaluateMassChangeBrake({ census: mk(500), confirmed: false }).exceeded).toBe(false)
    expect(evaluateMassChangeBrake({ census: mk(501), confirmed: false }).exceededBy).toContain('absolute')
  })

  it('alvo vazio nao divide por zero', () => {
    const verdict = evaluateMassChangeBrake({ census: censusPromotion('video', 0, []), confirmed: false })
    expect(verdict.changeRatio).toBe(0)
    expect(verdict.blocked).toBe(false)
  })

  it('os tetos default sao os MESMOS do freio da #221 (dois numeros = duas politicas)', () => {
    expect(DEFAULT_MASS_CHANGE_THRESHOLDS).toEqual({ maxChanges: 500, maxChangeRatio: 0.05 })
  })
})

describe('CENSO', () => {
  it('separa oficiais de nao-oficiais entre os ELEGIVEIS', () => {
    const census = censusPromotion(
      'video',
      100,
      avaliar([
        video({ id: '1', official: true }),
        video({ id: '2', official: false }),
        video({ id: '3', official: null }),
        // recusada: nao entra em nenhuma contagem de elegivel
        video({ id: '4', official: true, site: 'Vimeo' }),
      ]),
    )
    expect(census.official).toEqual({ yes: 1, no: 1, unknown: 1 })
    expect(census.changing).toBe(3)
    expect(census.byReason).toEqual([{ reason: 'wrong-site', count: 1 }])
  })

  it('agrupa elegiveis por tipo de video, e tipo nulo vira rotulo explicito', () => {
    const census = censusPromotion(
      'video',
      100,
      avaliar([
        video({ id: '1', videoType: 'Trailer' }),
        video({ id: '2', videoType: 'Trailer' }),
        video({ id: '3', videoType: 'Featurette' }),
        video({ id: '4', videoType: null }),
      ]),
    )
    expect(census.byType).toEqual([
      { type: 'Trailer', count: 2 },
      { type: 'Featurette', count: 1 },
      { type: '(sem tipo)', count: 1 },
    ])
  })
})
