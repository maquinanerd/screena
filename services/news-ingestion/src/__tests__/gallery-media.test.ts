/**
 * A GALERIA ATRAVESSA O WORKER — ela morria no salto 4.
 *
 * O bloco `gallery` existe no CMS (`apps/cms/src/publication.ts`), e valido no
 * contrato (`galleryBlock` em `publishedEditorialBlock`) e e desenhado pelo site
 * (`article-body-presenter.ts`). Mas o worker so conhecia `image` e `hero`:
 *
 *  - `planEventMedia` nao pedia a midia dos itens, entao nenhum byte era baixado;
 *  - `applyMediaToBlocks` devolvia o bloco INTACTO — com o id interno do CMS em
 *    cada item e sem `publicPath` —, e nem o registrava em `unresolved`;
 *  - o presenter do site descarta item sem caminho local; sem nenhum item, a
 *    galeria inteira vira `null`.
 *
 * Resultado: a galeria publicada sumia da pagina, com 200, sem erro e sem uma
 * linha de log. Aceita no contrato, gravada no CMS, morta no worker.
 */

import { describe, expect, it } from 'vitest'

import {
  decideProjection,
  type ApprovedSeo,
  type ProjectionBlock,
  type ProjectionEvent,
} from '../editorial-projection.js'
import {
  applyMediaToBlocks,
  planEventMedia,
  type ResolvedMediaAsset,
} from '../media/media-plan.js'

function asset(mediaId: string): ResolvedMediaAsset {
  return {
    mediaId,
    publicPath: `/media/editorial/aa/${mediaId}.jpg`,
    contentHash: `sha256:${'a'.repeat(64)}`,
    mimeType: 'image/jpeg',
    width: 1200,
    height: 800,
    alt: 'alt do acervo',
    caption: 'legenda do acervo',
    credit: 'Credito do acervo',
  }
}

function approvedSeo(): ApprovedSeo {
  return {
    metaTitle: 'Meta',
    metaDescription: 'Desc',
    noindex: false,
    socialTitle: null,
    socialDescription: null,
    canonicalOverride: null,
    focusKeyphrase: null,
    relatedKeyphrases: [],
    editorialKeywords: [],
    schemaTypeRecommendation: null,
    articleSection: null,
    approvedImageAlt: [],
    approvedInternalLinks: [],
  }
}

function eventWithBody(body: ProjectionBlock[]): ProjectionEvent {
  return {
    eventId: 'evt-galeria',
    idempotencyKey: 'idem-galeria',
    eventType: 'article.published',
    payloadDocumentId: 'doc-galeria',
    emissionSequence: 7,
    language: 'pt-BR',
    occurredAtIso: '2026-09-16T12:00:00.000Z',
    retractionReason: null,
    publishedContent: {
      title: 'Bastidores da estreia',
      subtitle: null,
      slug: 'bastidores-da-estreia',
      summary: 'Resumo.',
      contentType: 'news',
      body,
      authorName: 'Redacao',
      publishedAtIso: '2026-09-16T11:00:00.000Z',
      correctedAtIso: null,
      correctionNote: null,
      aiAssisted: false,
    },
    seo: approvedSeo(),
    provenance: { primarySourceName: null, primarySourceUrl: null, externalSources: [] },
    media: [],
    entities: [],
  } as ProjectionEvent
}

/** A forma que o CMS emite em `publication.ts` — a do CONTRATO, nao a do site. */
const gallery: ProjectionBlock = {
  id: 'g1',
  type: 'gallery',
  items: [
    { mediaRef: '41', alt: 'Elenco no tapete vermelho', credit: 'Foto A' },
    { mediaRef: '42', alt: 'Diretora na coletiva' },
    { mediaRef: '43', alt: 'Plateia', caption: 'Sessao de gala' },
  ],
  initialIndex: 1,
} as ProjectionBlock

describe('plano de midia da galeria', () => {
  it('pede a midia de CADA item da galeria', () => {
    const plan = planEventMedia(eventWithBody([gallery]))
    const ids = plan.requests.map((request) => request.mediaId)
    expect(ids).toEqual(['41', '42', '43'])
  })

  it('item de galeria e OPCIONAL: uma foto ruim nao recusa a materia inteira', () => {
    // O site ja trata a galeria com "fallback por imagem" — uma imagem sem
    // caminho nao derruba as outras. Exigir aqui recusaria a publicacao
    // inteira por uma foto em dez, o oposto da politica de exibicao.
    const plan = planEventMedia(eventWithBody([gallery]))
    // Sem esta linha o laco abaixo passa VAZIO quando nada e planejado — e foi
    // exatamente assim que ele passou antes da correcao.
    expect(plan.requests).toHaveLength(3)
    for (const request of plan.requests) {
      expect(request.required).toBe(false)
      expect(request.purpose).toBe('editorial')
    }
  })

  it('a mesma foto na galeria e num bloco `image` e UM download so', () => {
    const plan = planEventMedia(
      eventWithBody([
        { id: 'i1', type: 'image', mediaRef: '41', alt: 'Elenco' } as ProjectionBlock,
        gallery,
      ]),
    )
    const for41 = plan.requests.filter((request) => request.mediaId === '41')
    expect(for41).toHaveLength(1)
    // O bloco `image` exige; prevalece o pedido mais forte.
    expect(for41[0]?.required).toBe(true)
  })
})

describe('aplicacao da midia na galeria', () => {
  const assets = new Map([
    ['41', asset('41')],
    ['42', asset('42')],
    ['43', asset('43')],
  ])

  it('cada item ganha caminho publico e dimensoes', () => {
    const { blocks, unresolved } = applyMediaToBlocks([gallery], assets)
    const items = (blocks[0] as unknown as { items: Record<string, unknown>[] }).items
    expect(items).toHaveLength(3)
    expect(items[0]?.publicPath).toBe('/media/editorial/aa/41.jpg')
    expect(items[0]?.width).toBe(1200)
    expect(items[0]?.height).toBe(800)
    expect(unresolved).toEqual([])
  })

  it('o id interno do CMS NAO sai no corpo publico', () => {
    const { blocks } = applyMediaToBlocks([gallery], assets)
    const items = (blocks[0] as unknown as { items: Record<string, unknown>[] }).items
    for (const item of items) expect(item).not.toHaveProperty('mediaRef')
  })

  it('credito e legenda sao POR FOTO: o do item vence o do acervo', () => {
    const { blocks } = applyMediaToBlocks([gallery], assets)
    const items = (blocks[0] as unknown as { items: Record<string, unknown>[] }).items
    expect(items[0]?.credit).toBe('Foto A')
    expect(items[0]?.alt).toBe('Elenco no tapete vermelho')
    // Sem credito proprio, herda o do acervo — credito nunca some.
    expect(items[1]?.credit).toBe('Credito do acervo')
    expect(items[2]?.caption).toBe('Sessao de gala')
  })

  it('preserva a ordem e o indice de abertura', () => {
    const { blocks } = applyMediaToBlocks([gallery], assets)
    const block = blocks[0] as unknown as { id: string; items: { alt: string }[]; initialIndex?: number }
    expect(block.id).toBe('g1')
    expect(block.items.map((item) => item.alt)).toEqual([
      'Elenco no tapete vermelho',
      'Diretora na coletiva',
      'Plateia',
    ])
    expect(block.initialIndex).toBe(1)
  })

  it('item sem asset SAI do bloco e e REPORTADO — nao some calado', () => {
    const partial = new Map([
      ['41', asset('41')],
      ['43', asset('43')],
    ])
    const { blocks, unresolved } = applyMediaToBlocks([gallery], partial)
    const items = (blocks[0] as unknown as { items: Record<string, unknown>[] }).items
    expect(items.map((item) => item.publicPath)).toEqual([
      '/media/editorial/aa/41.jpg',
      '/media/editorial/aa/43.jpg',
    ])
    expect(unresolved).toEqual(['g1#1'])
  })

  it('o indice de abertura acompanha o item, nao a posicao antiga', () => {
    // Abrir na 2a foto (indice 1). Se a 1a cair, a 2a vira indice 0.
    const partial = new Map([
      ['42', asset('42')],
      ['43', asset('43')],
    ])
    const { blocks } = applyMediaToBlocks([gallery], partial)
    const block = blocks[0] as unknown as { items: { alt: string }[]; initialIndex?: number }
    expect(block.items[block.initialIndex ?? 0]?.alt).toBe('Diretora na coletiva')
  })

  it('galeria SEM NENHUM asset sai do corpo e todos os itens sao reportados', () => {
    const { blocks, unresolved } = applyMediaToBlocks(
      [{ id: 'p1', type: 'paragraph', text: 'Antes.' } as ProjectionBlock, gallery],
      new Map(),
    )
    expect(blocks.map((block) => block.type)).toEqual(['paragraph'])
    expect(unresolved).toEqual(['g1#0', 'g1#1', 'g1#2'])
  })
})

describe('galeria ate a decisao de projecao', () => {
  it('a traducao gravada leva a galeria com caminhos publicos', () => {
    const decision = decideProjection({
      event: eventWithBody([gallery]),
      existingReceipt: null,
      existing: null,
      contentVersion: 'sha256:abc',
      media: new Map([
        ['41', asset('41')],
        ['42', asset('42')],
        ['43', asset('43')],
      ]),
    })
    expect(decision.outcome).toBe('applied')
    const stored = decision.translation?.bodyBlocks as unknown as { type: string; items?: { publicPath?: string }[] }[]
    const storedGallery = stored.find((block) => block.type === 'gallery')
    expect(storedGallery?.items?.every((item) => typeof item.publicPath === 'string')).toBe(true)
  })

  it('foto de galeria que nao projetou vira AVISO do worker', () => {
    const decision = decideProjection({
      event: eventWithBody([gallery]),
      existingReceipt: null,
      existing: null,
      contentVersion: 'sha256:abc',
      media: new Map([['41', asset('41')]]),
    })
    expect(decision.warnings.join(' | ')).toContain('g1#1')
    expect(decision.warnings.join(' | ')).toContain('g1#2')
  })
})
