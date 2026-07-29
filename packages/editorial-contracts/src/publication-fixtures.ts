/**
 * publication-fixtures.ts — Exemplos canonicos do pedido de publicacao. PURO.
 *
 * Estas fixtures sao ENTREGA, nao so material de teste: o MNScr vive em outro
 * repositorio e precisa de um exemplo valido e de exemplos invalidos com o
 * motivo da recusa. Um contrato sem contraexemplo ensina metade.
 */

import { contractSchemaHash } from './manifest.js'
import {
  EDITORIAL_PUBLICATION_REQUEST_NAME,
  EDITORIAL_PUBLICATION_REQUEST_VERSION,
  type EditorialPublicationRequestV1,
} from './editorial-publication-request-v1.js'
import { SEO_PROPOSAL_VERSION } from './seo-proposal.js'

// `contentHash` do repositorio e hex PURO (sem prefixo). O hash de SCHEMA, sim,
// usa `sha256:<hex>` — sao validadores diferentes de proposito.
const HASH_64 = 'abcdef0123456789'.repeat(4)

/**
 * Pedido VALIDO de referencia.
 *
 * `schemaHash` e resolvido do proprio manifesto: fixar um literal aqui faria a
 * fixture apodrecer no primeiro campo novo e o teste passaria a provar o
 * passado.
 */
export const validPublicationRequest: EditorialPublicationRequestV1 = {
  contractName: EDITORIAL_PUBLICATION_REQUEST_NAME,
  contractVersion: EDITORIAL_PUBLICATION_REQUEST_VERSION,
  schemaHash: contractSchemaHash(EDITORIAL_PUBLICATION_REQUEST_NAME) ?? `sha256:${HASH_64}`,

  requestId: 'req-2026-07-29-0001',
  idempotencyKey: 'mnscr:cluster-4711:rev-3',
  sourceClusterId: 'cluster-4711',
  sourceRevision: 3,
  sourcePayloadHash: HASH_64,

  publicationIntent: 'publish',

  publicAuthorId: 'author-redacao-cinerie',
  attributionMode: 'newsroom',

  contentType: 'news',
  language: 'pt-BR',
  title: 'Estudio confirma data de estreia da nova serie',
  subtitle: 'Producao chega ao catalogo em marco',
  summary:
    'O estudio confirmou nesta terca-feira a data de estreia da nova serie, encerrando meses de especulacao entre os fas.',
  blocks: [
    {
      type: 'paragraph',
      id: 'b1',
      text: 'O estudio confirmou a data de estreia em comunicado enviado a imprensa nesta terca-feira.',
    },
    {
      type: 'paragraph',
      id: 'b2',
      text: 'A primeira temporada tera oito episodios, com lancamento semanal apos a estreia dupla.',
    },
  ],

  externalSources: [
    {
      id: 'src-variety',
      name: 'Variety',
      url: 'https://variety.com/exemplo-de-materia',
      role: 'primary',
    },
  ],
  entityLinks: [
    {
      entityKind: 'tv',
      entityId: 'tv-12345',
      relation: 'primary_subject',
      confidence: 0.95,
    },
  ],
  media: [{ mediaId: 'media-9001', intendedUse: 'hero', altSuggestion: 'Cartaz oficial da serie' }],

  seo: {
    version: SEO_PROPOSAL_VERSION,
    title: 'Nova serie ganha data de estreia oficial',
    metaDescription:
      'O estudio confirmou a data de estreia da nova serie, que chega ao catalogo em marco com oito episodios e lancamento semanal.',
    slugSuggestion: 'nova-serie-data-de-estreia',
    focusKeyphrase: 'data de estreia',
    relatedKeyphrases: ['nova serie', 'catalogo de marco'],
    editorialKeywords: ['serie', 'estreia', 'streaming'],
    schemaTypeRecommendation: 'NewsArticle',
    articleSectionSuggestion: 'Series',
    openGraphTitleSuggestion: 'Nova serie ganha data de estreia',
    openGraphDescriptionSuggestion: 'A producao chega ao catalogo em marco com oito episodios.',
    imageAltSuggestions: [{ mediaRef: 'media-9001', alt: 'Cartaz oficial da nova serie' }],
    internalLinkSuggestions: [
      {
        targetType: 'tv_show',
        targetId: 'tv-12345',
        anchorText: 'a nova serie',
        reason: 'entidade principal da materia',
        confidence: 0.95,
      },
    ],
  },

  provenance: {
    pipeline: 'mnscr@2026.07',
    model: 'redacao-assistida',
    inputHash: HASH_64,
  },
  qa: { version: 'qa@1', passed: true, warnings: [], blockingErrors: [] },

  generatedAt: '2026-07-29T12:00:00.000Z',
  pipelineVersion: 'mnscr@2026.07',
}

/**
 * Contraexemplos, cada um com UM defeito isolado.
 *
 * Isolar importa: uma fixture com tres erros nao prova qual gate pegou. Cada
 * entrada abaixo falha por um motivo, e o motivo esta no nome.
 */
export const invalidPublicationRequests: Readonly<Record<string, unknown>> = {
  /** Campo do Yoast: semantica de outro CMS entrando pela porta lateral. */
  yoastField: {
    ...validPublicationRequest,
    seo: { ...validPublicationRequest.seo, _yoast_wpseo_title: 'titulo' },
  },
  /** Estado publico decidido pelo produtor. */
  wordpressPostStatus: { ...validPublicationRequest, post_status: 'publish' },
  /** Canonical pertence ao lado publico. */
  canonicalFromProducer: {
    ...validPublicationRequest,
    seo: { ...validPublicationRequest.seo, canonical: 'https://cinerie.com/x' },
  },
  /** Burlar a revisao nunca e um campo aceitavel. */
  bypassReview: { ...validPublicationRequest, bypassReview: true },
  /** Publicacao automatica sem lastro factual. */
  noExternalSources: { ...validPublicationRequest, externalSources: [] },
  /** QA que reprova sem dizer o que quebrou. */
  qaFailedWithoutErrors: {
    ...validPublicationRequest,
    qa: { version: 'qa@1', passed: false, warnings: [], blockingErrors: [] },
  },
  /** `update` sem alvo faria o servidor adivinhar qual materia sobrescrever. */
  updateWithoutTarget: { ...validPublicationRequest, publicationIntent: 'update' },
  /** Alt para midia que nao veio no pedido. */
  altForUnknownMedia: {
    ...validPublicationRequest,
    seo: {
      ...validPublicationRequest.seo,
      imageAltSuggestions: [{ mediaRef: 'media-inexistente', alt: 'Cartaz oficial' }],
    },
  },
  /** Meta description curta demais para ser util na SERP. */
  metaTooShort: {
    ...validPublicationRequest,
    seo: { ...validPublicationRequest.seo, metaDescription: 'Curta.' },
  },
  /** Nome livre no lugar do id do autor: assinatura sem entidade nem politica. */
  authorAsFreeText: (() => {
    const { publicAuthorId: _dropped, ...rest } = validPublicationRequest
    return { ...rest, publicAuthorName: 'Fulano' }
  })(),

  /**
   * O cliente tentando declarar QUEM ELE E.
   *
   * A identidade tecnica vem da credencial autenticada. Se o corpo pudesse
   * declara-la, a auditoria registraria o que o cliente DISSE ser, e um cliente
   * comprometido assinaria acoes com a identidade de outro.
   */
  clientDeclaredTechnicalActor: {
    ...validPublicationRequest,
    technicalActorId: 'service-account-de-outro',
  },
  clientDeclaredServiceAccount: {
    ...validPublicationRequest,
    serviceAccountId: 'sa-999',
  },
  clientDeclaredScopes: {
    ...validPublicationRequest,
    scopes: ['editorial_auto_publish', 'publication_projection'],
  },
  /** Identidade escondida em objeto ANINHADO — a varredura e profunda. */
  nestedTechnicalActor: {
    ...validPublicationRequest,
    provenance: { ...validPublicationRequest.provenance, publishedBy: 'sa-oculta' },
  },

  /** SEO duplicado: `seoProposal` do draft convivendo com `seo`. */
  duplicateSeoProposal: {
    ...validPublicationRequest,
    seoProposal: { metaTitle: 'outro titulo', metaDescription: 'outra meta' },
  },
  /** Campo de SEO SOLTO no topo, competindo com `seo.metaDescription`. */
  looseSeoField: {
    ...validPublicationRequest,
    metaDescription: 'meta concorrente no nivel superior',
  },

  /** Schema incompativel: hash de outro contrato. */
  incompatibleSchemaHash: {
    ...validPublicationRequest,
    schemaHash: `sha256:${'0123456789abcdef'.repeat(4)}`,
  },
}

/**
 * Pedido VALIDO de ATUALIZACAO.
 *
 * `sourceRevision` maior que a ja aplicada e `targetArticleId` presente sao o
 * que distingue uma atualizacao legitima de um replay antigo.
 */
export const validPublicationUpdate: EditorialPublicationRequestV1 = {
  ...validPublicationRequest,
  requestId: 'req-2026-07-29-0002',
  idempotencyKey: 'mnscr:cluster-4711:rev-4',
  publicationIntent: 'update',
  targetArticleId: 'article-8801',
  sourceRevision: 4,
  title: 'Estudio antecipa a data de estreia da nova serie',
  summary:
    'O estudio antecipou a estreia em duas semanas, segundo comunicado enviado a imprensa nesta quarta-feira.',
}

/**
 * Pedido que o CONTRATO aceita e o SERVIDOR roteia para revisao.
 *
 * Importante: ele e VALIDO. O que o manda para revisao humana e o QA reprovado,
 * e isso e decisao de runtime — nao cabe ao schema recusar conteudo que so
 * precisa de um par de olhos.
 */
export const routedToReviewRequest: EditorialPublicationRequestV1 = {
  ...validPublicationRequest,
  requestId: 'req-2026-07-29-0003',
  idempotencyKey: 'mnscr:cluster-4712:rev-1',
  qa: {
    version: 'qa@1',
    passed: false,
    warnings: ['entidade secundaria com baixa confianca'],
    blockingErrors: ['fato central sem segunda fonte'],
  },
}

/**
 * Pedido que gera CONFLICT no servidor.
 *
 * Tambem VALIDO no contrato: `update` com revisao ANTERIOR a ja aplicada nao e
 * um erro de forma — e um pedido que chegou fora de ordem. Recusar no schema
 * seria impossivel, porque o schema nao conhece o estado do artigo.
 */
export const conflictingUpdateRequest: EditorialPublicationRequestV1 = {
  ...validPublicationUpdate,
  requestId: 'req-2026-07-29-0004',
  idempotencyKey: 'mnscr:cluster-4711:rev-1',
  sourceRevision: 1,
}
