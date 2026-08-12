/**
 * PROVA PONTA A PONTA da despublicacao, contra PostgreSQL 16 REAL:
 * publica (pelo MESMO caminho do worker de projecao), despublica (pelo
 * adapter da emergencia) e o artigo SAI do site — provado com o MESMO gate de
 * render da pagina e com a MESMA condicao do sitemap de noticias.
 *
 * O caso real que motivou tudo: article 41 apagado no admin do Payload e
 * servido para sempre pelo lado publico. O caminho de emergencia precisa
 * funcionar SEM documento no CMS — por isso ele age direto no banco publico.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyProjectionEvent } from '../persistence/editorial-projection-store.js'
import { unpublishArticle } from '../persistence/unpublish-store.js'
import type { ProjectionEvent } from '../editorial-projection.js'
import { startScreenDbHarness, type ScreenDbHarness } from './screen-db-harness.js'

let harness: ScreenDbHarness

const OCCURRED = '2026-08-11T12:00:00.000Z'
const PUBLISHED = '2026-08-11T11:00:00.000Z'
const NOW = '2026-08-12T09:00:00.000Z'

function publishedEvent(documentId: string, sequence: number): ProjectionEvent {
  return {
    eventId: `evt-${documentId}-pub`,
    idempotencyKey: `idem-${documentId}-pub`,
    eventType: 'article.published',
    payloadDocumentId: documentId,
    emissionSequence: sequence,
    language: 'pt-BR',
    occurredAtIso: OCCURRED,
    retractionReason: null,
    publishedContent: {
      title: 'Materia de prova da despublicacao',
      subtitle: null,
      slug: `prova-unpublish-${documentId}`,
      summary: 'Resumo editorial proprio da materia de prova.',
      contentType: 'news',
      body: [{ type: 'paragraph', id: 'b1', text: 'Paragrafo unico da materia de prova.' }],
      authorName: 'Redacao Cinerie',
      publishedAtIso: PUBLISHED,
      correctedAtIso: null,
      correctionNote: null,
      aiAssisted: false,
    },
    seo: {
      metaTitle: 'Materia de prova',
      metaDescription: 'Materia de prova da despublicacao de emergencia.',
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
    },
    provenance: { primarySourceName: null, primarySourceUrl: null, externalSources: [] },
    media: [],
    entities: [],
  } as ProjectionEvent
}

/** A MESMA condicao do sitemap de noticias (news-sitemap.ts): entra no sitemap? */
async function inNewsSitemap(articleId: bigint): Promise<boolean> {
  const rows = await harness.prisma.articleTranslation.findMany({
    where: {
      articleId,
      reviewStatus: { in: ['human_reviewed', 'published'] },
      indexStatus: 'index',
    },
    select: { id: true },
  })
  return rows.length > 0
}

async function publishArticle(documentId: string, sequence: number): Promise<bigint> {
  const result = await applyProjectionEvent(harness.prisma, {
    event: publishedEvent(documentId, sequence),
    contentVersion: `sha256:${documentId}`,
    workerId: 'worker-teste',
  })
  expect(result.outcome).toBe('applied')
  const article = await harness.prisma.article.findUnique({
    where: { payloadDocumentId: documentId },
    select: { id: true },
  })
  expect(article).not.toBeNull()
  return article!.id
}

beforeAll(async () => {
  harness = await startScreenDbHarness()
}, 600_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

describe('despublicacao de emergencia ponta a ponta (banco real)', () => {
  it('publica -> despublica -> o artigo sai do site (gate de render + sitemap)', async () => {
    const articleId = await publishArticle('doc-unpub-a', 10)

    // NO AR: gate de render aceita e o sitemap lista.
    const live = await unpublishArticle(harness.prisma, {
      articleId,
      mode: 'archived',
      apply: false,
      nowIso: NOW,
    })
    expect(live.outcome).toBe('planned')
    if (live.outcome !== 'planned') throw new Error('inesperado')
    expect(live.before.every((t) => t.renderable)).toBe(true)
    expect(await inNewsSitemap(articleId)).toBe(true)

    // DESPUBLICA de verdade.
    const demoted = await unpublishArticle(harness.prisma, {
      articleId,
      mode: 'archived',
      apply: true,
      nowIso: NOW,
    })
    expect(demoted.outcome).toBe('demoted')
    if (demoted.outcome !== 'demoted') throw new Error('inesperado')
    expect(demoted.updatedCount).toBe(demoted.plannedCount)
    expect(demoted.stillRenderable).toBe(0)
    expect(demoted.after.every((t) => t.reviewStatus === 'archived')).toBe(true)
    expect(demoted.after.every((t) => t.indexStatus === 'noindex')).toBe(true)

    // FORA DO SITE: gate de render nega (pagina 404) e o sitemap nao lista.
    expect(demoted.after.every((t) => !t.renderable)).toBe(true)
    expect(await inNewsSitemap(articleId)).toBe(false)

    // Superficie derivada: a busca nao guarda mais o documento do artigo.
    const searchDocs = await harness.prisma.searchDocument.count({
      where: { docKind: 'article', articleId },
    })
    expect(searchDocs).toBe(0)
  })

  it('e idempotente: a segunda execucao e no-op explicito, nunca erro', async () => {
    const articleId = await publishArticle('doc-unpub-b', 11)
    const first = await unpublishArticle(harness.prisma, {
      articleId,
      mode: 'archived',
      apply: true,
      nowIso: NOW,
    })
    expect(first.outcome).toBe('demoted')

    const second = await unpublishArticle(harness.prisma, {
      articleId,
      mode: 'archived',
      apply: true,
      nowIso: NOW,
    })
    expect(second.outcome).toBe('noop')
  })

  it('modo blocked (retratacao) usa o vocabulario da retratacao', async () => {
    const articleId = await publishArticle('doc-unpub-c', 12)
    const result = await unpublishArticle(harness.prisma, {
      articleId,
      mode: 'blocked',
      apply: true,
      nowIso: NOW,
    })
    expect(result.outcome).toBe('demoted')
    if (result.outcome !== 'demoted') throw new Error('inesperado')
    expect(result.after.every((t) => t.reviewStatus === 'blocked')).toBe(true)
  })

  it('artigo inexistente GRITA (article_not_found), nunca sucesso vazio', async () => {
    const result = await unpublishArticle(harness.prisma, {
      articleId: 999_999n,
      mode: 'archived',
      apply: true,
      nowIso: NOW,
    })
    expect(result.outcome).toBe('article_not_found')
  })

  it('dry-run NAO escreve nada', async () => {
    const articleId = await publishArticle('doc-unpub-d', 13)
    const dry = await unpublishArticle(harness.prisma, {
      articleId,
      mode: 'archived',
      apply: false,
      nowIso: NOW,
    })
    expect(dry.outcome).toBe('planned')
    const rows = await harness.prisma.articleTranslation.findMany({
      where: { articleId },
      select: { reviewStatus: true },
    })
    expect(rows.every((r) => String(r.reviewStatus) === 'published')).toBe(true)
  })
})
