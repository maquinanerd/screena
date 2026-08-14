/**
 * on-demand-eligibility.test.ts — O corte editorial, provado NOS DOIS SENTIDOS.
 *
 * O teste que importa nao e "passa quando tem tudo" — e "recusa, e a recusa diz
 * QUAL campo faltou". Descarte silencioso aqui e o leitor pedindo um titulo
 * explicitamente e o sistema jogando fora sem registro.
 */

import { describe, expect, it } from 'vitest'

import {
  checkEligibility,
  looksAnnouncedOnly,
  REQUIRED_FIELDS,
  type EligibilityInput,
} from '../on-demand/eligibility.js'

const completo: EligibilityInput = {
  kind: 'movie',
  tmdbId: 1061474,
  posterPath: '/abc.jpg',
  title: 'Superman',
  overview: 'Um reporter descobre suas origens.',
}

describe('checkEligibility — sentido positivo', () => {
  it('titulo com poster, titulo e sinopse ENTRA', () => {
    const v = checkEligibility(completo)
    expect(v.eligible).toBe(true)
  })
})

describe('checkEligibility — sentido negativo', () => {
  it('sem poster e RECUSADO, e a recusa nomeia o campo', () => {
    const v = checkEligibility({ ...completo, posterPath: null })
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.missing).toEqual(['poster'])
    expect(v.reason).toBe('missing_required_fields')
    // O id tem de estar no detalhe: e o que liga a recusa ao titulo no log.
    expect(v.detail).toContain('1061474')
  })

  it('sem sinopse e RECUSADO, e a recusa nomeia o campo', () => {
    const v = checkEligibility({ ...completo, overview: '   ' })
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.missing).toEqual(['overview'])
  })

  it('junta TODOS os campos faltantes, nao para no primeiro', () => {
    const v = checkEligibility({ ...completo, posterPath: null, overview: null })
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.missing).toEqual(['poster', 'overview'])
  })

  it('string vazia e so-espaco contam como falta', () => {
    for (const vazio of ['', '   ', '\n']) {
      const v = checkEligibility({ ...completo, posterPath: vazio })
      expect(v.eligible, `"${vazio}" deveria faltar`).toBe(false)
    }
  })

  it('toda recusa tem missing NAO-VAZIO e detalhe legivel', () => {
    const recusas = [
      checkEligibility({ ...completo, posterPath: null }),
      checkEligibility({ ...completo, overview: null }),
      checkEligibility({ ...completo, title: null }),
      checkEligibility({ ...completo, posterPath: null, title: null, overview: null }),
    ]
    for (const v of recusas) {
      expect(v.eligible).toBe(false)
      if (v.eligible) continue
      expect(v.missing.length).toBeGreaterThan(0)
      expect(v.detail.length).toBeGreaterThan(0)
      for (const campo of v.missing) {
        expect(REQUIRED_FIELDS).toContain(campo)
      }
    }
  })
})

describe('falta de TRADUCAO e distinta de falta de DADO', () => {
  it('so a sinopse falta e ela existe em outro idioma: motivo proprio', () => {
    const v = checkEligibility({ ...completo, overview: '', hasOverviewInAnyLocale: true })
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    // Recusado hoje pela politica de locale — mas nomeado, para poder ser
    // promovido em bloco se a politica mudar.
    expect(v.reason).toBe('missing_translation_only')
  })

  it('sinopse ausente em TODO idioma continua sendo falta de dado', () => {
    const v = checkEligibility({ ...completo, overview: '', hasOverviewInAnyLocale: false })
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.reason).toBe('missing_required_fields')
  })

  it('sem traducao NAO absolve quem tambem nao tem poster', () => {
    // Dois campos faltando: nao e "so traducao", e ficha incompleta.
    const v = checkEligibility({
      ...completo,
      posterPath: null,
      overview: '',
      hasOverviewInAnyLocale: true,
    })
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.reason).toBe('missing_required_fields')
    expect(v.missing).toEqual(['poster', 'overview'])
  })
})

describe('looksAnnouncedOnly', () => {
  it('anunciado (so titulo) e classificado para a fila de vigilancia', () => {
    expect(
      looksAnnouncedOnly({
        kind: 'movie',
        tmdbId: 1234821,
        posterPath: null,
        title: 'Avengers Doomsday',
        overview: null,
      }),
    ).toBe(true)
  })

  it('titulo completo NAO e anunciado', () => {
    expect(looksAnnouncedOnly(completo)).toBe(false)
  })

  it('sem titulo nenhum nao e "anunciado", e lixo', () => {
    expect(
      looksAnnouncedOnly({
        kind: 'movie',
        tmdbId: 1,
        posterPath: null,
        title: null,
        overview: null,
      }),
    ).toBe(false)
  })
})
