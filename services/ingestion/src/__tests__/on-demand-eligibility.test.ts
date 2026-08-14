/**
 * on-demand-eligibility.test.ts — O corte editorial, provado NOS DOIS SENTIDOS.
 *
 * O teste que importa nao e "passa quando tem tudo" — e "recusa, e a recusa diz
 * QUAL campo faltou". Descarte silencioso aqui e o leitor pedindo um titulo
 * explicitamente e o sistema jogando fora sem registro.
 */

import { describe, expect, it } from 'vitest'

import {
  becomesEligibleOnDemand,
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
    const v = checkEligibility(completo, 'seed')
    expect(v.eligible).toBe(true)
  })
})

describe('checkEligibility — sentido negativo', () => {
  it('sem poster e RECUSADO, e a recusa nomeia o campo', () => {
    const v = checkEligibility({ ...completo, posterPath: null }, 'seed')
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.missing).toEqual(['poster'])
    expect(v.reason).toBe('missing_required_fields')
    // O id tem de estar no detalhe: e o que liga a recusa ao titulo no log.
    expect(v.detail).toContain('1061474')
  })

  it('sem sinopse e RECUSADO, e a recusa nomeia o campo', () => {
    const v = checkEligibility({ ...completo, overview: '   ' }, 'seed')
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.missing).toEqual(['overview'])
  })

  it('junta TODOS os campos faltantes, nao para no primeiro', () => {
    const v = checkEligibility({ ...completo, posterPath: null, overview: null }, 'seed')
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.missing).toEqual(['poster', 'overview'])
  })

  it('string vazia e so-espaco contam como falta', () => {
    for (const vazio of ['', '   ', '\n']) {
      const v = checkEligibility({ ...completo, posterPath: vazio }, 'seed')
      expect(v.eligible, `"${vazio}" deveria faltar`).toBe(false)
    }
  })

  it('toda recusa tem missing NAO-VAZIO e detalhe legivel', () => {
    const recusas = [
      checkEligibility({ ...completo, posterPath: null }, 'seed'),
      checkEligibility({ ...completo, overview: null }, 'seed'),
      checkEligibility({ ...completo, title: null }, 'seed'),
      checkEligibility({ ...completo, posterPath: null, title: null, overview: null }, 'seed'),
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
    const v = checkEligibility({ ...completo, overview: '', hasOverviewInAnyLocale: true }, 'seed')
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    // Recusado hoje pela politica de locale — mas nomeado, para poder ser
    // promovido em bloco se a politica mudar.
    expect(v.reason).toBe('missing_translation_only')
  })

  it('sinopse ausente em TODO idioma continua sendo falta de dado', () => {
    const v = checkEligibility({ ...completo, overview: '', hasOverviewInAnyLocale: false }, 'seed')
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.reason).toBe('missing_required_fields')
  })

  it('sem traducao NAO absolve quem tambem nao tem poster', () => {
    // Dois campos faltando: nao e "so traducao", e ficha incompleta.
    const v = checkEligibility(
      { ...completo, posterPath: null, overview: '', hasOverviewInAnyLocale: true },
      'seed',
    )
    expect(v.eligible).toBe(false)
    if (v.eligible) return
    expect(v.reason).toBe('missing_required_fields')
    expect(v.missing).toEqual(['poster', 'overview'])
  })
})

describe('POLITICA DE IDIOMA — assimetrica, provada nos dois sentidos', () => {
  /** Mesmo titulo nos dois testes: so tem sinopse em ingles. */
  const soIngles: EligibilityInput = {
    ...completo,
    tmdbId: 693134,
    overview: '', // vazio em pt-BR
    hasOverviewInAnyLocale: true, // existe em en-US
  }

  it('o MESMO titulo e recusado na semente e aceito sob demanda', () => {
    const semente = checkEligibility(soIngles, 'seed')
    expect(semente.eligible, 'a semente nao copia pagina em ingles').toBe(false)
    if (!semente.eligible) expect(semente.reason).toBe('missing_translation_only')

    const sobDemanda = checkEligibility(soIngles, 'on_demand')
    expect(sobDemanda.eligible, 'quem digitou o nome e pediu, recebe').toBe(true)
  })

  it('sob demanda MARCA que a sinopse veio do idioma de origem', () => {
    const v = checkEligibility(soIngles, 'on_demand')
    expect(v.eligible).toBe(true)
    if (!v.eligible) return
    // Sem isto o texto em ingles entraria fingindo ser pt-BR.
    expect(v.overviewSource).toBe('fallback')
  })

  it('quando ha sinopse no locale publicado, nao ha fallback', () => {
    const v = checkEligibility(completo, 'on_demand')
    expect(v.eligible).toBe(true)
    if (!v.eligible) return
    expect(v.overviewSource).toBe('published_locale')
  })

  it('o fallback vale SO para traducao — nao perdoa poster ausente', () => {
    const v = checkEligibility(
      { ...soIngles, posterPath: null },
      'on_demand',
    )
    expect(v.eligible).toBe(false)
  })

  it('a marca NAO e sentenca: recusado pela semente vira elegivel ao ser buscado', () => {
    expect(becomesEligibleOnDemand(soIngles)).toBe(true)
    // Quem ja passa na semente nao "vira" elegivel — ele ja era.
    expect(becomesEligibleOnDemand(completo)).toBe(false)
    // E quem falta poster nao vira elegivel por nenhum caminho.
    expect(becomesEligibleOnDemand({ ...soIngles, posterPath: null })).toBe(false)
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
