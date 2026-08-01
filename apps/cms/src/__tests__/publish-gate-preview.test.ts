/**
 * Testes da previsao do gate de publicacao.
 *
 * A previsao existe para dizer ao redator o que falta ANTES do clique. Se ela
 * discordar do servidor, ela e pior que inutil — manda resolver o que nao e
 * problema, ou promete uma publicacao que sera recusada. Por isso os testes
 * comparam a previsao com `evaluatePublishGate` alimentado pelos MESMOS fatos.
 */

import { describe, expect, it } from 'vitest'

import {
  bodyMediaIds,
  countUnauthorizedMedia,
  mediaIsAuthorized,
  previewPublishGate,
  referencedMediaIds,
  relationIds,
  type MediaFacts,
} from '../admin/publish-gate-preview.js'
import { evaluatePublishGate } from '../workflow.js'

const approved: MediaFacts = {
  id: '1',
  licenseStatus: 'approved',
  allowedForEditorial: true,
  allowedForHero: true,
}

/** Artigo minimo que PASSA no gate, para as variacoes partirem de um verde. */
function publishableDoc(): Record<string, unknown> {
  return {
    slug: 'estreia-da-temporada',
    title: 'Estreia da temporada',
    language: 'pt-BR',
    authors: [7],
    qaPassedAt: '2026-08-01T10:00:00.000Z',
    aiAssisted: false,
    externalSources: [{ sourceId: 's-1' }],
    blockingErrors: [],
    legalHold: false,
    heroMedia: 1,
  }
}

const activeAuthor = [{ id: '7', active: true }]

describe('extracao de referencias', () => {
  it('aceita as tres formas de relacao do Payload', () => {
    expect(relationIds(3)).toEqual(['3'])
    expect(relationIds('3')).toEqual(['3'])
    expect(relationIds({ id: 3 })).toEqual(['3'])
    expect(relationIds([{ id: 3 }, 4, '5'])).toEqual(['3', '4', '5'])
  })

  it('descarta vazio e sentinelas', () => {
    expect(relationIds(null)).toEqual([])
    expect(relationIds(undefined)).toEqual([])
    expect(relationIds([null, undefined, ''])).toEqual([])
  })

  it('acha midia nos blocos de imagem do corpo e ignora os demais blocos', () => {
    const body = [
      { blockType: 'paragraph', text: 'abertura' },
      { blockType: 'image', media: 9 },
      { blockType: 'divider' },
      { blockType: 'image', media: { id: 10 } },
    ]
    expect(bodyMediaIds(body)).toEqual(['9', '10'])
  })

  it('nao repete a mesma midia usada em capa e corpo', () => {
    const doc = { heroMedia: 1, gallery: [1, 2], body: [{ blockType: 'image', media: 1 }] }
    expect(referencedMediaIds(doc)).toEqual(['1', '2'])
  })
})

describe('autorizacao de midia — fail-closed como o servidor', () => {
  it('so publica com licenca aprovada E permissao editorial', () => {
    expect(mediaIsAuthorized(approved, false)).toBe(true)
    expect(mediaIsAuthorized({ ...approved, licenseStatus: 'pending' }, false)).toBe(false)
    expect(mediaIsAuthorized({ ...approved, allowedForEditorial: false }, false)).toBe(false)
  })

  it('capa exige a permissao extra', () => {
    const noHero = { ...approved, allowedForHero: false }
    expect(mediaIsAuthorized(noHero, false)).toBe(true)
    expect(mediaIsAuthorized(noHero, true)).toBe(false)
  })

  it('midia referenciada que nao foi lida conta como NAO autorizada', () => {
    // A leitura nao trouxe o id 99: nao se publica apontando para o que nao se
    // conseguiu verificar.
    expect(countUnauthorizedMedia({ heroMedia: 99 }, [])).toBe(1)
  })

  it('conta midia proibida do corpo, nao so a capa', () => {
    const doc = { heroMedia: 1, body: [{ blockType: 'image', media: 2 }] }
    const media: MediaFacts[] = [
      approved,
      { id: '2', licenseStatus: 'prohibited', allowedForEditorial: false, allowedForHero: false },
    ]
    expect(countUnauthorizedMedia(doc, media)).toBe(1)
  })
})

describe('a previsao concorda com o gate do servidor', () => {
  it('documento completo: nenhum motivo', () => {
    const result = previewPublishGate({
      doc: publishableDoc(),
      authors: activeAuthor,
      media: [approved],
      currentStatus: 'ready_to_publish',
    })
    expect(result.canPublish).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('estado errado aparece como not_ready_to_publish', () => {
    const result = previewPublishGate({
      doc: publishableDoc(),
      authors: activeAuthor,
      media: [approved],
      currentStatus: 'draft',
    })
    expect(result.reasons).toContain('not_ready_to_publish')
  })

  it('autor INATIVO nao conta — mesma regra do servidor', () => {
    const result = previewPublishGate({
      doc: publishableDoc(),
      authors: [{ id: '7', active: false }],
      media: [approved],
      currentStatus: 'ready_to_publish',
    })
    expect(result.reasons).toContain('missing_active_author')
  })

  it('IA sem fonte bloqueia; com fonte, nao', () => {
    const withoutSources = previewPublishGate({
      doc: { ...publishableDoc(), aiAssisted: true, externalSources: [] },
      authors: activeAuthor,
      media: [approved],
      currentStatus: 'ready_to_publish',
    })
    expect(withoutSources.reasons).toContain('ai_assisted_without_sources')

    const withSources = previewPublishGate({
      doc: { ...publishableDoc(), aiAssisted: true },
      authors: activeAuthor,
      media: [approved],
      currentStatus: 'ready_to_publish',
    })
    expect(withSources.canPublish).toBe(true)
  })

  it('capa sem permissao de hero bloqueia', () => {
    const result = previewPublishGate({
      doc: publishableDoc(),
      authors: activeAuthor,
      media: [{ ...approved, allowedForHero: false }],
      currentStatus: 'ready_to_publish',
    })
    expect(result.reasons).toContain('unauthorized_media')
  })

  it('cada motivo previsto e um motivo que o servidor tambem daria', () => {
    const doc = {
      ...publishableDoc(),
      slug: '',
      title: '',
      language: '',
      qaPassedAt: null,
      legalHold: true,
      blockingErrors: ['x'],
    }
    const preview = previewPublishGate({
      doc,
      authors: [],
      media: [],
      currentStatus: 'draft',
    })
    // Mesma entrada, montada a mao, direto no avaliador do servidor.
    const server = evaluatePublishGate({
      workflowStatus: 'draft',
      slug: '',
      title: '',
      language: '',
      activeAuthorCount: 0,
      blockingErrors: ['x'],
      qaPassedAt: null,
      aiAssisted: false,
      externalSourceCount: 1,
      unauthorizedMediaCount: 1,
      legalHold: true,
    })
    expect([...preview.reasons].sort()).toEqual([...server.reasons].sort())
  })
})
