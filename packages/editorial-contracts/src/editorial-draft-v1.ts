/**
 * editorial-draft-v1.ts — Contrato MNScr -> Payload. PURO.
 *
 * O que o writer externo pode PROPOR. Nada aqui autoriza publicacao: o contrato
 * recusa `publish`, `autoPublish` e qualquer campo equivalente na origem, para
 * que "publicar" nunca seja alcancavel por um payload bem formado. Publicacao e
 * ato humano no Payload (ADR 0015).
 */

import { z } from 'zod'

import { editorialBody } from './blocks.js'
import {
  LIMITS,
  contentHash,
  entityKind,
  factOrigin,
  httpUrl,
  isoDateTime,
  languageCode,
  optionalPlainText,
  parseContract,
  plainText,
  provenanceRef,
  slugProposal,
  stableId,
  type ContractParse,
} from './common.js'

export const EDITORIAL_DRAFT_CONTRACT_VERSION = 'editorial-draft-v1' as const

/* ------------------------------------------------------------------ */
/* Acao proposta                                                       */
/* ------------------------------------------------------------------ */

/**
 * O que o writer PROPOE fazer. Note o que NAO existe aqui: `publish`.
 * O MNScr propoe; o humano decide (ADR 0015, secao 3.1).
 */
export const PROPOSED_ACTIONS = ['create', 'update', 'link', 'consolidate'] as const
export const proposedAction = z.enum(PROPOSED_ACTIONS)
export type ProposedAction = (typeof PROPOSED_ACTIONS)[number]

/** Chaves recusadas em qualquer nivel do payload (defesa em profundidade). */
export const FORBIDDEN_DRAFT_KEYS = [
  'publish',
  'published',
  'autopublish',
  'auto_publish',
  'bypassreview',
  'bypass_review',
  'skipreview',
  'skip_review',
  'forcepublish',
  'force_publish',
  'publishnow',
  'publish_now',
  'workflowstatus',
  'workflow_status',
  '_status',
] as const

const FORBIDDEN_KEY_SET: ReadonlySet<string> = new Set(FORBIDDEN_DRAFT_KEYS)

/**
 * Varre o payload cru em busca de chave de auto-publicacao, em QUALQUER nivel.
 *
 * A tipagem do contrato ja ignoraria campos desconhecidos, mas ignorar em
 * silencio e diferente de recusar: se um pipeline passar a enviar
 * `autoPublish: true`, queremos falha explicita e nao um sucesso que esconde a
 * intencao. Comparacao case-insensitive e sem underscore.
 */
export function findForbiddenPublishKey(input: unknown, depth = 0): string | null {
  if (depth > 12 || input === null || typeof input !== 'object') return null
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findForbiddenPublishKey(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_SET.has(key.toLowerCase())) return key
    const found = findForbiddenPublishKey(value, depth + 1)
    if (found !== null) return found
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Blocos de apoio                                                     */
/* ------------------------------------------------------------------ */

/** Fonte externa citada, com o direito de uso DECLARADO pela origem. */
export const externalSource = z.object({
  id: stableId,
  name: plainText(LIMITS.shortText),
  url: httpUrl,
  publishedAt: isoDateTime.optional(),
  /** `primary` sustenta o fato central; as demais corroboram. */
  role: z.enum(['primary', 'secondary', 'press_release', 'catalog']),
  /** Id do item recebido pelo pipeline de origem, quando houver. */
  sourceItemRef: stableId.optional(),
})
export type ExternalSource = z.infer<typeof externalSource>

/** Afirmacao com evidencia. Conflito NAO e resolvido em silencio pela IA. */
export const claim = z.object({
  id: stableId,
  text: plainText(LIMITS.blockText),
  origin: factOrigin,
  /** Fontes que sustentam a afirmacao (ids de `externalSources`). */
  sourceRefs: z.array(stableId).max(LIMITS.externalSources).default([]),
  confidence: z.number().min(0).max(1).optional(),
  /** Quando fontes divergem, o conflito e EXPLICITADO, nunca escolhido. */
  conflictsWith: z.array(stableId).max(20).optional(),
})
export type Claim = z.infer<typeof claim>

/** Item do contexto interno do Cinerie efetivamente usado na redacao. */
export const internalContextUse = z.object({
  kind: z.enum(['entity', 'article', 'media', 'availability']),
  ref: stableId,
  /** Como foi usado: enriquecer, comparar, ligar, contextualizar. */
  usage: z.enum(['enrich', 'compare', 'link', 'context']),
})
export type InternalContextUse = z.infer<typeof internalContextUse>

/** Entidade SUGERIDA. O revisor confirma, corrige ou remove (ADR 0015). */
export const entitySuggestion = z.object({
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
  confidence: z.number().min(0).max(1),
  origin: factOrigin,
  /** O writer NUNCA marca como verificado: isso e decisao humana. */
  verified: z.literal(false).default(false),
})
export type EntitySuggestion = z.infer<typeof entitySuggestion>

/**
 * Midia CANDIDATA. Existir no catalogo nao autoriza uso editorial (ADR 0015,
 * secao 3.3) — por isso nao ha campo de aprovacao aqui.
 */
export const mediaCandidate = z.object({
  id: stableId,
  /** Item ja existente no acervo do Cinerie, quando for o caso. */
  mediaRef: stableId.optional(),
  url: httpUrl.optional(),
  kind: z.enum(['image', 'video', 'trailer']),
  alt: optionalPlainText(LIMITS.shortText),
  caption: optionalPlainText(LIMITS.shortText),
  credit: optionalPlainText(LIMITS.shortText),
  sourceName: optionalPlainText(LIMITS.shortText),
  sourceUrl: httpUrl.optional(),
  origin: factOrigin,
  /** Intencao de uso; a autorizacao real e verificada no CMS. */
  intendedUse: z.enum(['hero', 'inline', 'gallery', 'social']),
})
export type MediaCandidate = z.infer<typeof mediaCandidate>

/** Proposta de SEO. Sugestao, nunca decisao final. */
export const seoProposal = z.object({
  metaTitle: optionalPlainText(LIMITS.title),
  metaDescription: optionalPlainText(LIMITS.summary),
  socialTitle: optionalPlainText(LIMITS.title),
  socialDescription: optionalPlainText(LIMITS.summary),
})
export type SeoProposal = z.infer<typeof seoProposal>

/** Proveniencia agregada do draft. */
export const draftProvenance = z.object({
  pipeline: plainText(LIMITS.shortText),
  model: optionalPlainText(LIMITS.shortText),
  promptVersion: optionalPlainText(LIMITS.shortText),
  inputHash: contentHash,
  refs: z.array(provenanceRef).max(200).default([]),
})
export type DraftProvenance = z.infer<typeof draftProvenance>

/** Resultado do QA do proprio writer. Informativo; o CMS revalida. */
export const draftQa = z.object({
  version: plainText(LIMITS.shortText),
  passed: z.boolean(),
  warnings: z.array(plainText(LIMITS.shortText)).max(100).default([]),
  blockingErrors: z.array(plainText(LIMITS.shortText)).max(100).default([]),
})
export type DraftQa = z.infer<typeof draftQa>

/* ------------------------------------------------------------------ */
/* Contrato                                                            */
/* ------------------------------------------------------------------ */

export const editorialDraftV1 = z
  .object({
    contractVersion: z.literal(EDITORIAL_DRAFT_CONTRACT_VERSION),

    // Identidade e idempotencia
    draftId: stableId,
    idempotencyKey: stableId,
    sourceClusterId: stableId,
    sourceRevision: z.number().int().min(0),
    sourcePayloadHash: contentHash,

    // Intencao
    proposedAction,
    targetArticleId: stableId.optional(),

    // Forma editorial
    contentType: z.enum(['news', 'feature', 'guide', 'list', 'interview', 'evergreen']),
    language: languageCode,
    title: plainText(LIMITS.title),
    subtitle: optionalPlainText(LIMITS.subtitle),
    summary: plainText(LIMITS.summary),
    slugProposal,
    blocks: editorialBody,

    // Lastro factual
    externalSources: z.array(externalSource).max(LIMITS.externalSources).default([]),
    claimsUsed: z.array(claim).max(LIMITS.claims).default([]),
    internalContextUsed: z.array(internalContextUse).max(LIMITS.internalContext).default([]),
    entitySuggestions: z.array(entitySuggestion).max(LIMITS.entitySuggestions).default([]),
    mediaCandidates: z.array(mediaCandidate).max(LIMITS.mediaCandidates).default([]),

    seoProposal: seoProposal.optional(),
    provenance: draftProvenance,
    qa: draftQa,

    generatedAt: isoDateTime,
    pipelineVersion: plainText(LIMITS.shortText),
  })
  .strict()
  .superRefine((draft, ctx) => {
    // `update`, `link` e `consolidate` agem sobre um artigo existente. Sem alvo,
    // o endpoint teria de adivinhar qual — e adivinhar aqui significa sobrescrever
    // a materia errada.
    if (draft.proposedAction !== 'create' && draft.targetArticleId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetArticleId'],
        message: `proposedAction "${draft.proposedAction}" exige targetArticleId`,
      })
    }
    if (draft.proposedAction === 'create' && draft.targetArticleId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetArticleId'],
        message: 'proposedAction "create" nao pode declarar targetArticleId',
      })
    }

    // Toda referencia a fonte precisa existir em `externalSources`. Um claim que
    // aponta para uma fonte inexistente e um fato sem lastro com aparencia de
    // fato com lastro — pior do que um fato sem fonte declarada.
    const sourceIds = new Set(draft.externalSources.map((source) => source.id))
    for (const [index, entry] of draft.claimsUsed.entries()) {
      for (const [refIndex, ref] of entry.sourceRefs.entries()) {
        if (!sourceIds.has(ref)) {
          ctx.addIssue({
            code: 'custom',
            path: ['claimsUsed', index, 'sourceRefs', refIndex],
            message: `sourceRef inexistente em externalSources: ${ref}`,
          })
        }
      }
    }
    for (const [index, block] of draft.blocks.entries()) {
      if (block.type !== 'sourceList') continue
      for (const [refIndex, ref] of block.sourceRefs.entries()) {
        if (!sourceIds.has(ref)) {
          ctx.addIssue({
            code: 'custom',
            path: ['blocks', index, 'sourceRefs', refIndex],
            message: `sourceRef inexistente em externalSources: ${ref}`,
          })
        }
      }
    }

    // Bloco de imagem precisa apontar para uma midia candidata declarada.
    const mediaIds = new Set(draft.mediaCandidates.map((media) => media.id))
    for (const [index, block] of draft.blocks.entries()) {
      if (block.type !== 'image') continue
      if (!mediaIds.has(block.mediaRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', index, 'mediaRef'],
          message: `mediaRef inexistente em mediaCandidates: ${block.mediaRef}`,
        })
      }
    }

    // Materia assistida por IA sem nenhuma fonte externa e paráfrase sem lastro.
    const usesExternalFact = draft.claimsUsed.some((c) => c.origin === 'external_source')
    if (usesExternalFact && draft.externalSources.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['externalSources'],
        message: 'ha claim de origem external_source sem nenhuma fonte declarada',
      })
    }
  })

export type EditorialDraftV1 = z.infer<typeof editorialDraftV1>

/**
 * Parse do contrato + varredura anti auto-publicacao.
 *
 * A varredura roda ANTES do schema: `.strict()` ja rejeitaria a chave extra, mas
 * com uma mensagem generica de "campo desconhecido". Aqui o motivo fica explicito
 * — quem enviou precisa saber que tentou publicar, nao que errou o formato.
 */
export function parseEditorialDraftV1(input: unknown): ContractParse<EditorialDraftV1> {
  const forbidden = findForbiddenPublishKey(input)
  if (forbidden !== null) {
    return {
      ok: false,
      issues: [
        {
          path: '(payload)',
          message: `campo proibido no contrato de draft: "${forbidden}" — o writer nunca publica`,
        },
      ],
    }
  }
  return parseContract(editorialDraftV1, input)
}
