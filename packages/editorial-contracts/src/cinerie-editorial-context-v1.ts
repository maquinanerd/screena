/**
 * cinerie-editorial-context-v1.ts — Contrato Cinerie -> MNScr. PURO.
 *
 * ESTADO: contrato TIPADO INICIAL. O Cinerie Context Service que o serve NAO faz
 * parte desta fase (ADR 0015, secao 3.2). O que existe aqui e a forma que o
 * servico tera de respeitar quando for implementado.
 *
 * E a SEGUNDA entrada do MNScr. Sem ela, o writer so conhece o que ScreenRant,
 * Variety e Collider disseram; com ela, conhece tambem o episodio, a temporada,
 * o elenco, o trailer e a cobertura anterior que o Cinerie ja tem — e e essa
 * soma que produz a supermateria.
 *
 * Duas regras estruturais atravessam todo o contrato:
 *  1. MIDIA: existir no catalogo NAO autoriza uso editorial. Cada item carrega
 *     as flags de permissao, e a ausencia de permissao e o default.
 *  2. PROVENIENCIA: todo fato declara sua origem. O MNScr organiza e redige,
 *     mas nao e fonte primaria.
 */

import { z } from 'zod'

import {
  LIMITS,
  entityKind,
  factOrigin,
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

export const EDITORIAL_CONTEXT_CONTRACT_VERSION = 'cinerie-editorial-context-v1' as const

/* ------------------------------------------------------------------ */
/* Entidades do catalogo                                               */
/* ------------------------------------------------------------------ */

/** Identificador externo VERIFICADO. Nao verificado nao entra no contexto. */
export const verifiedExternalId = z.object({
  provider: z.enum(['tmdb', 'imdb', 'wikidata']),
  value: stableId,
  url: httpUrl.optional(),
})

export const contextPerson = z.object({
  entityId: stableId,
  name: plainText(LIMITS.shortText),
  slug: slugProposal.optional(),
  canonicalUrl: httpUrl.optional(),
  role: optionalPlainText(LIMITS.shortText),
  character: optionalPlainText(LIMITS.shortText),
  externalIds: z.array(verifiedExternalId).max(10).default([]),
})

export const contextEntity = z.object({
  entityKind,
  entityId: stableId,
  title: plainText(LIMITS.title),
  originalTitle: optionalPlainText(LIMITS.title),
  slug: slugProposal.optional(),
  canonicalUrl: httpUrl.optional(),
  language: languageCode,
  overview: optionalPlainText(LIMITS.summary),
  releaseDate: optionalPlainText(64),
  runtimeMinutes: z.number().int().positive().optional(),
  seasonNumber: z.number().int().min(0).optional(),
  episodeNumber: z.number().int().min(0).optional(),
  parentEntityId: stableId.optional(),
  externalIds: z.array(verifiedExternalId).max(10).default([]),
  cast: z.array(contextPerson).max(200).default([]),
  crew: z.array(contextPerson).max(200).default([]),
  origin: factOrigin,
})

/** Relacao entre entidades (franquia, cronologia, sequencia). */
export const contextRelation = z.object({
  fromEntityId: stableId,
  toEntityId: stableId,
  relation: z.enum(['belongs_to_franchise', 'season_of', 'episode_of', 'follows', 'precedes']),
  order: z.number().int().min(0).optional(),
})

/* ------------------------------------------------------------------ */
/* Midia: existir != poder usar                                        */
/* ------------------------------------------------------------------ */

export const MEDIA_LICENSE_STATUSES = [
  'unknown',
  'pending',
  'approved',
  'restricted',
  'expired',
  'prohibited',
] as const

export const mediaLicenseStatus = z.enum(MEDIA_LICENSE_STATUSES)
export type MediaLicenseStatus = (typeof MEDIA_LICENSE_STATUSES)[number]

/**
 * Item de midia com AUTORIZACAO explicita.
 *
 * As tres flags `allowedFor*` sao obrigatorias e sem default permissivo: um
 * contrato que as tornasse opcionais permitiria "esqueci de declarar" virar
 * "pode usar". O consumidor deve tratar ausencia de permissao como proibicao.
 */
export const contextMedia = z.object({
  mediaId: stableId,
  kind: z.enum(['image', 'video', 'trailer']),
  url: httpUrl,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  aspectRatio: optionalPlainText(16),
  alt: optionalPlainText(LIMITS.shortText),
  caption: optionalPlainText(LIMITS.shortText),
  credit: optionalPlainText(LIMITS.shortText),
  sourceName: optionalPlainText(LIMITS.shortText),
  rightsHolder: optionalPlainText(LIMITS.shortText),
  licenseStatus: mediaLicenseStatus,
  licenseReference: optionalPlainText(LIMITS.shortText),
  licenseExpiresAt: isoDateTime.optional(),
  requiresAttribution: z.boolean(),
  allowedForEditorial: z.boolean(),
  allowedForHero: z.boolean(),
  allowedForSocial: z.boolean(),
  restrictions: z.array(plainText(LIMITS.shortText)).max(20).default([]),
  origin: factOrigin,
})
export type ContextMedia = z.infer<typeof contextMedia>

/**
 * Um item de midia pode ser usado editorialmente?
 *
 * FAIL-CLOSED e explicito: so `approved` passa, e `allowedForEditorial` precisa
 * ser `true` (nao "diferente de false"). Esta funcao existe no contrato para que
 * consumidor e produtor apliquem a MESMA regra.
 */
export function isMediaUsableForEditorial(media: ContextMedia): boolean {
  if (media.licenseStatus !== 'approved') return false
  if (media.allowedForEditorial !== true) return false
  return true
}

/* ------------------------------------------------------------------ */
/* Cobertura editorial anterior                                        */
/* ------------------------------------------------------------------ */

/** Materia ja publicada. Base da decisao criar/atualizar/consolidar. */
export const contextPublishedArticle = z.object({
  articleId: stableId,
  title: plainText(LIMITS.title),
  slug: slugProposal,
  canonicalUrl: httpUrl,
  summary: optionalPlainText(LIMITS.summary),
  contentType: z.enum(['news', 'feature', 'guide', 'list', 'interview', 'evergreen']),
  publishedAt: isoDateTime,
  updatedAt: isoDateTime.optional(),
  language: languageCode,
  /** Entidades ja ligadas a esta materia. */
  linkedEntityIds: z.array(stableId).max(100).default([]),
  /** Cluster de origem, quando a materia veio do pipeline. */
  sourceClusterId: stableId.optional(),
})

/** Ponto de uma cronologia de cobertura sobre o mesmo assunto. */
export const contextCoverageTimelineEntry = z.object({
  articleId: stableId,
  occurredAt: isoDateTime,
  headline: plainText(LIMITS.title),
})

/* ------------------------------------------------------------------ */
/* Contrato                                                            */
/* ------------------------------------------------------------------ */

export const cinerieEditorialContextV1 = z
  .object({
    contractVersion: z.literal(EDITORIAL_CONTEXT_CONTRACT_VERSION),

    /** Eco do pedido: para qual acontecimento este contexto foi montado. */
    requestId: stableId,
    sourceClusterId: stableId.optional(),
    language: languageCode,
    generatedAt: isoDateTime,

    entities: z.array(contextEntity).max(100).default([]),
    relations: z.array(contextRelation).max(500).default([]),
    media: z.array(contextMedia).max(200).default([]),

    publishedArticles: z.array(contextPublishedArticle).max(100).default([]),
    coverageTimeline: z.array(contextCoverageTimelineEntry).max(200).default([]),

    /**
     * Disponibilidade AUTORIZADA (onde assistir). Ausencia significa "nao
     * confirmado", nunca "nao existe" — o writer nao pode afirmar streaming
     * sem confirmacao.
     */
    availability: z
      .array(
        z.object({
          entityId: stableId,
          country: z.string().length(2),
          providerName: plainText(LIMITS.shortText),
          offerType: z.enum(['flatrate', 'rent', 'buy', 'free', 'ads']),
          url: httpUrl.optional(),
          displayAllowed: z.literal(true),
          attributionText: optionalPlainText(LIMITS.shortText),
          updatedAt: isoDateTime.optional(),
        }),
      )
      .max(200)
      .default([]),

    /**
     * Campos que o servico DELIBERADAMENTE nao pode entregar nesta resposta
     * (licenca ausente, dado privado, entidade sem traducao). Explicitar a
     * lacuna evita que o writer trate ausencia como inexistencia.
     */
    omissions: z
      .array(
        z.object({
          scope: z.enum(['entity', 'media', 'availability', 'article']),
          ref: stableId.optional(),
          reason: z.enum([
            'license_unknown',
            'license_blocked',
            'not_translated',
            'not_published',
            'private_data',
          ]),
        }),
      )
      .max(200)
      .default([]),
  })
  .strict()
  .superRefine((context, ctx) => {
    // Relacao apontando para entidade ausente do payload faria o writer inferir
    // uma ligacao que ele nao consegue verificar.
    const entityIds = new Set(context.entities.map((entity) => entity.entityId))
    for (const [index, relation] of context.relations.entries()) {
      if (!entityIds.has(relation.fromEntityId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['relations', index, 'fromEntityId'],
          message: `entidade ausente do contexto: ${relation.fromEntityId}`,
        })
      }
    }

    // Midia com atribuicao exigida e sem credito nao pode sequer ser oferecida.
    for (const [index, media] of context.media.entries()) {
      if (media.requiresAttribution && (media.credit ?? '').trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['media', index, 'credit'],
          message: 'midia com requiresAttribution exige credit preenchido',
        })
      }
      // Hero/social sao subconjuntos de uso editorial: liberar um deles sem
      // liberar o uso editorial e uma permissao incoerente.
      if ((media.allowedForHero || media.allowedForSocial) && !media.allowedForEditorial) {
        ctx.addIssue({
          code: 'custom',
          path: ['media', index, 'allowedForEditorial'],
          message: 'allowedForHero/allowedForSocial exigem allowedForEditorial',
        })
      }
    }
  })

export type CinerieEditorialContextV1 = z.infer<typeof cinerieEditorialContextV1>

export function parseCinerieEditorialContextV1(
  input: unknown,
): ContractParse<CinerieEditorialContextV1> {
  return parseContract(cinerieEditorialContextV1, input)
}
