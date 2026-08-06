/**
 * O painel de SEO: o que ele deriva e o que ele mede.
 *
 * A regra que estes testes existem para travar e "NUNCA sobrescrever o que a
 * redacao escreveu". Um painel que melhora o titulo escrito a mao apaga decisao
 * editorial, e a pessoa so descobre depois de publicado.
 */

import { describe, expect, it } from 'vitest'

import {
  buildSerpPreview,
  measureSeoField,
  resolveSeoValue,
  SEO_LIMITS,
} from '../admin/seo-preview.js'

describe('resolveSeoValue', () => {
  it('o ESCRITO vence sempre, e a origem diz que foi manual', () => {
    const resolved = resolveSeoValue('Título da redação', 'Título da matéria')
    expect(resolved).toEqual({ value: 'Título da redação', origin: 'manual' })
  })

  it('campo vazio deriva do fallback, e a origem diz que foi derivado', () => {
    expect(resolveSeoValue('', 'Título da matéria')).toEqual({
      value: 'Título da matéria',
      origin: 'derived',
    })
  })

  it('so espaco em branco conta como VAZIO, nao como escrito', () => {
    // Sem isto, um campo com um espaco bloquearia a derivacao para sempre e a
    // pessoa nunca entenderia por que a sugestao sumiu.
    expect(resolveSeoValue('   ', 'Título').origin).toBe('derived')
  })

  it('sem escrito e sem fallback, vazio — nao inventa texto', () => {
    expect(resolveSeoValue(null, null)).toEqual({ value: '', origin: 'empty' })
  })

  it('CONTROLE NEGATIVO: a derivacao NAO altera o texto escrito', () => {
    // O defeito espelhado seria um "normalizador" que apara, corta ou capitaliza
    // o que a redacao digitou. O texto volta byte a byte, so sem as bordas.
    const escrito = 'Título com  espaços internos e "aspas"'
    expect(resolveSeoValue(escrito, 'outro').value).toBe(escrito)
  })
})

describe('measureSeoField', () => {
  it('dentro do limite: ok, e o preview e o texto inteiro', () => {
    const measure = measureSeoField('Título curto', SEO_LIMITS.metaTitle)
    expect(measure.status).toBe('ok')
    expect(measure.preview).toBe('Título curto')
  })

  it('acima do limite: AVISO, nao erro, e o preview mostra o corte', () => {
    const longo = 'a'.repeat(SEO_LIMITS.metaTitle + 20)
    const measure = measureSeoField(longo, SEO_LIMITS.metaTitle)
    expect(measure.status).toBe('long')
    expect(measure.length).toBe(SEO_LIMITS.metaTitle + 20)
    // O preview cabe no limite, com a reticencia que o resultado de busca usa.
    expect(measure.preview.length).toBeLessThanOrEqual(SEO_LIMITS.metaTitle)
    expect(measure.preview.endsWith('…')).toBe(true)
  })

  it('vazio e um estado proprio, distinto de curto', () => {
    expect(measureSeoField('  ', 10).status).toBe('empty')
    expect(measureSeoField('  ', 10).length).toBe(0)
  })
})

describe('buildSerpPreview', () => {
  const base = {
    siteUrl: 'https://cinerie.com',
    locale: 'pt-BR',
    slug: 'estreia-da-temporada',
    title: 'Estreia da temporada',
    metaTitle: null,
    summary: 'O que muda nos primeiros episódios.',
    metaDescription: null,
  }

  it('monta a URL REAL da materia, nao um exemplo', () => {
    // Preview com URL falsa esconde justamente o erro que ele deveria revelar.
    expect(buildSerpPreview(base).url).toBe(
      'https://cinerie.com/pt/noticias/estreia-da-temporada/',
    )
  })

  it('slug vazia aparece como lacuna, nao como URL plausivel', () => {
    expect(buildSerpPreview({ ...base, slug: '' }).url).toContain('…')
  })

  it('deriva titulo e descricao quando os campos de busca estao vazios', () => {
    const preview = buildSerpPreview(base)
    expect(preview.titleOrigin).toBe('derived')
    expect(preview.title.preview).toBe('Estreia da temporada')
    expect(preview.descriptionOrigin).toBe('derived')
  })

  it('o que a redacao escreveu VENCE a derivacao, nos dois campos', () => {
    const preview = buildSerpPreview({
      ...base,
      metaTitle: 'Título de busca próprio',
      metaDescription: 'Descrição própria.',
    })
    expect(preview.titleOrigin).toBe('manual')
    expect(preview.title.preview).toBe('Título de busca próprio')
    expect(preview.descriptionOrigin).toBe('manual')
    expect(preview.description.preview).toBe('Descrição própria.')
  })
})
