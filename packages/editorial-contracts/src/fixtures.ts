/**
 * fixtures.ts — Exemplos VALIDOS canonicos dos contratos. PURO.
 *
 * Servem de base para os testes (que derivam os casos invalidos a partir daqui)
 * e de referencia executavel para quem for implementar o MNScr. Os instantes sao
 * literais fixos de proposito: `Date.now()` tornaria a fixture nao-determinista.
 */

import type { CinerieEditorialContextV1 } from './cinerie-editorial-context-v1.js'
import type { EditorialDraftV1 } from './editorial-draft-v1.js'
import type { PublicationEventV1 } from './publication-event-v1.js'

const HASH_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const HASH_B = 'f0e1d2c3b4a596871625344352617180f0e1d2c3b4a596871625344352617180'

/** Draft valido de referencia: uma noticia com fonte, claim e midia candidata. */
export const validEditorialDraft: EditorialDraftV1 = {
  contractVersion: 'editorial-draft-v1',
  draftId: 'draft-2026-07-28-001',
  idempotencyKey: 'cluster-duna-3:rev-4',
  sourceClusterId: 'cluster-duna-3',
  sourceRevision: 4,
  sourcePayloadHash: HASH_A,
  proposedAction: 'create',
  contentType: 'news',
  language: 'pt-BR',
  title: 'Duna Parte Tres ganha data de estreia',
  subtitle: 'Warner confirma o calendario',
  summary:
    'A Warner Bros. confirmou a data de estreia de Duna Parte Tres, encerrando meses de especulacao sobre o calendario da franquia.',
  slugProposal: 'duna-parte-tres-data-de-estreia',
  blocks: [
    {
      id: 'b1',
      type: 'paragraph',
      text: 'A Warner Bros. confirmou nesta segunda-feira a data de estreia de Duna Parte Tres.',
      provenance: [{ origin: 'external_source', ref: 'src-variety' }],
    },
    {
      id: 'b2',
      type: 'heading',
      level: 2,
      text: 'O que muda para a franquia',
    },
    {
      id: 'b3',
      type: 'entityCard',
      entityKind: 'movie',
      entityId: 'entity-movie-1234',
      note: 'Terceiro filme da adaptacao dirigida por Denis Villeneuve.',
      provenance: [{ origin: 'cinerie_catalog', ref: 'entity-movie-1234' }],
    },
    {
      id: 'b4',
      type: 'sourceList',
      sourceRefs: ['src-variety'],
    },
  ],
  externalSources: [
    {
      id: 'src-variety',
      name: 'Variety',
      url: 'https://variety.com/2026/film/news/dune-part-three-release-date',
      role: 'primary',
      publishedAt: '2026-07-28T12:00:00Z',
    },
  ],
  claimsUsed: [
    {
      id: 'claim-1',
      text: 'A estreia foi confirmada para dezembro de 2026.',
      origin: 'external_source',
      sourceRefs: ['src-variety'],
      confidence: 0.9,
    },
  ],
  internalContextUsed: [{ kind: 'entity', ref: 'entity-movie-1234', usage: 'enrich' }],
  entitySuggestions: [
    {
      entityKind: 'movie',
      entityId: 'entity-movie-1234',
      relation: 'primary_subject',
      confidence: 0.95,
      origin: 'cinerie_catalog',
      verified: false,
    },
  ],
  mediaCandidates: [
    {
      id: 'media-cand-1',
      mediaRef: 'catalog-image-7788',
      kind: 'image',
      alt: 'Cena de Duna Parte Dois',
      origin: 'cinerie_catalog',
      intendedUse: 'hero',
    },
  ],
  seoProposal: {
    metaTitle: 'Duna Parte Tres: data de estreia confirmada',
    metaDescription: 'A Warner confirmou quando Duna Parte Tres chega aos cinemas.',
  },
  provenance: {
    pipeline: 'mnscr',
    model: 'gemini-2.5-pro',
    promptVersion: 'news-v3',
    inputHash: HASH_A,
    refs: [{ origin: 'external_source', ref: 'src-variety', confidence: 0.9 }],
  },
  qa: {
    version: 'qa-v2',
    passed: true,
    warnings: [],
    blockingErrors: [],
  },
  generatedAt: '2026-07-28T12:30:00Z',
  pipelineVersion: 'mnscr-1.4.0',
}

/** Evento de publicacao valido de referencia. */
export const validPublicationEvent: PublicationEventV1 = {
  contractVersion: 'publication-event-v1',
  eventId: 'evt-01J8Z5',
  // Formato canonico: `articleId:articleVersionId:eventType`. Escrever `v3` no
  // lugar de `article-991-v3` deixaria duas versoes de artigos diferentes
  // colidirem na mesma chave.
  idempotencyKey: 'article-991:article-991-v3:article.published',
  eventType: 'article.published',
  articleId: 'article-991',
  articleVersionId: 'article-991-v3',
  payloadDocumentId: 'cms-doc-991',
  language: 'pt-BR',
  occurredAt: '2026-07-28T15:00:00Z',
  actor: { userId: 'user-42', role: 'editor_in_chief', displayName: 'Redacao Cinerie' },
  publishedContent: {
    title: 'Duna Parte Tres ganha data de estreia',
    subtitle: 'Warner confirma o calendario',
    slug: 'duna-parte-tres-data-de-estreia',
    summary: 'A Warner Bros. confirmou a data de estreia de Duna Parte Tres.',
    contentType: 'news',
    body: [{ id: 'b1', type: 'paragraph', text: 'A Warner Bros. confirmou a data de estreia.' }],
    authors: [
      {
        authorId: 'author-1',
        name: 'Redacao Cinerie',
        slug: 'redacao-cinerie',
        roleLabel: 'Redacao',
      },
    ],
    section: 'Cinema',
    publishedAt: '2026-07-28T15:00:00Z',
    aiAssisted: true,
  },
  entities: [
    {
      entityKind: 'movie',
      entityId: 'entity-movie-1234',
      relation: 'primary_subject',
      verified: true,
    },
  ],
  media: [
    {
      mediaId: 'media-1',
      role: 'hero',
      url: 'https://cdn.cinerie.com/editorial/duna-3-hero.jpg',
      alt: 'Cena de Duna Parte Dois',
      credit: 'Warner Bros.',
      requiresAttribution: true,
      width: 1600,
      height: 900,
    },
  ],
  seo: {
    metaTitle: 'Duna Parte Tres: data de estreia confirmada',
    metaDescription: 'A Warner confirmou quando Duna Parte Tres chega aos cinemas.',
    noindex: false,
    focusKeyphrase: 'duna parte tres',
    relatedKeyphrases: ['data de estreia', 'warner'],
    editorialKeywords: ['duna', 'ficcao cientifica'],
    schemaTypeRecommendation: 'NewsArticle',
    articleSection: 'Cinema',
    // Listas VAZIAS aparecem explicitamente porque este e o tipo de SAIDA: e o
    // que o consumidor recebe depois do parse, com os defaults ja aplicados.
    approvedImageAlt: [],
    approvedInternalLinks: [],
  },
  provenance: {
    externalSources: [
      {
        name: 'Variety',
        url: 'https://variety.com/2026/film/news/dune-part-three-release-date',
        role: 'primary',
      },
    ],
    draftPayloadHash: HASH_B,
    pipelineVersion: 'mnscr-1.4.0',
    reviewedBy: ['user-42'],
  },
}

/** Contexto editorial valido de referencia. */
export const validEditorialContext: CinerieEditorialContextV1 = {
  contractVersion: 'cinerie-editorial-context-v1',
  requestId: 'ctx-req-001',
  sourceClusterId: 'cluster-duna-3',
  language: 'pt-BR',
  generatedAt: '2026-07-28T12:25:00Z',
  entities: [
    {
      entityKind: 'movie',
      entityId: 'entity-movie-1234',
      title: 'Duna Parte Dois',
      slug: 'duna-parte-dois',
      canonicalUrl: 'https://cinerie.com/pt/filmes/duna-parte-dois/',
      language: 'pt-BR',
      overview: 'Continuacao da adaptacao dirigida por Denis Villeneuve.',
      runtimeMinutes: 166,
      externalIds: [{ provider: 'tmdb', value: '693134' }],
      cast: [
        {
          entityId: 'person-1',
          name: 'Timothee Chalamet',
          character: 'Paul Atreides',
          externalIds: [],
        },
      ],
      crew: [
        { entityId: 'person-2', name: 'Denis Villeneuve', role: 'Diretor', externalIds: [] },
      ],
      origin: 'cinerie_catalog',
    },
  ],
  relations: [
    {
      fromEntityId: 'entity-movie-1234',
      toEntityId: 'entity-franchise-9',
      relation: 'belongs_to_franchise',
    },
  ],
  media: [
    {
      mediaId: 'catalog-image-7788',
      kind: 'image',
      url: 'https://cdn.cinerie.com/catalog/duna-2-still.jpg',
      width: 1920,
      height: 1080,
      aspectRatio: '16:9',
      alt: 'Cena de Duna Parte Dois',
      credit: 'Warner Bros.',
      licenseStatus: 'approved',
      requiresAttribution: true,
      allowedForEditorial: true,
      allowedForHero: true,
      allowedForSocial: false,
      restrictions: [],
      origin: 'licensed_media',
    },
  ],
  publishedArticles: [
    {
      articleId: 'article-880',
      title: 'Duna Parte Dois encerra sua exibicao nos cinemas',
      slug: 'duna-parte-dois-fim-de-exibicao',
      canonicalUrl: 'https://cinerie.com/pt/noticias/duna-parte-dois-fim-de-exibicao/',
      contentType: 'news',
      publishedAt: '2026-05-02T10:00:00Z',
      language: 'pt-BR',
      linkedEntityIds: ['entity-movie-1234'],
    },
  ],
  coverageTimeline: [
    {
      articleId: 'article-880',
      occurredAt: '2026-05-02T10:00:00Z',
      headline: 'Duna Parte Dois encerra sua exibicao nos cinemas',
    },
  ],
  availability: [],
  omissions: [{ scope: 'availability', reason: 'license_unknown' }],
}
