/**
 * paragraph-marks-publication.test.ts — A formatacao CHEGA no contrato de saida.
 *
 * Este e o trecho onde o repositorio ja se queimou: um campo que o painel grava,
 * o mapeamento nao copia e o contrato descarta EM SILENCIO, com resposta 2xx.
 * Foi assim que todo draft do MNScr gravou corpo vazio. Aqui a asserção nao e
 * "o mapper devolve marks": e "o contrato de saida, depois de validar, ainda
 * tem as marcacoes" — porque validar e exatamente onde o campo sumia.
 */

import { describe, expect, it } from 'vitest'

import {
  editorialBody,
  parseContract,
  publishedEditorialBody,
} from '@screena/editorial-contracts'

import { toContractBlocks } from '../publication.js'

/** Linha de bloco como o Payload guarda. */
function paragraphRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { blockType: 'paragraph', blockId: 'blk-1', text: 'O filme Duna e otimo.', ...extra }
}

const BOLD = [{ start: 8, end: 12, type: 'bold' }]

describe('marcacoes sobrevivem ate o contrato de saida', () => {
  it('o mapper copia `marks` do painel', () => {
    expect(toContractBlocks([paragraphRow({ marks: BOLD })])).toEqual([
      { id: 'blk-1', type: 'paragraph', text: 'O filme Duna e otimo.', marks: BOLD },
    ])
  })

  it('o corpo PUBLICADO valida com as marcacoes intactas', () => {
    const result = parseContract(publishedEditorialBody, toContractBlocks([paragraphRow({ marks: BOLD })]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const block = result.value[0]
    expect(block).toBeDefined()
    expect(block!.type).toBe('paragraph')
    if (block!.type !== 'paragraph') return
    // A checagem que importa: DEPOIS do parse, nao antes.
    expect(block!.marks).toEqual(BOLD)
  })

  it('o corpo de ENTRADA tambem PRESERVA `marks` desde a 1.1.0', () => {
    // Ate a 1.0.0 este teste afirmava o contrario, e a razao era o hash pregado
    // que o MNScr declara a cada pedido: campo novo na entrada derrubaria todo
    // emissor em voo. `SUPERSEDED_CONTRACTS` passou a aceitar tambem o par
    // (versao, hash) anterior, e com isso a entrada pode receber negrito,
    // italico e link vindos do pipeline — que era o objetivo o tempo todo.
    const result = parseContract(editorialBody, toContractBlocks([paragraphRow({ marks: BOLD })]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const block = result.value[0]
    expect(block?.type === 'paragraph' ? block.marks : null).toEqual(BOLD)
  })
})

describe('paragrafo sem formatacao nao muda de forma', () => {
  it.each([
    ['ausente', {}],
    ['nulo', { marks: null }],
    ['lista vazia', { marks: [] }],
    ['invalido', { marks: [{ start: 0, end: 999, type: 'bold' }] }],
    ['nao e lista', { marks: 'bold' }],
  ])('%s: a chave `marks` NAO aparece no bloco', (_label, extra) => {
    // Emitir `marks: []` mudaria `publicContentVersion` de toda materia ja
    // publicada e dispararia republicacao em massa sem mudanca de conteudo.
    const [block] = toContractBlocks([paragraphRow(extra)])
    expect(block).toEqual({ id: 'blk-1', type: 'paragraph', text: 'O filme Duna e otimo.' })
  })

  it('artigo antigo produz o MESMO bloco de antes', () => {
    const legacy = toContractBlocks([paragraphRow()])
    expect(parseContract(publishedEditorialBody, legacy).ok).toBe(true)
    expect(parseContract(editorialBody, legacy).ok).toBe(true)
  })
})

describe('o contrato recusa marcacao que o render nao saberia desenhar', () => {
  it.each([
    ['fim alem do texto', [{ start: 0, end: 999, type: 'bold' }]],
    ['intervalo invertido', [{ start: 9, end: 2, type: 'bold' }]],
    ['link sem href', [{ start: 0, end: 3, type: 'link' }]],
    ['href em negrito', [{ start: 0, end: 3, type: 'bold', href: 'https://x.test' }]],
    ['esquema proibido', [{ start: 0, end: 3, type: 'link', href: 'javascript:alert(1)' }]],
    [
      'mesmo tipo sobreposto',
      [
        { start: 0, end: 6, type: 'bold' },
        { start: 3, end: 9, type: 'bold' },
      ],
    ],
  ])('%s', (_label, marks) => {
    // O mapper ja filtra estes casos; o contrato e a segunda barreira, para o
    // dia em que outro produtor escrever direto no evento.
    const raw = [{ id: 'blk-1', type: 'paragraph', text: 'O filme Duna e otimo.', marks }]
    expect(parseContract(publishedEditorialBody, raw).ok).toBe(false)
  })

  it('aceita negrito e link sobrepostos — sao tipos diferentes', () => {
    const raw = [
      {
        id: 'blk-1',
        type: 'paragraph',
        text: 'O filme Duna e otimo.',
        marks: [
          { start: 8, end: 12, type: 'bold' },
          { start: 8, end: 12, type: 'link', href: 'https://cinerie.com/duna' },
        ],
      },
    ]
    expect(parseContract(publishedEditorialBody, raw).ok).toBe(true)
  })

  it('recusa corte no meio de um emoji', () => {
    const raw = [{ id: 'blk-1', type: 'paragraph', text: '🎬ab', marks: [{ start: 1, end: 3, type: 'bold' }] }]
    expect(parseContract(publishedEditorialBody, raw).ok).toBe(false)
  })
})
