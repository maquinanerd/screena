/**
 * A galeria GRAVADA no banco publico real — o salto 4 -> 5.
 *
 * O teste puro irmao (`gallery-media.test.ts`) prova a decisao. Este prova a
 * ESCRITA contra PostgreSQL 16 efemero com as migrations reais: que o corpo com
 * a galeria resolvida passa pelos CHECKs de `article_translations`, e que o que
 * fica gravado e a forma que o site le (`publicPath` por item), nao a do
 * contrato (`mediaRef`).
 *
 * NAO prova que a foto vira linha em `editorial_media_assets`: o store grava
 * todo asset que recebe, com ou sem galeria, entao esse teste passaria tambem
 * sem a correcao — ele foi escrito, passou no RED, e saiu por isso.
 *
 * Sem CMS de proposito: o que esta sob teste e a projecao. A cadeia inteira, do
 * CMS ao banco publico, esta em `editorial-projection.integration.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyProjectionEvent } from '../persistence/editorial-projection-store.js'
import type { ProjectionBlock, ProjectionEvent } from '../editorial-projection.js'
import type { ProjectedMediaAsset } from '../media/media-pipeline.js'
import { startScreenDbHarness, type ScreenDbHarness } from './screen-db-harness.js'

let harness: ScreenDbHarness

function projectedAsset(mediaId: string, hex: string): ProjectedMediaAsset {
  const hash = hex.repeat(64).slice(0, 64)
  return {
    mediaId,
    publicPath: `/media/editorial/${hash.slice(0, 2)}/${hash}.jpg`,
    contentHash: `sha256:${hash}`,
    mimeType: 'image/jpeg',
    width: 1200,
    height: 800,
    alt: `alt do acervo ${mediaId}`,
    caption: null,
    credit: `Credito ${mediaId}`,
    storageKey: `editorial/${hash.slice(0, 2)}/${hash}.jpg`,
    byteSize: 1024,
    rightsHolder: null,
    sourceName: null,
    sourceUrl: null,
    licenseStatus: 'approved',
    licenseReference: null,
    licenseExpiresAtIso: null,
    requiresAttribution: true,
    allowedForEditorial: true,
    allowedForHero: false,
    allowedForSocial: false,
    reused: false,
  }
}

function event(documentId: string, body: ProjectionBlock[]): ProjectionEvent {
  return {
    eventId: `evt-${documentId}`,
    idempotencyKey: `idem-${documentId}`,
    eventType: 'article.published',
    payloadDocumentId: documentId,
    emissionSequence: 3,
    language: 'pt-BR',
    occurredAtIso: '2026-09-16T12:00:00.000Z',
    retractionReason: null,
    publishedContent: {
      title: 'Bastidores da estreia',
      subtitle: null,
      slug: `bastidores-${documentId}`,
      summary: 'Resumo editorial da materia.',
      contentType: 'news',
      body,
      authorName: 'Redacao Cinerie',
      publishedAtIso: '2026-09-16T11:00:00.000Z',
      correctedAtIso: null,
      correctionNote: null,
      aiAssisted: false,
    },
    seo: {
      metaTitle: 'Bastidores da estreia',
      metaDescription: 'A galeria de fotos dos bastidores da estreia.',
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

const body: ProjectionBlock[] = [
  { id: 'p1', type: 'paragraph', text: 'Os bastidores da estreia, em fotos.' } as ProjectionBlock,
  {
    id: 'g1',
    type: 'gallery',
    items: [
      { mediaRef: '501', alt: 'Elenco na chegada', credit: 'Foto A' },
      { mediaRef: '502', alt: 'Diretora na coletiva' },
    ],
    initialIndex: 1,
  } as ProjectionBlock,
]

async function storedBody(documentId: string): Promise<Record<string, unknown>[]> {
  const article = await harness.prisma.article.findUnique({
    where: { payloadDocumentId: documentId },
    include: { translations: true },
  })
  return (article?.translations[0]?.bodyBlocks ?? []) as unknown as Record<string, unknown>[]
}

beforeAll(async () => {
  harness = await startScreenDbHarness()
}, 600_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

describe('galeria gravada no banco publico', () => {
  it('cada foto chega com caminho publico, e o banco aceita o corpo', async () => {
    const result = await applyProjectionEvent(harness.prisma, {
      event: event('doc-galeria', body),
      contentVersion: 'sha256:galeria',
      workerId: 'worker-teste',
      media: new Map([
        ['501', projectedAsset('501', 'a1')],
        ['502', projectedAsset('502', 'b2')],
      ]),
    })
    expect(result.outcome).toBe('applied')

    const gallery = (await storedBody('doc-galeria')).find((block) => block.type === 'gallery') as
      | { items: Record<string, unknown>[]; initialIndex?: number }
      | undefined

    // AQUI estava o defeito: a galeria gravava com `mediaRef` e sem caminho,
    // e o site descartava todos os itens.
    expect(gallery?.items).toHaveLength(2)
    expect(gallery?.items.map((item) => item.publicPath)).toEqual([
      projectedAsset('501', 'a1').publicPath,
      projectedAsset('502', 'b2').publicPath,
    ])
    for (const item of gallery?.items ?? []) expect(item).not.toHaveProperty('mediaRef')
    expect(gallery?.items[0]?.credit).toBe('Foto A')
    expect(gallery?.items[1]?.credit).toBe('Credito 502')
    expect(gallery?.initialIndex).toBe(1)
  })

  it('foto que nao projetou sai do corpo, e o desfecho AVISA qual foi', async () => {
    const result = await applyProjectionEvent(harness.prisma, {
      event: event('doc-galeria-parcial', body),
      contentVersion: 'sha256:galeria-parcial',
      workerId: 'worker-teste',
      media: new Map([['502', projectedAsset('502', 'b2')]]),
    })
    expect(result.outcome).toBe('applied')
    expect(result.warnings.join(' | ')).toContain('g1#0')

    const gallery = (await storedBody('doc-galeria-parcial')).find(
      (block) => block.type === 'gallery',
    ) as { items: Record<string, unknown>[]; initialIndex?: number } | undefined
    expect(gallery?.items.map((item) => item.alt)).toEqual(['Diretora na coletiva'])
    // A abertura seguia a 2a foto; ela virou a 1a.
    expect(gallery?.initialIndex).toBe(0)
  })
})
