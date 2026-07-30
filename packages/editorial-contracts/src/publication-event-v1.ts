/**
 * publication-event-v1.ts — Contrato Payload -> projecao publica. PURO.
 *
 * Representa APENAS conteudo humano aprovado. Um evento so nasce de uma acao
 * humana valida no CMS; nenhuma automacao o emite. Este e o unico canal pelo
 * qual a redacao fala com o lado publico — e ele e assincrono por design, para
 * que o `screen-app` nunca dependa do Payload em runtime (ADR 0015).
 */

import { z } from 'zod'

import { publicationContentType } from './editorial-publication-request-v1.js'

import { editorialBody } from './blocks.js'
import {
  LIMITS,
  contentHash,
  entityKind,
  httpUrl,
  isoDateTime,
  languageCode,
  optionalPlainText,
  parseContract,
  plainText,
  slugProposal,
  stableId,
  type ContractParse,
} from './common.js'

export const PUBLICATION_EVENT_CONTRACT_VERSION = 'publication-event-v1' as const

export const PUBLICATION_EVENT_TYPES = [
  'article.published',
  'article.updated',
  'article.unpublished',
  'article.retracted',
] as const

export const publicationEventType = z.enum(PUBLICATION_EVENT_TYPES)
export type PublicationEventType = (typeof PUBLICATION_EVENT_TYPES)[number]

/** Quem executou a acao. Sempre humano: automacao nao publica. */
export const eventActor = z.object({
  userId: stableId,
  role: z.enum(['administrator', 'editor_in_chief']),
  displayName: optionalPlainText(LIMITS.shortText),
})
export type EventActor = z.infer<typeof eventActor>

/** Autor publico da materia (entidade `authors`, nao usuario de login). */
export const publishedAuthor = z.object({
  authorId: stableId,
  name: plainText(LIMITS.shortText),
  slug: slugProposal,
  roleLabel: optionalPlainText(LIMITS.shortText),
  url: httpUrl.optional(),
})

/** Midia ja AUTORIZADA. Sem autorizacao, nao chega aqui. */
export const publishedMedia = z.object({
  mediaId: stableId,
  role: z.enum(['hero', 'inline', 'gallery', 'social']),
  url: httpUrl,
  alt: plainText(LIMITS.shortText),
  caption: optionalPlainText(LIMITS.shortText),
  credit: optionalPlainText(LIMITS.shortText),
  rightsHolder: optionalPlainText(LIMITS.shortText),
  licenseReference: optionalPlainText(LIMITS.shortText),
  requiresAttribution: z.boolean(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/** Vinculo confirmado com entidade do catalogo (confirmado por humano). */
export const publishedEntityLink = z.object({
  entityKind,
  entityId: stableId,
  relation: z.enum([
    'primary_subject',
    'secondary_subject',
    'mentioned',
    'reviewed',
    'recommended',
    'compared',
  ]),
  verified: z.literal(true),
})

/**
 * SEO APROVADO pelo CMS. Nao e a sugestao do produtor.
 *
 * A fronteira importa: o MNScr propoe (`seoProposal`), o CMS valida e decide, e
 * o que atravessa para o lado publico e a DECISAO. Um campo aqui significa "o
 * CMS aceitou isto", nunca "o pipeline pediu isto".
 *
 * O que continua FORA, de proposito, porque pertence ao lado publico e nao ao
 * editorial: `canonical` (derivada de `slugs`/`redirects`), `robots`, datas
 * estruturadas e o JSON-LD montado. `canonicalOverride` e a unica excecao, e e
 * uma excecao editorial explicita — sindicacao, conteudo espelhado —, nao a
 * canonical de uso normal.
 */
export const publishedSeo = z.object({
  metaTitle: optionalPlainText(LIMITS.title),
  metaDescription: optionalPlainText(LIMITS.summary),
  canonicalOverride: httpUrl.optional(),
  noindex: z.boolean(),
  socialTitle: optionalPlainText(LIMITS.title),
  socialDescription: optionalPlainText(LIMITS.summary),

  // --- Sinais de ranqueamento aprovados ---
  focusKeyphrase: optionalPlainText(LIMITS.shortText),
  relatedKeyphrases: z.array(plainText(LIMITS.shortText)).max(10).default([]),
  editorialKeywords: z.array(plainText(LIMITS.shortText)).max(20).default([]),
  /**
   * Tipo de JSON-LD RECOMENDADO. O lado publico monta o JSON-LD final e pode
   * recusar a recomendacao — emitir `Review` sem review propria seria schema
   * falso, e essa decisao nao pertence ao CMS.
   */
  schemaTypeRecommendation: z
    .enum(['NewsArticle', 'Article', 'Review', 'ItemList', 'HowTo'])
    .optional(),
  articleSection: optionalPlainText(LIMITS.shortText),
  /**
   * `alt` APROVADO por midia. Nao e o `alt` sugerido pelo pipeline: e o que
   * sobreviveu a revisao de licenca e acessibilidade. Sem isto, o lado publico
   * teria de escolher entre repetir a sugestao crua ou renderizar imagem sem
   * descricao.
   */
  approvedImageAlt: z
    .array(z.object({ mediaId: stableId, alt: plainText(LIMITS.shortText) }))
    .max(LIMITS.mediaCandidates)
    .default([]),
  /**
   * Links internos APROVADOS. So entidades que o CMS confirmou: um link para
   * entidade nao verificada geraria 404 interno em pagina indexavel.
   */
  approvedInternalLinks: z
    .array(
      z.object({
        targetType: z.enum(['movie', 'tv_show', 'person', 'article']),
        targetId: stableId,
        anchorText: plainText(LIMITS.shortText),
      }),
    )
    .max(LIMITS.entitySuggestions)
    .default([]),
})

/** Conteudo efetivamente aprovado para publicacao. */
export const publishedContent = z.object({
  title: plainText(LIMITS.title),
  subtitle: optionalPlainText(LIMITS.subtitle),
  slug: slugProposal,
  summary: plainText(LIMITS.summary),
  // FONTE UNICA. O enum literal duplicado aqui divergiu do contrato de entrada
  // quando `review` foi acrescentado la: o pedido era aceito e a publicacao
  // morria na persistencia, com 503 e sem materia.
  contentType: publicationContentType,
  body: editorialBody,
  authors: z.array(publishedAuthor).min(1, 'materia publicada exige autor'),
  section: optionalPlainText(LIMITS.shortText),
  publishedAt: isoDateTime,
  correctedAt: isoDateTime.optional(),
  correctionNote: optionalPlainText(LIMITS.summary),
  aiAssisted: z.boolean(),
})

/** Proveniencia consolidada do que foi publicado. */
export const publishedProvenance = z.object({
  externalSources: z
    .array(
      z.object({
        name: plainText(LIMITS.shortText),
        url: httpUrl,
        role: z.enum(['primary', 'secondary', 'press_release', 'catalog']),
      }),
    )
    .max(LIMITS.externalSources)
    .default([]),
  draftPayloadHash: contentHash.optional(),
  pipelineVersion: optionalPlainText(LIMITS.shortText),
  reviewedBy: z.array(stableId).max(20).default([]),
})

export const publicationEventV1 = z
  .object({
    contractVersion: z.literal(PUBLICATION_EVENT_CONTRACT_VERSION),

    eventId: stableId,
    idempotencyKey: stableId,
    eventType: publicationEventType,

    articleId: stableId,
    articleVersionId: stableId,
    payloadDocumentId: stableId,
    language: languageCode,

    occurredAt: isoDateTime,
    actor: eventActor,

    publishedContent: publishedContent.optional(),
    entities: z.array(publishedEntityLink).max(LIMITS.entitySuggestions).default([]),
    media: z.array(publishedMedia).max(LIMITS.mediaCandidates).default([]),
    seo: publishedSeo.optional(),
    provenance: publishedProvenance,

    previousPublicVersion: stableId.optional(),
    retractionReason: optionalPlainText(LIMITS.summary),
  })
  .strict()
  .superRefine((event, ctx) => {
    const carriesContent =
      event.eventType === 'article.published' || event.eventType === 'article.updated'

    // Publicar/atualizar SEM conteudo produziria uma pagina publica vazia.
    if (carriesContent && event.publishedContent === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['publishedContent'],
        message: `${event.eventType} exige publishedContent`,
      })
    }
    if (carriesContent && event.seo === undefined) {
      ctx.addIssue({ code: 'custom', path: ['seo'], message: `${event.eventType} exige seo` })
    }

    // Retratacao sem motivo registrado apaga a evidencia do porque.
    if (event.eventType === 'article.retracted' && event.retractionReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['retractionReason'],
        message: 'article.retracted exige retractionReason',
      })
    }

    // Midia que exige atribuicao sem credito preenchido nao pode ir ao ar
    // (invariante 6 aplicada no proprio contrato, nao so na UI).
    for (const [index, media] of event.media.entries()) {
      if (media.requiresAttribution && (media.credit ?? '').trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['media', index, 'credit'],
          message: 'midia com requiresAttribution exige credit preenchido',
        })
      }
    }

    // Materia assistida por IA sem nenhuma fonte declarada e parafrase sem lastro.
    if (
      event.publishedContent?.aiAssisted === true &&
      event.provenance.externalSources.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['provenance', 'externalSources'],
        message: 'conteudo aiAssisted exige ao menos uma fonte externa declarada',
      })
    }
  })

export type PublicationEventV1 = z.infer<typeof publicationEventV1>

export function parsePublicationEventV1(input: unknown): ContractParse<PublicationEventV1> {
  return parseContract(publicationEventV1, input)
}
