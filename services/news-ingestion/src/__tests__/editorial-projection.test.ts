/**
 * editorial-projection.test.ts — Decisao de projecao CMS -> banco publico.
 *
 * Cobre o que o banco sozinho nao consegue provar: replay, evento fora de
 * ordem, gate de licenca e o rebaixamento (nao apagamento) de materia
 * despublicada/retratada.
 */

import { describe, expect, it } from 'vitest'

import {
  blocksToPlainText,
  decideProjection,
  hasUncreditedMedia,
  isPublishedLocale,
  type ProjectionEvent,
  type ApprovedSeo,
} from '../editorial-projection.js'

const OCCURRED = '2026-07-28T12:00:00.000Z'
const PUBLISHED = '2026-07-28T11:00:00.000Z'

function event(overrides: Partial<ProjectionEvent> = {}): ProjectionEvent {
  return {
    eventId: 'evt-1',
    idempotencyKey: 'idem-1',
    eventType: 'article.published',
    payloadDocumentId: 'doc-1',
    emissionSequence: 2,
    language: 'pt-BR',
    occurredAtIso: OCCURRED,
    retractionReason: null,
    publishedContent: {
      title: 'Titulo da materia',
      subtitle: 'Linha fina',
      slug: 'titulo-da-materia',
      summary: 'Resumo editorial.',
      contentType: 'news',
      body: [
        { type: 'paragraph', id: 'b1', text: 'Primeiro paragrafo.' },
        { type: 'list', id: 'b2', items: ['um', 'dois'] },
      ],
      authorName: 'Redacao Cinerie',
      publishedAtIso: PUBLISHED,
      correctedAtIso: null,
      correctionNote: null,
      aiAssisted: false,
    },
    seo: approvedSeo({ metaTitle: 'Meta', metaDescription: 'Desc' }),
    provenance: { primarySourceName: null, primarySourceUrl: null },
    media: [],
    ...overrides,
  }
}

const base = { existingReceipt: null, existing: null, contentVersion: 'sha256:abc' }

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

describe('achatamento de blocos', () => {
  it('junta paragrafos e ITENS de lista', () => {
    // Sem os itens, uma materia toda em bullets teria corpo vazio e cairia no
    // gate de conteudo fino do render.
    const text = blocksToPlainText([
      { type: 'paragraph', id: 'a', text: 'Um.' },
      { type: 'list', id: 'b', items: ['dois', 'tres'] },
    ])
    expect(text).toContain('Um.')
    expect(text).toContain('dois')
    expect(text).toContain('tres')
  })

  it('ignora blocos sem texto sem produzir separadores vazios', () => {
    const text = blocksToPlainText([
      { type: 'embed', id: 'a', url: 'https://exemplo.test' },
      { type: 'paragraph', id: 'b', text: 'Unico.' },
    ])
    expect(text).toBe('Unico.')
  })
})

describe('gates puros', () => {
  it('pt-BR e publicado; en/es nao (invariante 7)', () => {
    expect(isPublishedLocale('pt-BR')).toBe(true)
    expect(isPublishedLocale('en')).toBe(false)
    expect(isPublishedLocale('es')).toBe(false)
  })

  it('detecta midia que exige atribuicao sem credito', () => {
    expect(hasUncreditedMedia([{ requiresAttribution: true, credit: null }])).toBe(true)
    expect(hasUncreditedMedia([{ requiresAttribution: true, credit: '   ' }])).toBe(true)
    expect(hasUncreditedMedia([{ requiresAttribution: true, credit: 'Divulgacao' }])).toBe(false)
    expect(hasUncreditedMedia([{ requiresAttribution: false, credit: null }])).toBe(false)
  })
})

describe('decisao de projecao', () => {
  it('publica materia pt-BR completa', () => {
    const decision = decideProjection({ ...base, event: event() })
    expect(decision.outcome).toBe('applied')
    expect(decision.article?.payloadDocumentId).toBe('doc-1')
    expect(decision.article?.projectedSequence).toBe(2)
    expect(decision.translation?.reviewStatus).toBe('published')
    expect(decision.translation?.indexStatus).toBe('index')
    expect(decision.translation?.slug).toBe('titulo-da-materia')
  })

  it('REPLAY: evento com recibo nao reaplica nada', () => {
    // Reaplicar um `article.updated` sobrescreveria uma edicao posterior com
    // conteudo velho.
    const decision = decideProjection({
      ...base,
      event: event(),
      existingReceipt: { outcome: 'applied' },
    })
    expect(decision.outcome).toBe('skipped_duplicate')
    expect(decision.article).toBeNull()
    expect(decision.translation).toBeNull()
  })

  it('FORA DE ORDEM: emissao menor ou igual nao reescreve o presente', () => {
    const existing = {
      articleId: '1',
      projectedSequence: 5,
      translationBodyBlocksVersion: 'sha256:antigo',
    }
    expect(
      decideProjection({ ...base, event: event({ emissionSequence: 4 }), existing }).outcome,
    ).toBe('skipped_stale')
    expect(
      decideProjection({ ...base, event: event({ emissionSequence: 5 }), existing }).outcome,
    ).toBe('skipped_stale')
    // Controle positivo: a emissao SEGUINTE aplica.
    expect(
      decideProjection({ ...base, event: event({ emissionSequence: 6 }), existing }).outcome,
    ).toBe('applied')
  })

  it('LICENCA: midia sem credito bloqueia a projecao (invariante 6)', () => {
    const decision = decideProjection({
      ...base,
      event: event({ media: [{ mediaId: 'm1', role: 'hero', requiresAttribution: true, credit: null }] }),
    })
    expect(decision.outcome).toBe('skipped_unlicensed')
    expect(decision.translation).toBeNull()
  })

  it('idioma fora de PUBLISHED_LOCALES projeta como draft/noindex, nao publica', () => {
    const decision = decideProjection({ ...base, event: event({ language: 'en' }) })
    expect(decision.outcome).toBe('applied')
    expect(decision.translation?.reviewStatus).toBe('draft')
    expect(decision.translation?.indexStatus).toBe('draft')
    expect(decision.warnings.join(' ')).toContain('PUBLISHED_LOCALES')
  })

  it('noindex declarado no SEO e respeitado mesmo em idioma publicado', () => {
    const decision = decideProjection({
      ...base,
      event: event({ seo: approvedSeo({ noindex: true }) }),
    })
    expect(decision.translation?.indexStatus).toBe('noindex')
  })

  it('despublicar REBAIXA, nao apaga: sem reescrever texto', () => {
    const decision = decideProjection({
      ...base,
      event: event({ eventType: 'article.unpublished', publishedContent: null, seo: null }),
    })
    expect(decision.outcome).toBe('applied')
    expect(decision.translation?.reviewStatus).toBe('archived')
    expect(decision.translation?.indexStatus).toBe('noindex')
    // Corpo e blocos vem nulos: a remocao nao toca o conteudo ja gravado.
    expect(decision.translation?.body).toBeNull()
    expect(decision.translation?.bodyBlocks).toBeNull()
  })

  it('retratar registra o MOTIVO — evidencia nao some', () => {
    const decision = decideProjection({
      ...base,
      event: event({
        eventType: 'article.retracted',
        publishedContent: null,
        seo: null,
        retractionReason: 'fato apurado incorretamente',
      }),
    })
    expect(decision.translation?.reviewStatus).toBe('blocked')
    expect(decision.translation?.correctionNote).toBe('fato apurado incorretamente')
    expect(decision.translation?.correctedAtIso).toBe(OCCURRED)
  })

  it('published sem conteudo e recusado, nao vira pagina vazia', () => {
    const decision = decideProjection({
      ...base,
      event: event({ publishedContent: null, seo: null }),
    })
    expect(decision.outcome).toBe('skipped_unlicensed')
  })

  it('blocos e versao andam juntos (CHECK do banco nao pode ser violado)', () => {
    const semVersao = decideProjection({ ...base, event: event(), contentVersion: null })
    expect(semVersao.translation?.bodyBlocks).toBeNull()
    expect(semVersao.translation?.bodyBlocksVersion).toBeNull()
    // Controle positivo: com versao, os dois vem preenchidos.
    const comVersao = decideProjection({ ...base, event: event() })
    expect(comVersao.translation?.bodyBlocks).toHaveLength(2)
    expect(comVersao.translation?.bodyBlocksVersion).toBe('sha256:abc')
  })

  it('capa pedida e NAO resolvida e avisada, nunca silenciosa', () => {
    // Uma materia que sai sem a foto que o editor escolheu, sem ninguem ser
    // avisado, e o defeito que a FASE 2D existe para fechar.
    const decision = decideProjection({
      ...base,
      event: event({
        media: [{ mediaId: 'm1', role: 'hero', requiresAttribution: false, credit: 'Divulgacao' }],
      }),
    })
    expect(decision.outcome).toBe('applied')
    expect(decision.article?.heroImagePath).toBeNull()
    expect(decision.warnings.join(' ')).toContain('capa m1 nao foi projetada')
  })

  it('capa RESOLVIDA vira caminho publico local, nunca URL', () => {
    const decision = decideProjection({
      ...base,
      event: event({
        media: [{ mediaId: 'm1', role: 'hero', requiresAttribution: false, credit: 'Divulgacao' }],
      }),
      media: new Map([
        [
          'm1',
          {
            mediaId: 'm1',
            publicPath: '/media/editorial/ab/' + 'a'.repeat(64) + '.jpg',
            contentHash: 'sha256:' + 'a'.repeat(64),
            mimeType: 'image/jpeg',
            width: 1200,
            height: 630,
            alt: 'capa',
            caption: null,
            credit: 'Divulgacao',
          },
        ],
      ]),
    })
    expect(decision.article?.heroImagePath).toBe('/media/editorial/ab/' + 'a'.repeat(64) + '.jpg')
    expect(decision.article?.heroImagePath).not.toMatch(/^https?:/)
    expect(decision.article?.heroMediaId).toBe('m1')
  })

  it('fonte externa declarada exige atribuicao e linkback', () => {
    const decision = decideProjection({
      ...base,
      event: event({
        provenance: { primarySourceName: 'Collider', primarySourceUrl: 'https://collider.test/x' },
      }),
    })
    expect(decision.article?.requiresAttribution).toBe(true)
    expect(decision.article?.requiresLinkback).toBe(true)
    expect(decision.article?.sourceName).toBe('Collider')
  })
})
