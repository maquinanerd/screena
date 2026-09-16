/**
 * Foto de GALERIA passa pelo mesmo portao de licenca que o bloco `image`.
 *
 * O portao do servidor (`hooks/articles.ts`) e a previsao da interface
 * (`admin/publish-gate-preview.ts`) contavam midia de capa, das "imagens de
 * apoio" e dos blocos `image` do corpo. As fotos dos blocos `gallery` ficavam de
 * fora dos dois: uma galeria com foto sem licenca publicava, e nem a barra do
 * editor nem o servidor avisavam.
 *
 * Isso ficou escondido enquanto a galeria morria no worker — nenhuma foto de
 * galeria chegava ao site. Com a galeria atravessando a cadeia, a unica recusa
 * restante seria a do worker, depois da publicacao e longe de quem publicou.
 */

import { describe, expect, it } from 'vitest'

import {
  bodyMediaIds,
  previewPublishGate,
  referencedMediaIds,
  type MediaFacts,
} from '../admin/publish-gate-preview.js'

const approved = (id: string): MediaFacts => ({
  id,
  licenseStatus: 'approved',
  allowedForEditorial: true,
  allowedForHero: true,
})

function publishableDoc(body: unknown[]): Record<string, unknown> {
  return {
    slug: 'bastidores-da-estreia',
    title: 'Bastidores da estreia',
    language: 'pt-BR',
    authors: [7],
    qaPassedAt: '2026-09-16T10:00:00.000Z',
    aiAssisted: false,
    externalSources: [{ sourceId: 's-1' }],
    blockingErrors: [],
    legalHold: false,
    heroMedia: 1,
    body,
  }
}

const gallery = (media: unknown[]) => ({
  blockType: 'gallery',
  blockId: 'g1',
  items: media.map((ref, index) => ({ media: ref, alt: `foto ${String(index)}` })),
})

describe('midia das fotos da galeria', () => {
  it('as fotos da galeria entram na conta, nas tres formas de relacao', () => {
    const body = [
      { blockType: 'paragraph', text: 'abertura' },
      gallery([11, { id: 12 }, '13']),
      { blockType: 'image', media: 9 },
    ]
    expect(bodyMediaIds(body)).toEqual(['11', '12', '13', '9'])
  })

  it('item sem relacao nao inventa id', () => {
    expect(bodyMediaIds([gallery([null, undefined, 14])])).toEqual(['14'])
  })

  it('a mesma foto na capa e na galeria conta uma vez', () => {
    const doc = publishableDoc([gallery([1, 2])])
    expect(referencedMediaIds(doc)).toEqual(['1', '2'])
  })
})

describe('a previsao recusa galeria com foto sem licenca', () => {
  it('CONTROLE POSITIVO: galeria toda licenciada publica', () => {
    const result = previewPublishGate({
      doc: publishableDoc([gallery([21, 22])]),
      authors: [{ id: '7', active: true }],
      media: [approved('1'), approved('21'), approved('22')],
      currentStatus: 'ready_to_publish',
    })
    expect(result.canPublish).toBe(true)
  })

  it('uma foto de galeria com licenca proibida bloqueia', () => {
    const result = previewPublishGate({
      doc: publishableDoc([gallery([21, 22])]),
      authors: [{ id: '7', active: true }],
      media: [approved('1'), approved('21'), { ...approved('22'), licenseStatus: 'prohibited' }],
      currentStatus: 'ready_to_publish',
    })
    expect(result.canPublish).toBe(false)
    expect(result.reasons).toContain('unauthorized_media')
  })

  it('foto de galeria que a interface nao conseguiu ler tambem bloqueia', () => {
    // Fail-closed, como o servidor: nao se publica apontando para o que nao se
    // consegue verificar.
    const result = previewPublishGate({
      doc: publishableDoc([gallery([21, 99])]),
      authors: [{ id: '7', active: true }],
      media: [approved('1'), approved('21')],
      currentStatus: 'ready_to_publish',
    })
    expect(result.reasons).toContain('unauthorized_media')
  })
})
