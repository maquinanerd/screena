/**
 * block-row-label.test.ts — o bloco recolhido diz o que ele e.
 *
 * LIMITE: o componente React nao e testado aqui.  roda
 * `environment: 'node'` e coleta so `src/**\/__tests__/**\/*.test.ts` — nao ha
 * testing-library nem DOM no repositorio, entao nenhum `.tsx` e coletado.
 */

import { describe, expect, it } from 'vitest'

import { EDITORIAL_BLOCK_TYPES } from '@screena/editorial-contracts'

import { ROW_LABEL_MAX, buildBlockRowLabel, formatBlockRowLabel } from '../admin/block-row-label.js'

/* ------------------------------------------------------------------ */

describe('buildBlockRowLabel', () => {
  it('paragrafo mostra o inicio do texto', () => {
    expect(buildBlockRowLabel({ blockType: 'paragraph', text: 'O festival anuncia a mostra.' })).toEqual({
      type: 'Parágrafo',
      preview: 'O festival anuncia a mostra.',
      empty: false,
    })
  })

  it('bloco vazio SE DENUNCIA em vez de virar "Untitled"', () => {
    const label = buildBlockRowLabel({ blockType: 'paragraph', text: '   ' })
    expect(label.empty).toBe(true)
    expect(formatBlockRowLabel({ blockType: 'paragraph', text: '' })).toBe('Parágrafo — vazio')
  })

  it('imagem se identifica pelo alt, e cai para a legenda', () => {
    expect(buildBlockRowLabel({ blockType: 'image', alt: 'Cartaz do filme' }).preview).toBe(
      'Cartaz do filme',
    )
    expect(buildBlockRowLabel({ blockType: 'image', alt: '', caption: 'Divulgação' }).preview).toBe(
      'Divulgação',
    )
  })

  it('separador e vazio POR NATUREZA e nao vira pendencia', () => {
    // Se ele contasse como vazio, o aviso gritaria sempre e perderia o sentido.
    expect(buildBlockRowLabel({ blockType: 'divider' })).toEqual({
      type: 'Separador',
      preview: null,
      empty: false,
    })
  })

  it('blocos de lista contam os itens', () => {
    expect(buildBlockRowLabel({ blockType: 'sourceList', sourceRefs: ['a'] }).preview).toBe('1 fonte')
    expect(
      buildBlockRowLabel({ blockType: 'relatedContent', articleRefs: ['a', 'b'] }).preview,
    ).toBe('2 matérias vinculadas')
  })

  it('corta na palavra e nunca passa do teto', () => {
    const long = 'palavra '.repeat(40)
    const preview = buildBlockRowLabel({ blockType: 'paragraph', text: long }).preview ?? ''
    expect(preview.length).toBeLessThanOrEqual(ROW_LABEL_MAX + 1)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview).not.toMatch(/palav…$/)
  })

  it('achata quebra de linha: o rotulo e de UMA linha', () => {
    expect(buildBlockRowLabel({ blockType: 'paragraph', text: 'linha um\nlinha dois' }).preview).toBe(
      'linha um linha dois',
    )
  })

  it('TODO tipo do contrato tem nome em portugues', () => {
    // Guarda contra tipo novo no contrato entrar no painel como "Bloco".
    for (const blockType of EDITORIAL_BLOCK_TYPES) {
      expect(buildBlockRowLabel({ blockType }).type).not.toBe('Bloco')
    }
  })

  it('entrada malformada nao derruba o rotulo', () => {
    for (const raw of [null, undefined, 'texto', 42]) {
      expect(buildBlockRowLabel(raw).type).toBe('Bloco')
    }
  })
})
