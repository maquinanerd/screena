/**
 * admin-authoring.test.ts — as duas regras puras da reforma de escrita do admin:
 * id de bloco automatico e paste que quebra em paragrafos.
 *
 * LIMITE, dito com todas as letras: os componentes React que consomem estas
 * regras NAO sao testados aqui. `apps/cms/vitest.config.ts` roda
 * `environment: 'node'` e coleta so `src/**\/__tests__/**\/*.test.ts` — nao ha
 * testing-library nem DOM no repositorio, entao nenhum `.tsx` e coletado. O que
 * esta coberto e a decisao; a fiacao pede olho humano no navegador.
 */

import { describe, expect, it } from 'vitest'

import { BLOCK_ID_PATTERN, generateBlockId, isUsableBlockId } from '../admin/block-id.js'
import { PASTE_MAX_BLOCKS, planPaste, splitPastedHtml, splitPastedText } from '../admin/paste-to-blocks.js'

/* ------------------------------------------------------------------ */
/* Id de bloco                                                         */
/* ------------------------------------------------------------------ */

/** Aleatoriedade previsivel: o teste mede o FORMATO, nao a entropia. */
const fakeHex = (fill: string) => (length: number) => fill.repeat(length).slice(0, length)

describe('generateBlockId', () => {
  it('produz id que o CONTRATO aceita', () => {
    const id = generateBlockId(fakeHex('a1'))
    expect(id).toBe('ba1a1a1a1a1a1')
    expect(BLOCK_ID_PATTERN.test(id)).toBe(true)
  })

  it('nunca comeca por digito', () => {
    // O contrato aceitaria digito inicial, mas um id que comeca por numero e
    // ambiguo em log e em query string. O prefixo torna a origem obvia.
    for (const fill of ['0', '9', 'f']) {
      expect(generateBlockId(fakeHex(fill)).startsWith('b')).toBe(true)
    }
  })

  it('a armadilha do nanoid e a PRIMEIRA posicao, nao o `_`', () => {
    // O corpo do id aceita `_` e `-`; a primeira posicao, nao. O alfabeto padrao
    // do nanoid pode emitir os dois em primeira posicao — falha intermitente.
    expect(isUsableBlockId('V1StGXR8_Z5jdHi6B-myT')).toBe(true)
    expect(isUsableBlockId('_1StGXR8Z5jdHi6B-myT')).toBe(false)
    expect(isUsableBlockId('-1StGXR8Z5jdHi6B_myT')).toBe(false)
  })

  it('o prefixo fixo torna a primeira posicao impossivel de errar', () => {
    // Varre um espaco de primeiros bytes que o nanoid produziria cru.
    for (const fill of ['0', '5', 'a', 'f']) {
      expect(isUsableBlockId(generateBlockId(fakeHex(fill)))).toBe(true)
    }
  })

  it('id vazio ou ausente nao passa por usavel', () => {
    for (const value of ['', null, undefined, 42, {}, '-comeca-com-hifen']) {
      expect(isUsableBlockId(value)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Paste                                                               */
/* ------------------------------------------------------------------ */

describe('splitPastedText', () => {
  it('quebra por linha EM BRANCO, nao por quebra simples', () => {
    // Texto de PDF/e-mail vem quebrado a cada linha da tela; tratar cada uma
    // como paragrafo produziria dezenas de blocos de meia frase.
    expect(splitPastedText('uma frase\nque continua\n\noutro paragrafo')).toEqual([
      'uma frase que continua',
      'outro paragrafo',
    ])
  })

  it('descarta paragrafo que era so espaco', () => {
    expect(splitPastedText('primeiro\n\n   \n\nsegundo')).toEqual(['primeiro', 'segundo'])
  })

  it('texto sem linha em branco continua sendo UM paragrafo', () => {
    expect(splitPastedText('uma frase so')).toEqual(['uma frase so'])
  })
})

describe('splitPastedHtml', () => {
  it('quebra em </p> e em <br><br>', () => {
    expect(splitPastedHtml('<p>Primeiro</p><p>Segundo</p>')).toEqual(['Primeiro', 'Segundo'])
    expect(splitPastedHtml('Primeiro<br><br>Segundo')).toEqual(['Primeiro', 'Segundo'])
  })

  it('descarta markup inline SEM colar as palavras', () => {
    // `<b>ne</b>grito` precisa virar "negrito", nao "ne grito" nem "negrito"
    // com a tag dentro. O contrato recusaria qualquer tag sobrevivente.
    expect(splitPastedHtml('<p><b>ne</b>grito e <em>italico</em></p>')).toEqual([
      'negrito e italico',
    ])
  })

  it('o CORPO de <script>/<style> some junto com a tag', () => {
    // Remover so as tags deixaria as regras CSS como texto do paragrafo.
    const pasted = '<style>.x{color:red}</style><p>Texto real</p><script>alert(1)</script>'
    expect(splitPastedHtml(pasted)).toEqual(['Texto real'])
  })

  it('nenhum paragrafo produzido carrega markup — o contrato recusaria', () => {
    const pasted = '<div><h2>Titulo</h2><p>Corpo com <a href="http://x.test">link</a>.</p></div>'
    for (const paragraph of splitPastedHtml(pasted)) {
      expect(paragraph).not.toMatch(/<[^>]*>/)
    }
  })

  it('decodifica as entidades que o Word e o Docs emitem', () => {
    expect(splitPastedHtml('<p>Ru&amp;dolph&nbsp;&mdash;&nbsp;o filme</p>')).toEqual([
      'Ru&dolph — o filme',
    ])
  })

  it('lista vira um paragrafo por item', () => {
    expect(splitPastedHtml('<ul><li>Um</li><li>Dois</li></ul>')).toEqual(['Um', 'Dois'])
  })
})

describe('planPaste', () => {
  it('prefere o HTML, que e quem carrega o limite de paragrafo', () => {
    const plan = planPaste({ html: '<p>Um</p><p>Dois</p>', text: 'Um Dois' })
    expect(plan.paragraphs).toEqual(['Um', 'Dois'])
  })

  it('cai para texto puro quando nao ha HTML', () => {
    expect(planPaste({ text: 'Um\n\nDois' }).paragraphs).toEqual(['Um', 'Dois'])
  })

  it('paste vazio nao produz bloco nenhum', () => {
    expect(planPaste({ text: '   \n\n  ' })).toEqual({ paragraphs: [], dropped: 0 })
    expect(planPaste({})).toEqual({ paragraphs: [], dropped: 0 })
  })

  it('acima do teto CORTA e diz quantos cortou — nunca some calado', () => {
    const many = Array.from({ length: PASTE_MAX_BLOCKS + 7 }, (_, i) => `P${String(i)}`).join('\n\n')
    const plan = planPaste({ text: many })
    expect(plan.paragraphs).toHaveLength(PASTE_MAX_BLOCKS)
    expect(plan.dropped).toBe(7)
  })
})
