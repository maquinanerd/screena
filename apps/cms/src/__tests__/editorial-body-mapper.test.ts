/**
 * editorial-body-mapper.test.ts — A traducao contrato -> Payload, sem banco.
 *
 * O que estes testes NAO provam: que o Payload aceita o resultado. Essa
 * pergunta e de integracao e vive em `automation-draft-body.integration.test.ts`
 * — e e a que pegou o defeito de origem. Aqui se prova a forma; la, o efeito.
 */

import { describe, expect, it } from 'vitest'

import { EDITORIAL_BLOCK_TYPES } from '@screena/editorial-contracts'

import { toPayloadBlocks } from '../editorial-body-mapper.js'

/** Resolve qualquer referencia para a midia 42. */
const resolveAll = { resolveMedia: () => 42 }
/** Nao resolve nada: o caso da candidata aguardando aprovacao humana. */
const resolveNone = { resolveMedia: () => null }

describe('toPayloadBlocks — traducao por tipo', () => {
  it('paragraph: texto e proveniencia', () => {
    const { blocks } = toPayloadBlocks(
      [
        {
          id: 'b1',
          type: 'paragraph',
          text: 'Abertura.',
          provenance: [{ origin: 'external_source', ref: 'src-1' }],
        },
      ],
      resolveNone,
    )
    expect(blocks).toEqual([
      {
        blockType: 'paragraph',
        blockId: 'b1',
        text: 'Abertura.',
        provenance: [{ origin: 'external_source', ref: 'src-1' }],
      },
    ])
  })

  it('heading: level NUMERO vira o texto que o ENUM da coluna aceita', () => {
    const { blocks } = toPayloadBlocks(
      [
        { id: 'h2', type: 'heading', level: 2, text: 'Dois' },
        { id: 'h3', type: 'heading', level: 3, text: 'Tres' },
        { id: 'h4', type: 'heading', level: 4, text: 'Quatro' },
      ],
      resolveNone,
    )
    expect(blocks.map((block) => block.level)).toEqual(['2', '3', '4'])
    expect(blocks.every((block) => typeof block.level === 'string')).toBe(true)
  })

  it('image: mediaRef resolvido vira a relacao `media`, sem sobrar mediaRef', () => {
    const { blocks, warnings } = toPayloadBlocks(
      [
        {
          id: 'i1',
          type: 'image',
          mediaRef: 'cand-1',
          alt: 'Alt',
          caption: 'Legenda',
          credit: 'Credito',
        },
      ],
      resolveAll,
    )
    expect(blocks).toEqual([
      {
        blockType: 'image',
        blockId: 'i1',
        media: 42,
        alt: 'Alt',
        caption: 'Legenda',
        credit: 'Credito',
      },
    ])
    expect(blocks[0]).not.toHaveProperty('mediaRef')
    expect(warnings).toEqual([])
  })

  it('image NAO resolvida sai do corpo, mas com aviso que NOMEIA o bloco', () => {
    const { blocks, warnings } = toPayloadBlocks(
      [
        { id: 'p1', type: 'paragraph', text: 'Antes.' },
        { id: 'i1', type: 'image', mediaRef: 'cand-pendente', alt: 'Alt' },
        { id: 'p2', type: 'paragraph', text: 'Depois.' },
      ],
      resolveNone,
    )
    expect(blocks.map((block) => block.blockId)).toEqual(['p1', 'p2'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('i1')
    expect(warnings[0]).toContain('cand-pendente')
  })

  it('image nunca ganha relacao fabricada quando nao ha midia', () => {
    const { blocks } = toPayloadBlocks(
      [{ id: 'i1', type: 'image', mediaRef: 'x', alt: 'Alt' }],
      resolveNone,
    )
    expect(blocks.some((block) => block.blockType === 'image')).toBe(false)
  })

  it('sourceList: sourceRefs preservados', () => {
    const { blocks } = toPayloadBlocks(
      [{ id: 's1', type: 'sourceList', sourceRefs: ['src-1', 'src-2'] }],
      resolveNone,
    )
    expect(blocks).toEqual([
      { blockType: 'sourceList', blockId: 's1', sourceRefs: ['src-1', 'src-2'] },
    ])
  })

  it('quote, entityCard, factBox, relatedContent, video e divider', () => {
    const { blocks } = toPayloadBlocks(
      [
        { id: 'q1', type: 'quote', text: 'Citacao.', attribution: 'Fonte', sourceRef: 'src-1' },
        { id: 'e1', type: 'entityCard', entityKind: 'movie', entityId: 'ent-1', note: 'Nota' },
        {
          id: 'f1',
          type: 'factBox',
          title: 'Ficha',
          items: [{ label: 'Diretor', value: 'Denis' }],
        },
        { id: 'r1', type: 'relatedContent', articleRefs: ['a-1', 'a-2'] },
        { id: 'v1', type: 'video', provider: 'youtube', externalId: 'abc', title: 'Trailer' },
        { id: 'd1', type: 'divider' },
      ],
      resolveNone,
    )
    expect(blocks).toEqual([
      {
        blockType: 'quote',
        blockId: 'q1',
        text: 'Citacao.',
        attribution: 'Fonte',
        sourceRef: 'src-1',
      },
      {
        blockType: 'entityCard',
        blockId: 'e1',
        entityKind: 'movie',
        entityId: 'ent-1',
        note: 'Nota',
      },
      {
        blockType: 'factBox',
        blockId: 'f1',
        title: 'Ficha',
        items: [{ label: 'Diretor', value: 'Denis' }],
      },
      { blockType: 'relatedContent', blockId: 'r1', articleRefs: ['a-1', 'a-2'] },
      {
        blockType: 'video',
        blockId: 'v1',
        provider: 'youtube',
        externalId: 'abc',
        title: 'Trailer',
      },
      { blockType: 'divider', blockId: 'd1' },
    ])
  })

  it('TODO tipo do contrato tem traducao — nenhum cai no descarte', () => {
    const oneOfEach: Record<string, unknown>[] = [
      { id: 'a', type: 'paragraph', text: 't' },
      { id: 'b', type: 'heading', level: 2, text: 't' },
      { id: 'c', type: 'image', mediaRef: 'm', alt: 'a' },
      { id: 'd', type: 'video', provider: 'youtube' },
      { id: 'e', type: 'quote', text: 't' },
      { id: 'f', type: 'entityCard', entityKind: 'movie', entityId: 'x' },
      { id: 'g', type: 'factBox', title: 't', items: [{ label: 'l', value: 'v' }] },
      { id: 'h', type: 'relatedContent', articleRefs: ['x'] },
      { id: 'i', type: 'sourceList', sourceRefs: ['x'] },
      { id: 'j', type: 'divider' },
    ]
    // A fixture cobre a lista canonica inteira — se um tipo novo entrar no
    // contrato sem passar por aqui, esta assercao quebra primeiro.
    expect(oneOfEach.map((block) => block.type).sort()).toEqual([...EDITORIAL_BLOCK_TYPES].sort())

    const { blocks } = toPayloadBlocks(oneOfEach, resolveAll)
    expect(blocks).toHaveLength(oneOfEach.length)
    expect(blocks.map((block) => block.blockType).sort()).toEqual(
      [...EDITORIAL_BLOCK_TYPES].sort(),
    )
  })
})

describe('toPayloadBlocks — invariantes', () => {
  it('preserva a ORDEM', () => {
    const input = Array.from({ length: 12 }, (_, index) => ({
      id: `b${String(index)}`,
      type: 'paragraph',
      text: `t${String(index)}`,
    }))
    const { blocks } = toPayloadBlocks(input, resolveNone)
    expect(blocks.map((block) => block.blockId)).toEqual(input.map((block) => block.id))
  })

  it('NAO muta a entrada', () => {
    const input = [
      { id: 'b1', type: 'paragraph', text: 'Texto.' },
      { id: 'i1', type: 'image', mediaRef: 'cand-1', alt: 'Alt' },
    ]
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown
    toPayloadBlocks(input, resolveAll)
    expect(input).toEqual(snapshot)
  })

  it('nenhum bloco de saida carrega o vocabulario do contrato', () => {
    const { blocks } = toPayloadBlocks(
      [
        { id: 'b1', type: 'paragraph', text: 'Texto.' },
        { id: 'i1', type: 'image', mediaRef: 'cand-1', alt: 'Alt' },
      ],
      resolveAll,
    )
    for (const block of blocks) {
      expect(block).not.toHaveProperty('type')
      expect(block).not.toHaveProperty('id')
      expect(block).not.toHaveProperty('mediaRef')
      expect(block.blockType).toBeTruthy()
      expect(block.blockId).toBeTruthy()
    }
  })

  it('campos opcionais ausentes nao viram chave `undefined`', () => {
    const { blocks } = toPayloadBlocks(
      [{ id: 'i1', type: 'image', mediaRef: 'cand-1', alt: 'Alt' }],
      resolveAll,
    )
    expect(Object.keys(blocks[0] ?? {}).sort()).toEqual(
      ['alt', 'blockId', 'blockType', 'media'].sort(),
    )
  })

  it('tipo desconhecido: descartado com aviso, sem derrubar os demais', () => {
    const { blocks, warnings } = toPayloadBlocks(
      [
        { id: 'b1', type: 'paragraph', text: 'Fica.' },
        { id: 'x1', type: 'carousel', items: [] },
      ],
      resolveNone,
    )
    expect(blocks.map((block) => block.blockId)).toEqual(['b1'])
    expect(warnings.some((warning) => warning.includes('carousel'))).toBe(true)
  })

  it('bloco sem id e descartado com aviso — id estavel e obrigatorio', () => {
    const { blocks, warnings } = toPayloadBlocks(
      [{ type: 'paragraph', text: 'Sem id.' }],
      resolveNone,
    )
    expect(blocks).toEqual([])
    expect(warnings.some((warning) => warning.includes('sem id'))).toBe(true)
  })

  it('proveniencia que a collection nao guarda e reportada, nao some calada', () => {
    const { blocks, warnings } = toPayloadBlocks(
      [
        {
          id: 'h1',
          type: 'heading',
          level: 2,
          text: 'Titulo',
          provenance: [{ origin: 'external_source', ref: 'src-1' }],
        },
      ],
      resolveNone,
    )
    expect(blocks[0]).not.toHaveProperty('provenance')
    expect(warnings.some((warning) => warning.includes('h1'))).toBe(true)
  })

  it('entrada nao-objeto e ignorada sem quebrar', () => {
    const { blocks } = toPayloadBlocks([null, 'texto', 42, undefined], resolveNone)
    expect(blocks).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* O teste que prova que o teste pega o defeito                        */
/* ------------------------------------------------------------------ */

/**
 * A implementacao ANTIGA, reproduzida aqui de proposito.
 *
 * Era exatamente isto que o caminho de publicacao fazia (spread cego) e o que o
 * caminho de ingestao nem fazia (`body: draft.blocks` cru). Sem esta
 * reproducao, os testes acima passariam igual se alguem reintroduzisse o spread
 * amanha — eles provariam que o mapper novo funciona, nao que o antigo estava
 * errado.
 */
function legacySpreadMapper(blocks: readonly unknown[]): Record<string, unknown>[] {
  return blocks.map((raw) => {
    const { type, id, ...rest } = raw as Record<string, unknown> & { type: string; id: string }
    return { ...rest, blockType: type, blockId: id }
  })
}

describe('a implementacao antiga REALMENTE falha nas assercoes novas', () => {
  const sample = [
    { id: 'h1', type: 'heading', level: 2, text: 'Titulo' },
    { id: 'i1', type: 'image', mediaRef: 'cand-1', alt: 'Alt' },
  ]

  it('spread cego deixa heading.level como NUMERO (o ENUM da coluna e texto)', () => {
    expect(legacySpreadMapper(sample)[0]?.level).toBe(2)
    expect(toPayloadBlocks(sample, resolveAll).blocks[0]?.level).toBe('2')
  })

  it('spread cego mantem `mediaRef` e nunca produz `media`', () => {
    const legacy = legacySpreadMapper(sample)[1]
    expect(legacy?.mediaRef).toBe('cand-1')
    expect(legacy?.media).toBeUndefined()

    const fixed = toPayloadBlocks(sample, resolveAll).blocks.find(
      (block) => block.blockType === 'image',
    )
    expect(fixed?.media).toBe(42)
    expect(fixed?.mediaRef).toBeUndefined()
  })

  it('o corpo CRU do contrato nao tem blockType — e por isso o Payload o descarta', () => {
    // Este e o estado exato de `body: draft.blocks` antes da correcao.
    for (const block of sample) {
      expect((block as Record<string, unknown>).blockType).toBeUndefined()
    }
  })
})
