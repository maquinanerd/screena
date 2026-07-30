/**
 * blocks.ts — Corpo editorial estruturado em BLOCOS discriminados. PURO.
 *
 * O corpo nunca e HTML livre. Cada bloco tem tipo, id estavel, teto de tamanho e
 * proveniencia opcional, e a uniao e discriminada por `type` — o que torna a
 * migracao futura por versao possivel sem adivinhar o formato de linhas antigas.
 */

import { z } from 'zod'

import {
  LIMITS,
  entityKind,
  httpUrl,
  optionalPlainText,
  plainText,
  provenanceRef,
  stableId,
} from './common.js'

/** Campos comuns a todo bloco. */
const blockBase = {
  /** Id estavel dentro do documento: permite ancorar comentario e correcao. */
  id: stableId,
  /** De onde veio o conteudo deste bloco especifico. */
  provenance: z.array(provenanceRef).max(10).optional(),
}

export const paragraphBlock = z.object({
  ...blockBase,
  type: z.literal('paragraph'),
  text: plainText(LIMITS.blockText),
})

export const headingBlock = z.object({
  ...blockBase,
  type: z.literal('heading'),
  /** `h1` e do titulo da pagina; o corpo comeca em `h2`. */
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: plainText(LIMITS.shortText),
})

export const imageBlock = z.object({
  ...blockBase,
  type: z.literal('image'),
  /** Referencia a um item de midia CANDIDATA; aprovacao e humana. */
  mediaRef: stableId,
  alt: plainText(LIMITS.shortText),
  caption: optionalPlainText(LIMITS.shortText),
  credit: optionalPlainText(LIMITS.shortText),
})

export const videoBlock = z.object({
  ...blockBase,
  type: z.literal('video'),
  provider: z.enum(['youtube', 'vimeo', 'internal']),
  externalId: stableId.optional(),
  url: httpUrl.optional(),
  title: optionalPlainText(LIMITS.shortText),
  credit: optionalPlainText(LIMITS.shortText),
})

export const quoteBlock = z.object({
  ...blockBase,
  type: z.literal('quote'),
  text: plainText(LIMITS.blockText),
  attribution: optionalPlainText(LIMITS.shortText),
  /** Citacao de terceiro exige origem: sem ela, vira afirmacao sem lastro. */
  sourceRef: stableId.optional(),
})

export const entityCardBlock = z.object({
  ...blockBase,
  type: z.literal('entityCard'),
  entityKind,
  /** Id interno do Cinerie; o writer NAO cria entidade. */
  entityId: stableId,
  note: optionalPlainText(LIMITS.shortText),
})

export const factBoxBlock = z.object({
  ...blockBase,
  type: z.literal('factBox'),
  title: plainText(LIMITS.shortText),
  items: z
    .array(
      z.object({
        label: plainText(LIMITS.shortText),
        value: plainText(LIMITS.shortText),
      }),
    )
    .min(1)
    .max(30),
})

export const relatedContentBlock = z.object({
  ...blockBase,
  type: z.literal('relatedContent'),
  /** Artigos ja publicados no Cinerie, por id interno. */
  articleRefs: z.array(stableId).min(1).max(20),
})

export const sourceListBlock = z.object({
  ...blockBase,
  type: z.literal('sourceList'),
  /** Aponta para `externalSources` do draft, por id — nunca duplica a fonte. */
  sourceRefs: z.array(stableId).min(1).max(LIMITS.externalSources),
})

export const dividerBlock = z.object({
  ...blockBase,
  type: z.literal('divider'),
})

/** Uniao discriminada de todos os blocos suportados. */
export const editorialBlock = z.discriminatedUnion('type', [
  paragraphBlock,
  headingBlock,
  imageBlock,
  videoBlock,
  quoteBlock,
  entityCardBlock,
  factBoxBlock,
  relatedContentBlock,
  sourceListBlock,
  dividerBlock,
])

export type EditorialBlock = z.infer<typeof editorialBlock>

/** Nomes de tipo de bloco suportados (fonte unica para o CMS espelhar). */
export const EDITORIAL_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'image',
  'video',
  'quote',
  'entityCard',
  'factBox',
  'relatedContent',
  'sourceList',
  'divider',
] as const

export type EditorialBlockType = (typeof EDITORIAL_BLOCK_TYPES)[number]

/**
 * Corpo do artigo: lista de blocos com teto e ids UNICOS.
 *
 * Id repetido quebra ancoragem de comentario e de correcao, e faz duas versoes
 * do mesmo documento apontarem para o "mesmo" bloco sendo outro — por isso e
 * erro de contrato, nao aviso.
 */
export const editorialBody = z
  .array(editorialBlock)
  .min(1, 'corpo vazio')
  .max(LIMITS.blocks, `corpo acima do limite de ${LIMITS.blocks} blocos`)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>()
    for (const [index, block] of blocks.entries()) {
      if (seen.has(block.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `id de bloco duplicado: ${block.id}`,
        })
      }
      seen.add(block.id)
    }
  })

export type EditorialBody = z.infer<typeof editorialBody>
