/**
 * inline-marks.test.ts — A aritmetica de offset da formatacao inline.
 *
 * O risco desta feature nao e "o negrito nao aparece": e o negrito aparecer na
 * palavra ERRADA, deslocado por um caractere que ninguem percebeu. Por isso o
 * eixo dos testes e a ida-e-volta (`trechos -> {text, marks} -> trechos`) e as
 * bordas onde o offset escorrega: emoji, sobreposicao, texto vazio.
 */

import { describe, expect, it } from 'vitest'

import {
  inlineContentToSpans,
  isSafeHref,
  sanitizeMarks,
  spansToInlineContent,
  type InlineSpan,
} from '../inline-marks.js'

const span = (
  text: string,
  extra: Partial<Omit<InlineSpan, 'text'>> = {},
): InlineSpan => ({ text, bold: false, italic: false, href: null, ...extra })

describe('spansToInlineContent', () => {
  it('produz texto LIMPO, sem nenhuma tag', () => {
    const { text } = spansToInlineContent([
      span('O filme e '),
      span('otimo', { bold: true }),
      span('.'),
    ])
    expect(text).toBe('O filme e otimo.')
    expect(text).not.toMatch(/[<>]/)
  })

  it('marca o intervalo exato do trecho formatado', () => {
    const { text, marks } = spansToInlineContent([
      span('O filme e '),
      span('otimo', { bold: true }),
      span('.'),
    ])
    expect(marks).toEqual([{ start: 10, end: 15, type: 'bold' }])
    expect(text.slice(10, 15)).toBe('otimo')
  })

  it('funde trechos vizinhos de mesma formatacao numa marcacao so', () => {
    // Digitar letra a letra produz um trecho por tecla. Sem a fusao, o contrato
    // recusaria o paragrafo por marcacoes do mesmo tipo sobrepostas.
    const { marks } = spansToInlineContent([
      span('a', { bold: true }),
      span('b', { bold: true }),
      span('c', { bold: true }),
    ])
    expect(marks).toEqual([{ start: 0, end: 3, type: 'bold' }])
  })

  it('NAO funde dois links diferentes que se encostam', () => {
    const { marks } = spansToInlineContent([
      span('um', { href: 'https://a.test' }),
      span('dois', { href: 'https://b.test' }),
    ])
    expect(marks).toHaveLength(2)
    // O endereco e gravado como veio: quem normaliza e o presenter do site, na
    // hora de renderizar. Normalizar aqui faria o valor salvo diferir do que o
    // jornalista digitou, sem ganho nenhum.
    expect(marks.map((mark) => mark.href)).toEqual(['https://a.test', 'https://b.test'])
  })

  it('deixa negrito e link sobrepostos como marcacoes independentes', () => {
    const { marks } = spansToInlineContent([
      span('veja '),
      span('a critica', { bold: true, href: 'https://cinerie.com/x' }),
    ])
    expect(marks).toEqual([
      { start: 5, end: 14, type: 'bold' },
      { start: 5, end: 14, type: 'link', href: 'https://cinerie.com/x' },
    ])
  })

  it('descarta href inseguro em vez de grava-lo', () => {
    const { marks } = spansToInlineContent([span('x', { href: 'javascript:alert(1)' })])
    expect(marks).toEqual([])
  })

  it('ignora trecho vazio sem abrir marcacao', () => {
    const { text, marks } = spansToInlineContent([span(''), span('ok')])
    expect(text).toBe('ok')
    expect(marks).toEqual([])
  })
})

describe('ida e volta', () => {
  const cases: readonly (readonly InlineSpan[])[] = [
    [span('texto simples')],
    [span('a'), span('b', { bold: true }), span('c')],
    [span('so negrito', { bold: true })],
    [span('n', { bold: true, italic: true }), span('ormal')],
    [span('link ', {}), span('aqui', { href: 'https://cinerie.com/materia' })],
    [span('emoji 🎬 '), span('depois', { bold: true })],
    [span('🎬', { bold: true }), span(' fim')],
  ]

  it.each(cases.map((spans, index) => [index, spans] as const))(
    'caso %i sobrevive a ida e volta',
    (_index, spans) => {
      const { text, marks } = spansToInlineContent(spans)
      const back = inlineContentToSpans(text, marks)
      // Compara pelo CONTEUDO reconstruido, nao pela lista original: a volta
      // funde o que era separado, e isso e correto — o que precisa bater e o
      // texto e a formatacao de cada posicao.
      expect(spansToInlineContent(back)).toEqual({ text, marks })
    },
  )

  it('emoji nao desloca a marcacao seguinte', () => {
    const { text, marks } = spansToInlineContent([span('🎬 '), span('Duna', { bold: true })])
    const mark = marks[0]
    expect(mark).toBeDefined()
    expect(text.slice(mark!.start, mark!.end)).toBe('Duna')
  })
})

describe('sanitizeMarks', () => {
  const text = 'abcdefghij' // 10 caracteres

  it('aceita marcacao dentro do texto', () => {
    expect(sanitizeMarks(text, [{ start: 0, end: 4, type: 'bold' }])).toEqual([
      { start: 0, end: 4, type: 'bold' },
    ])
  })

  it('trata ausencia como "sem formatacao", nao como erro', () => {
    expect(sanitizeMarks(text, null)).toEqual([])
    expect(sanitizeMarks(text, undefined)).toEqual([])
  })

  it.each([
    ['fim alem do texto', [{ start: 0, end: 99, type: 'bold' }]],
    ['inicio negativo', [{ start: -1, end: 3, type: 'bold' }]],
    ['intervalo invertido', [{ start: 5, end: 2, type: 'bold' }]],
    ['intervalo vazio', [{ start: 3, end: 3, type: 'bold' }]],
    ['offset fracionario', [{ start: 0, end: 2.5, type: 'bold' }]],
    ['tipo desconhecido', [{ start: 0, end: 2, type: 'sublinhado' }]],
    ['link sem href', [{ start: 0, end: 2, type: 'link' }]],
    ['link com esquema proibido', [{ start: 0, end: 2, type: 'link', href: 'javascript:x' }]],
    ['href em negrito', [{ start: 0, end: 2, type: 'bold', href: 'https://x.test' }]],
    ['nao e lista', { start: 0, end: 2, type: 'bold' }],
    ['item nao e objeto', ['bold']],
    [
      'mesmo tipo sobreposto',
      [
        { start: 0, end: 5, type: 'bold' },
        { start: 3, end: 8, type: 'bold' },
      ],
    ],
  ])('recusa o conjunto inteiro: %s', (_label, raw) => {
    // FAIL-CLOSED por paragrafo: `null` significa "degrade para texto puro".
    expect(sanitizeMarks(text, raw)).toBeNull()
  })

  it('recusa corte no meio de um par surrogado', () => {
    const emoji = '🎬ab' // o emoji ocupa 2 unidades UTF-16
    expect(sanitizeMarks(emoji, [{ start: 1, end: 3, type: 'bold' }])).toBeNull()
    expect(sanitizeMarks(emoji, [{ start: 0, end: 2, type: 'bold' }])).not.toBeNull()
  })
})

describe('inlineContentToSpans', () => {
  it('texto sem marcacao vira um trecho so, sem formatacao', () => {
    expect(inlineContentToSpans('simples', null)).toEqual([span('simples')])
  })

  it('marcacao invalida degrada o paragrafo INTEIRO para texto puro', () => {
    expect(inlineContentToSpans('abc', [{ start: 0, end: 99, type: 'bold' }])).toEqual([
      span('abc'),
    ])
  })

  it('resolve sobreposicao entre tipos diferentes sem caso especial', () => {
    const spans = inlineContentToSpans('abcdef', [
      { start: 0, end: 4, type: 'bold' },
      { start: 2, end: 6, type: 'italic' },
    ])
    expect(spans).toEqual([
      span('ab', { bold: true }),
      span('cd', { bold: true, italic: true }),
      span('ef', { italic: true }),
    ])
  })

  it('texto vazio nao produz trecho', () => {
    expect(inlineContentToSpans('', null)).toEqual([])
  })
})

describe('isSafeHref', () => {
  it.each(['https://cinerie.com', 'http://exemplo.test/a?b=1'])('aceita %s', (value) => {
    expect(isSafeHref(value)).toBe(true)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', '/relativo', '', 'cinerie.com', null, 7])(
    'recusa %s',
    (value) => {
      expect(isSafeHref(value)).toBe(false)
    },
  )
})
