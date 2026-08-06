/**
 * "O que vai aparecer na pagina?", bloco a bloco.
 *
 * Este arquivo cobre os quatro defeitos de QUEDA SILENCIOSA que este
 * repositorio ja acumulou — todos legais no CMS, todos invisiveis na materia
 * publicada, nenhum avisando. O preview existe para que a redacao saiba ANTES.
 */

import { describe, expect, it } from 'vitest'

import { previewBlock, previewBody } from '../admin/publish-preview.js'

describe('quedas silenciosas conhecidas', () => {
  it('entityCard de PESSOA some — e o aviso diz o que fazer', () => {
    const preview = previewBlock(0, {
      blockType: 'entityCard',
      entityKind: 'person',
      entityId: '42',
    })
    expect(preview.outcome).toBe('vanishes')
    expect(preview.note).toContain('filme e série')
    // A frase precisa oferecer saida, nao so diagnostico.
    expect(preview.note).toContain('troque o tipo')
  })

  it('os cinco tipos de entidade nao hidratados somem; filme e serie aparecem', () => {
    for (const entityKind of ['season', 'episode', 'person', 'character', 'franchise']) {
      expect(previewBlock(0, { blockType: 'entityCard', entityKind, entityId: '1' }).outcome, entityKind).toBe('vanishes')
    }
    for (const entityKind of ['movie', 'tv']) {
      expect(previewBlock(0, { blockType: 'entityCard', entityKind, entityId: '1' }).outcome, entityKind).toBe('renders')
    }
  })

  it('video INTERNO some; youtube e vimeo viram link', () => {
    expect(previewBlock(0, { blockType: 'video', provider: 'internal' }).outcome).toBe('vanishes')
    for (const provider of ['youtube', 'vimeo']) {
      const preview = previewBlock(0, { blockType: 'video', provider })
      // Nao e "renders": o site publica LINK, nao player. Dizer "aparece" seria
      // tecnicamente verdade e praticamente mentira.
      expect(preview.outcome, provider).toBe('degrades')
      expect(preview.note, provider).toContain('link')
    }
  })

  it('embed de Instagram e X avisa que e CARTAO, nao publicacao incorporada', () => {
    for (const provider of ['instagram', 'x']) {
      const preview = previewBlock(0, { blockType: 'embed', provider })
      expect(preview.outcome, provider).toBe('degrades')
      expect(preview.note, provider).toContain('cartão')
    }
  })

  it('embed de YouTube aparece, e avisa do clique', () => {
    const preview = previewBlock(0, { blockType: 'embed', provider: 'youtube' })
    expect(preview.outcome).toBe('renders')
    expect(preview.note).toContain('clica')
  })
})

describe('blocos vazios', () => {
  it('paragrafo, titulo, citacao, lista, galeria e quadro vazios somem', () => {
    const vazios: readonly Record<string, unknown>[] = [
      { blockType: 'paragraph', text: '   ' },
      { blockType: 'heading', text: '' },
      { blockType: 'quote', text: '' },
      { blockType: 'list', items: [{ text: '  ' }] },
      { blockType: 'gallery', items: [] },
      { blockType: 'factBox', items: [] },
    ]
    for (const block of vazios) {
      expect(previewBlock(0, block).outcome, String(block.blockType)).toBe('vanishes')
    }
  })

  it('CONTROLE NEGATIVO: os mesmos blocos PREENCHIDOS aparecem', () => {
    // Sem isto, um `previewBlock` que dissesse "some" para tudo passaria em
    // todos os testes acima e o painel acusaria a materia inteira.
    const cheios: readonly Record<string, unknown>[] = [
      { blockType: 'paragraph', text: 'texto' },
      { blockType: 'heading', text: 'titulo' },
      { blockType: 'quote', text: 'citacao' },
      { blockType: 'list', items: [{ text: 'item' }] },
      { blockType: 'gallery', items: [{ media: 1 }] },
      { blockType: 'factBox', items: [{ label: 'a', value: 'b' }] },
    ]
    for (const block of cheios) {
      expect(previewBlock(0, block).outcome, String(block.blockType)).toBe('renders')
    }
  })
})

describe('previewBody', () => {
  it('conta quantos somem e quantos degradam', () => {
    const preview = previewBody([
      { blockType: 'paragraph', text: 'ok' },
      { blockType: 'entityCard', entityKind: 'person', entityId: '1' },
      { blockType: 'video', provider: 'internal' },
      { blockType: 'embed', provider: 'x' },
    ])
    expect(preview.vanishing).toBe(2)
    expect(preview.degrading).toBe(1)
    expect(preview.blocks).toHaveLength(4)
  })

  it('corpo vazio nao inventa aviso', () => {
    expect(previewBody([])).toEqual({ blocks: [], vanishing: 0, degrading: 0 })
    expect(previewBody(null)).toEqual({ blocks: [], vanishing: 0, degrading: 0 })
  })

  it('tipo desconhecido e anunciado, nao ignorado', () => {
    const preview = previewBlock(0, { blockType: 'carrossel_3d' })
    expect(preview.outcome).toBe('vanishes')
    expect(preview.note).toContain('carrossel_3d')
  })

  it('toda nota e em pt-BR e sem identificador cru de campo', () => {
    const amostras = [
      { blockType: 'entityCard', entityKind: 'person', entityId: '1' },
      { blockType: 'video', provider: 'internal' },
      { blockType: 'embed', provider: 'instagram' },
      { blockType: 'list', items: [] },
    ]
    for (const block of amostras) {
      const note = previewBlock(0, block).note
      expect(note).not.toBe('')
      expect(note, String(block.blockType)).not.toMatch(/blockType|entityKind|allowedFor/)
    }
  })
})
