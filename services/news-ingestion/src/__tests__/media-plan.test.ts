/**
 * media-plan.test.ts — O que um evento pede de midia, e o que sobra nos blocos.
 *
 * O ponto sob teste que mais importa: o plano NUNCA sai de uma URL. O contrato
 * carrega `media[].url`, e segui-la significaria buscar bytes num host que o
 * worker nao controla, com a credencial dele no bolso.
 */

import { describe, expect, it } from 'vitest'

import type { ApprovedSeo, ProjectionBlock, ProjectionEvent } from '../editorial-projection.js'
import {
  applyMediaToBlocks,
  isAllowedVideoBlock,
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
    height: 630,
    alt: 'alt do asset',
    caption: 'legenda do asset',
    credit: 'Divulgacao',
  }
}

function event(overrides: Partial<ProjectionEvent> = {}): ProjectionEvent {
  return {
    eventId: 'evt-1',
    idempotencyKey: 'idem-1',
    eventType: 'article.published',
    payloadDocumentId: 'doc-1',
    emissionSequence: 1,
    language: 'pt-BR',
    occurredAtIso: '2026-07-29T12:00:00.000Z',
    retractionReason: null,
    publishedContent: {
      title: 'Titulo',
      subtitle: null,
      slug: 'titulo',
      summary: 'Resumo.',
      contentType: 'news',
      body: [],
      authorName: 'Redacao',
      publishedAtIso: '2026-07-29T11:00:00.000Z',
      correctedAtIso: null,
      correctionNote: null,
      aiAssisted: false,
    },
    seo: approvedSeo(),
    provenance: { primarySourceName: null, primarySourceUrl: null },
    media: [],
    ...overrides,
  }
}

function imageBlock(id: string, mediaRef: string | null): ProjectionBlock {
  return {
    type: 'image',
    id,
    ...(mediaRef === null ? {} : { mediaRef }),
    alt: `alt ${id}`,
    caption: `legenda ${id}`,
  }
}

/**
 * SEO aprovado com os campos opcionais zerados.
 *
 * Existe para o teste declarar SO o que ele mede. Sem isso, cada cenario
 * precisaria repetir dez campos irrelevantes, e um campo novo no contrato
 * quebraria todos os testes em vez de um.
 */
function approvedSeo(overrides: Partial<ApprovedSeo> = {}): ApprovedSeo {
  return {
    metaTitle: null,
    metaDescription: null,
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
    ...overrides,
  }
}

describe('plano de midia', () => {
  it('pede a capa com finalidade `hero`, pelo ID — nunca pela URL', () => {
    const plan = planEventMedia(
      event({ media: [{ mediaId: 'm-hero', role: 'hero', requiresAttribution: false, credit: 'x' }] }),
    )
    expect(plan.requests).toHaveLength(1)
    expect(plan.requests[0]).toEqual({
      mediaId: 'm-hero',
      purpose: 'hero',
      usage: 'hero',
      required: true,
    })
  })

  it('pede cada bloco de imagem com finalidade `editorial`', () => {
    const plan = planEventMedia(
      event({
        publishedContent: {
          ...event().publishedContent!,
          body: [imageBlock('b1', 'm-1'), { type: 'paragraph', id: 'b2', text: 'oi' }, imageBlock('b3', 'm-2')],
        },
      }),
    )
    expect(plan.requests.map((request) => request.mediaId)).toEqual(['m-1', 'm-2'])
    expect(plan.requests.every((request) => request.purpose === 'editorial')).toBe(true)
    // Bloco de imagem e OBRIGATORIO: uma legenda orfa no meio do texto e pior
    // que uma publicacao recusada.
    expect(plan.requests.every((request) => request.required)).toBe(true)
  })

  it('nao baixa a mesma midia duas vezes na mesma finalidade', () => {
    const plan = planEventMedia(
      event({
        publishedContent: {
          ...event().publishedContent!,
          body: [imageBlock('b1', 'm-1'), imageBlock('b2', 'm-1')],
        },
      }),
    )
    expect(plan.requests).toHaveLength(1)
  })

  it('registra bloco de imagem SEM mediaRef em vez de ignorar', () => {
    const plan = planEventMedia(
      event({
        publishedContent: { ...event().publishedContent!, body: [imageBlock('b-quebrado', null)] },
      }),
    )
    expect(plan.requests).toHaveLength(0)
    expect(plan.malformedBlockIds).toEqual(['b-quebrado'])
  })

  it('midia que nao e hero nao entra no plano como capa', () => {
    const plan = planEventMedia(
      event({
        media: [{ mediaId: 'm-galeria', role: 'gallery', requiresAttribution: false, credit: 'x' }],
      }),
    )
    expect(plan.requests).toHaveLength(0)
  })
})

describe('aplicacao aos blocos', () => {
  it('troca mediaRef pelo caminho publico, preservando id, ordem e texto', () => {
    const blocks = [
      imageBlock('b1', 'm-1'),
      { type: 'paragraph', id: 'b2', text: 'entre as imagens' } as ProjectionBlock,
      imageBlock('b3', 'm-2'),
    ]
    const { blocks: projected, unresolved } = applyMediaToBlocks(
      blocks,
      new Map([
        ['m-1', asset('m-1')],
        ['m-2', asset('m-2')],
      ]),
    )
    expect(unresolved).toEqual([])
    expect(projected.map((block) => block.id)).toEqual(['b1', 'b2', 'b3'])
    expect(projected[0]?.publicPath).toBe('/media/editorial/aa/m-1.jpg')
    // O id interno do CMS sai do corpo publico: nao serve para nada no render e
    // e vazamento de identificador.
    expect(projected[0]?.mediaRef).toBeUndefined()
    expect(projected[0]?.alt).toBe('alt b1')
    expect(projected[1]).toEqual(blocks[1])
  })

  it('usa alt/legenda do ASSET quando o bloco nao tem os seus', () => {
    const { blocks } = applyMediaToBlocks(
      [{ type: 'image', id: 'b1', mediaRef: 'm-1' }],
      new Map([['m-1', asset('m-1')]]),
    )
    expect(blocks[0]?.alt).toBe('alt do asset')
    expect(blocks[0]?.caption).toBe('legenda do asset')
    expect(blocks[0]?.credit).toBe('Divulgacao')
  })

  it('bloco sem asset resolvido e REPORTADO, nao silenciado', () => {
    const { unresolved } = applyMediaToBlocks([imageBlock('b1', 'm-ausente')], new Map())
    expect(unresolved).toEqual(['b1'])
  })
})

describe('blocos de video', () => {
  it('aceita apenas providers declarados', () => {
    expect(isAllowedVideoBlock({ type: 'video', id: 'v1', provider: 'youtube' })).toBe(true)
    expect(isAllowedVideoBlock({ type: 'video', id: 'v2', provider: 'vimeo' })).toBe(true)
    expect(isAllowedVideoBlock({ type: 'video', id: 'v3', provider: 'internal' })).toBe(true)
  })

  it('recusa video sem provider — embed livre e execucao de terceiro', () => {
    expect(isAllowedVideoBlock({ type: 'video', id: 'v4' })).toBe(false)
    expect(isAllowedVideoBlock({ type: 'video', id: 'v5', provider: 'html' })).toBe(false)
  })

  it('nao interfere em blocos que nao sao video', () => {
    expect(isAllowedVideoBlock({ type: 'paragraph', id: 'p1', text: 'x' })).toBe(true)
  })
})
