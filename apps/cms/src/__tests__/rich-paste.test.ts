/**
 * rich-paste.test.ts — Colar do Word/Docs PRESERVANDO negrito, italico e link.
 *
 * Colar e o gesto mais comum de uma redacao, e ate agora ele achatava tudo em
 * texto cru. O que interessa aqui nao e "reconhece `<b>`": e o Google Docs, que
 * nao cola `<b>` nenhum — cola `<span style="font-weight:700">`. Um parser que
 * so entende as tags classicas perde a formatacao exatamente na origem mais
 * usada.
 */

import { describe, expect, it } from 'vitest'

import { spansToInlineContent } from '../inline-marks.js'
import {
  PASTE_MAX_BLOCKS,
  planPaste,
  planRichPaste,
  splitPastedHtmlRich,
} from '../admin/paste-to-blocks.js'

/** Colapsa o resultado numa forma facil de ler nas asserts. */
function shape(html: string): { text: string; marks: unknown[] }[] {
  return splitPastedHtmlRich(html).map((spans) => {
    const { text, marks } = spansToInlineContent(spans)
    return { text, marks }
  })
}

describe('formatacao preservada', () => {
  it('reconhece <strong> e <em>', () => {
    expect(shape('<p>O filme <strong>Duna</strong> e <em>otimo</em>.</p>')).toEqual([
      {
        text: 'O filme Duna e otimo.',
        marks: [
          { start: 8, end: 12, type: 'bold' },
          { start: 15, end: 20, type: 'italic' },
        ],
      },
    ])
  })

  it('reconhece <b> e <i> classicos', () => {
    expect(shape('<p><b>Um</b> e <i>dois</i></p>')).toEqual([
      {
        text: 'Um e dois',
        marks: [
          { start: 0, end: 2, type: 'bold' },
          { start: 5, end: 9, type: 'italic' },
        ],
      },
    ])
  })

  it('reconhece o negrito do Google Docs (font-weight numerico)', () => {
    // O Docs nao usa <b>: usa <span style="font-weight:700">.
    expect(shape('<p>veja <span style="font-weight:700">isto</span></p>')).toEqual([
      { text: 'veja isto', marks: [{ start: 5, end: 9, type: 'bold' }] },
    ])
  })

  it('reconhece italico por style', () => {
    expect(shape(`<p><span style='font-style: italic'>assim</span></p>`)).toEqual([
      { text: 'assim', marks: [{ start: 0, end: 5, type: 'italic' }] },
    ])
  })

  it('preserva link com destino seguro', () => {
    expect(shape('<p>leia <a href="https://cinerie.com/x">a materia</a></p>')).toEqual([
      {
        text: 'leia a materia',
        marks: [{ start: 5, end: 14, type: 'link', href: 'https://cinerie.com/x' }],
      },
    ])
  })

  it('descarta link com esquema proibido mas MANTEM o texto', () => {
    expect(shape('<p>veja <a href="javascript:alert(1)">aqui</a></p>')).toEqual([
      { text: 'veja aqui', marks: [] },
    ])
  })

  it('mantem negrito dentro de link como duas marcacoes', () => {
    expect(shape('<p><a href="https://x.test"><b>tudo</b></a></p>')).toEqual([
      {
        text: 'tudo',
        marks: [
          { start: 0, end: 4, type: 'bold' },
          { start: 0, end: 4, type: 'link', href: 'https://x.test' },
        ],
      },
    ])
  })

  it('fechar um <span> nao apaga o negrito de um <b> por fora', () => {
    // A pilha de tags precisa saber QUEM abriu cada formatacao. Sem isso, o
    // `</span>` zeraria o negrito e o resto do texto sairia normal.
    expect(shape('<p><b>um <span style="color:red">dois</span> tres</b></p>')).toEqual([
      { text: 'um dois tres', marks: [{ start: 0, end: 12, type: 'bold' }] },
    ])
  })

  it('tag inline nao separa palavra', () => {
    expect(shape('<p><b>ne</b>grito</p>')).toEqual([
      { text: 'negrito', marks: [{ start: 0, end: 2, type: 'bold' }] },
    ])
  })
})

describe('quebra em paragrafos', () => {
  it('cada <p> vira um bloco, com a formatacao propria', () => {
    const result = shape('<p>um <b>a</b></p><p>dois <i>b</i></p>')
    expect(result).toEqual([
      { text: 'um a', marks: [{ start: 3, end: 4, type: 'bold' }] },
      { text: 'dois b', marks: [{ start: 5, end: 6, type: 'italic' }] },
    ])
  })

  it('<br><br> separa; <br> sozinho e so espaco', () => {
    expect(shape('a<br><br>b').map((entry) => entry.text)).toEqual(['a', 'b'])
    expect(shape('a<br>b').map((entry) => entry.text)).toEqual(['a b'])
  })

  it('linha em branco separa mesmo sem tag de bloco', () => {
    expect(shape('primeiro\n\nsegundo').map((entry) => entry.text)).toEqual([
      'primeiro',
      'segundo',
    ])
  })

  it('descarta o conteudo de <script> e <style>, nao so as tags', () => {
    const result = shape('<p>ok</p><script>alert(1)</script><style>p{color:red}</style>')
    expect(result.map((entry) => entry.text)).toEqual(['ok'])
  })

  it('nenhum texto de saida contem markup', () => {
    for (const entry of shape('<p><b>a</b> <a href="https://x.test">b</a></p>')) {
      expect(entry.text).not.toMatch(/[<>]/)
    }
  })

  it('normaliza NBSP e espaco repetido sem deslocar a marcacao', () => {
    const [first] = shape('<p>a&nbsp;&nbsp;<b>b</b></p>')
    expect(first).toBeDefined()
    expect(first!.text).toBe('a b')
    expect(first!.marks).toEqual([{ start: 2, end: 3, type: 'bold' }])
  })
})

describe('planRichPaste', () => {
  it('texto puro vira paragrafos sem formatacao', () => {
    const plan = planRichPaste({ text: 'um\n\ndois' })
    expect(plan.paragraphs.map((spans) => spans[0]?.text)).toEqual(['um', 'dois'])
    expect(plan.dropped).toBe(0)
  })

  it('respeita o teto e informa quantos ficaram de fora', () => {
    const html = Array.from({ length: PASTE_MAX_BLOCKS + 3 }, (_, i) => `<p>p${String(i)}</p>`).join('')
    const plan = planRichPaste({ html })
    expect(plan.paragraphs).toHaveLength(PASTE_MAX_BLOCKS)
    expect(plan.dropped).toBe(3)
  })
})

describe('compatibilidade com planPaste', () => {
  it('continua entregando os mesmos paragrafos em TEXTO puro', () => {
    // `planPaste` segue existindo para quem so quer o texto; o parser por baixo
    // agora e um so, entao os dois nunca divergem.
    expect(planPaste({ html: '<p>um <b>a</b></p><p>dois</p>' }).paragraphs).toEqual([
      'um a',
      'dois',
    ])
  })
})
