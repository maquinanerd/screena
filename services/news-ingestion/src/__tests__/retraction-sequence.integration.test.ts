/**
 * A retratacao contra BANCO REAL: a sequencia anda, e retirada sem materia nao
 * vira recibo.
 *
 * O teste puro irmao (`retraction-sequence.test.ts`) prova a DECISAO. Este aqui
 * prova a ESCRITA — e os dois defeitos moravam justamente na escrita:
 *
 *  1. `projected_sequence` so era gravada dentro do `if (decision.article !==
 *     null)`, e o ramo de remocao devolve `article: null`. A decisao podia
 *     dizer "avance para 50" o quanto quisesse; ninguem gravava.
 *  2. Retirada de uma materia que nao existe no banco publico nao escrevia
 *     nada e MESMO ASSIM gravava recibo `applied` com `article_id NULL`. O
 *     recibo e a trava de replay: a retratacao ficava "aplicada" para sempre
 *     sem nunca ter sido aplicada, e o evento nunca mais voltava.
 *
 * Um PostgreSQL 16 efemero, sem CMS: os eventos sao montados a mao porque o que
 * esta sob teste e a projecao, nao o transporte.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyProjectionEvent } from '../persistence/editorial-projection-store.js'
import type { ProjectionEvent } from '../editorial-projection.js'
import { startScreenDbHarness, type ScreenDbHarness } from './screen-db-harness.js'

let harness: ScreenDbHarness

const OCCURRED = '2026-08-06T12:00:00.000Z'
const PUBLISHED = '2026-08-06T11:00:00.000Z'

function event(overrides: Partial<ProjectionEvent> = {}): ProjectionEvent {
  // A SLUG SAI DO DOCUMENTO. `article_translations` tem unique por
  // (slug, language_code): fixtures com a mesma slug colidiriam entre cenarios
  // e o teste mediria a colisao em vez do que declara medir.
  const documentId = String(overrides.payloadDocumentId ?? 'doc-base')
  return {
    eventId: 'evt-base',
    idempotencyKey: 'idem-base',
    eventType: 'article.published',
    payloadDocumentId: 'doc-base',
    emissionSequence: 30,
    language: 'pt-BR',
    occurredAtIso: OCCURRED,
    retractionReason: null,
    publishedContent: {
      title: 'Estudio confirma data de estreia',
      subtitle: null,
      slug: `estreia-${documentId}`,
      summary: 'Resumo editorial da materia.',
      contentType: 'news',
      body: [{ type: 'paragraph', id: 'b1', text: 'Primeiro paragrafo da materia.' }],
      authorName: 'Redacao Cinerie',
      publishedAtIso: PUBLISHED,
      correctedAtIso: null,
      correctionNote: null,
      aiAssisted: false,
    },
    seo: {
      metaTitle: 'Estudio confirma data de estreia',
      metaDescription: 'O estudio confirmou a data de estreia da nova serie.',
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
    ...overrides,
  } as ProjectionEvent
}

async function project(evt: ProjectionEvent) {
  return applyProjectionEvent(harness.prisma, {
    event: evt,
    contentVersion: `sha256:${evt.eventId}`,
    workerId: 'worker-teste',
  })
}

async function articleFor(payloadDocumentId: string) {
  return harness.prisma.article.findUnique({
    where: { payloadDocumentId },
    select: { id: true, projectedSequence: true },
  })
}

async function receiptFor(eventId: string) {
  return harness.prisma.editorialProjectionReceipt.findUnique({
    where: { eventId },
    select: { outcome: true, articleId: true },
  })
}

beforeAll(async () => {
  harness = await startScreenDbHarness()
}, 600_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

describe('sequencia projetada gravada de fato', () => {
  it('CONTROLE POSITIVO: publicacao grava a sequencia', async () => {
    const result = await project(
      event({ eventId: 'evt-pub-1', payloadDocumentId: 'doc-a', emissionSequence: 30 }),
    )
    expect(result.outcome).toBe('applied')
    expect((await articleFor('doc-a'))?.projectedSequence).toBe(30)
  })

  it('RETRATACAO grava a sequencia mesmo sem escrever artigo', async () => {
    await project(event({ eventId: 'evt-pub-2', payloadDocumentId: 'doc-b', emissionSequence: 30 }))
    expect((await articleFor('doc-b'))?.projectedSequence).toBe(30)

    const retract = await project(
      event({
        eventId: 'evt-ret-2',
        payloadDocumentId: 'doc-b',
        eventType: 'article.retracted',
        emissionSequence: 50,
        publishedContent: null,
        seo: null,
        retractionReason: 'fato apurado incorretamente',
      }),
    )
    expect(retract.outcome).toBe('applied')
    // AQUI estava o defeito: ficava 30.
    expect((await articleFor('doc-b'))?.projectedSequence).toBe(50)

    const translation = await harness.prisma.articleTranslation.findFirst({
      where: { articleId: BigInt((await articleFor('doc-b'))?.id ?? 0), languageCode: 'pt-BR' },
      select: { reviewStatus: true, indexStatus: true },
    })
    expect(String(translation?.reviewStatus)).toBe('blocked')
    expect(String(translation?.indexStatus)).toBe('noindex')
  })

  it('O DEFEITO INTEIRO: o `updated` atrasado NAO ressuscita a retratada', async () => {
    await project(event({ eventId: 'evt-pub-3', payloadDocumentId: 'doc-c', emissionSequence: 30 }))
    await project(
      event({
        eventId: 'evt-ret-3',
        payloadDocumentId: 'doc-c',
        eventType: 'article.retracted',
        emissionSequence: 50,
        publishedContent: null,
        seo: null,
        retractionReason: 'fato apurado incorretamente',
      }),
    )

    // O evento 40 estava preso na fila e chega DEPOIS da retratacao.
    const late = await project(
      event({
        eventId: 'evt-upd-3-atrasado',
        payloadDocumentId: 'doc-c',
        eventType: 'article.updated',
        emissionSequence: 40,
        publishedContent: {
          ...(event({ payloadDocumentId: 'doc-c' })
            .publishedContent as NonNullable<ProjectionEvent['publishedContent']>),
          title: 'VERSAO ANTIGA que nao pode voltar ao ar',
        },
      }),
    )

    expect(late.outcome).toBe('skipped_stale')

    const articleId = BigInt((await articleFor('doc-c'))?.id ?? 0)
    const translation = await harness.prisma.articleTranslation.findFirst({
      where: { articleId, languageCode: 'pt-BR' },
      select: { reviewStatus: true, indexStatus: true, title: true },
    })
    // A materia continua retratada e fora do indice.
    expect(String(translation?.reviewStatus)).toBe('blocked')
    expect(String(translation?.indexStatus)).toBe('noindex')
    expect(translation?.title).not.toBe('VERSAO ANTIGA que nao pode voltar ao ar')
  })
})

describe('retirada sem materia correspondente', () => {
  it('FALHA de forma retentavel em vez de virar recibo mentiroso', async () => {
    const evt = event({
      eventId: 'evt-ret-orfa',
      payloadDocumentId: 'doc-que-nao-existe',
      eventType: 'article.retracted',
      emissionSequence: 12,
      publishedContent: null,
      seo: null,
      retractionReason: 'retratacao de materia nunca projetada',
    })

    await expect(project(evt)).rejects.toMatchObject({
      code: 'projection_target_missing',
      retryable: true,
    })

    // NENHUM recibo: e o recibo que trava o replay. Um `applied` com
    // `article_id NULL` deixaria a retratacao aplicada para sempre sem nunca
    // ter sido aplicada, e o evento nao voltaria depois que a publicacao
    // aterrissasse.
    expect(await receiptFor('evt-ret-orfa')).toBeNull()
  })

  it('e depois que a publicacao chega, a MESMA retratacao aplica', async () => {
    // O motivo de a falha ser retentavel: a corrida legitima e a retratacao
    // chegar antes de o `published` daquele documento ter sido projetado.
    await project(
      event({ eventId: 'evt-pub-tardio', payloadDocumentId: 'doc-tardio', emissionSequence: 5 }),
    )

    const retry = await project(
      event({
        eventId: 'evt-ret-retry',
        payloadDocumentId: 'doc-tardio',
        eventType: 'article.retracted',
        emissionSequence: 12,
        publishedContent: null,
        seo: null,
        retractionReason: 'agora ha materia para retratar',
      }),
    )

    expect(retry.outcome).toBe('applied')
    expect(retry.articleId).not.toBeNull()
    expect((await articleFor('doc-tardio'))?.projectedSequence).toBe(12)
    expect((await receiptFor('evt-ret-retry'))?.articleId).not.toBeNull()
  })
})
