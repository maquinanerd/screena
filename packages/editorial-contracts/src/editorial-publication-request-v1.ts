/**
 * editorial-publication-request-v1.ts — MNScr PEDE publicacao. PURO.
 *
 * MUDANCA DE POSTURA, DELIBERADA E LIMITADA. Ate aqui o MNScr so propunha
 * (`editorial-draft-v1`, cujo comentario diz "note o que NAO existe aqui:
 * publish"). Agora ele pode PEDIR publicacao — e o verbo continua sendo *pedir*.
 *
 * O que muda: existe um caminho automatico.
 * O que NAO muda: quem decide continua sendo o Payload. Autor autorizado, QA
 * aprovado, fontes, midia licenciada, SEO valido, limites e kill switch sao
 * revalidados no servidor. Um pedido invalido nao vira materia publicada — vira
 * `ROUTED_TO_REVIEW` ou `BLOCKED`.
 *
 * AUTOR PUBLICO != ATOR TECNICO. A materia sai assinada por uma entidade
 * `Author` previamente autorizada; a service account do MNScr fica registrada na
 * auditoria. Colapsar os dois faria a automacao virar "autor" na ficha publica,
 * o que e falso, ou esconderia quem operou, o que e pior.
 */

import { z } from 'zod'

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
  schemaHash,
  stableId,
  type ContractParse,
} from './common.js'
import { editorialSeoProposal, findForbiddenSeoKey } from './seo-proposal.js'

/**
 * NOME e VERSAO sao conceitos SEPARADOS.
 *
 * O nome identifica o contrato (e carrega o `-v1` porque uma quebra
 * incompativel cria um contrato NOVO, com outro nome). A versao evolui dentro
 * dele: `1.1.0` acrescenta campo opcional, `1.0.1` corrige documentacao. Colapsar
 * os dois — como estava — impediria dizer "mesmo contrato, versao mais nova".
 */
export const EDITORIAL_PUBLICATION_REQUEST_NAME = 'editorial-publication-request-v1' as const
export const EDITORIAL_PUBLICATION_REQUEST_VERSION = '1.1.0' as const

/**
 * Versao anterior, aceita durante a virada.
 *
 * O hash e o do JSON Schema de `1.0.0` — o que o MNScr declarou em toda
 * publicacao ate 28/08/2026. Ele fica ESCRITO, e nao recalculado, porque o
 * schema que o produziu nao existe mais neste repositorio: recalcular daria o
 * hash do schema NOVO com o rotulo do antigo, que e exatamente a confusao que a
 * checagem existe para pegar.
 */
export const EDITORIAL_PUBLICATION_REQUEST_SUPERSEDED = [
  {
    version: '1.0.0',
    schemaHash:
      'sha256:930243294465802778f73151d53ee510a2313d44673de9e6e7866032bfe6c6f8',
  },
] as const

/* ------------------------------------------------------------------ */
/* Intencao                                                            */
/* ------------------------------------------------------------------ */

/**
 * O que o pedido quer que aconteca.
 *
 * `publish` e `update` sao os unicos: `link` e `consolidate` do draft nao fazem
 * sentido num pedido de publicacao — sao operacoes de curadoria que exigem
 * julgamento humano.
 */
export const PUBLICATION_INTENTS = ['publish', 'update'] as const
export const publicationIntent = z.enum(PUBLICATION_INTENTS)
export type PublicationIntent = (typeof PUBLICATION_INTENTS)[number]

/**
 * Como a autoria e apresentada ao leitor.
 *
 * `byline` assina com o nome do autor; `newsroom` assina como redacao;
 * `assisted` sinaliza publicamente que houve assistencia automatizada. A escolha
 * NAO e livre: a politica do proprio autor (`automationAttributionMode`) decide
 * o que ele aceita.
 */
export const ATTRIBUTION_MODES = ['byline', 'newsroom', 'assisted'] as const
export const attributionMode = z.enum(ATTRIBUTION_MODES)
export type AttributionMode = (typeof ATTRIBUTION_MODES)[number]

/**
 * Tipos editoriais aceitos.
 *
 * `review` foi acrescentado nesta revisao: o contrato aceitava
 * `schemaTypeRecommendation: 'Review'` sem ter um `contentType` correspondente —
 * uma resenha so podia se declarar `feature`, e a matriz de coerencia nao tinha
 * como validar nada.
 */
export const PUBLICATION_CONTENT_TYPES = [
  'news',
  'feature',
  'review',
  'guide',
  'list',
  'interview',
  'evergreen',
] as const
export const publicationContentType = z.enum(PUBLICATION_CONTENT_TYPES)
export type PublicationContentType = (typeof PUBLICATION_CONTENT_TYPES)[number]

/* ------------------------------------------------------------------ */
/* Chaves proibidas                                                    */
/* ------------------------------------------------------------------ */

/**
 * Chaves recusadas em qualquer nivel.
 *
 * Note a diferenca em relacao ao draft: aqui `publish` E permitido como
 * INTENCAO declarada (`publicationIntent`), porque este contrato existe para
 * isso. O que continua proibido e o produtor tentar escrever DIRETAMENTE o
 * estado publico — `_status`, `workflowStatus`, `bypassReview`, `index_status`.
 *
 * A distincao e o coracao da fase: pedir publicacao e legitimo; decidir o estado
 * publico nao e.
 */
export const FORBIDDEN_PUBLICATION_KEYS = [
  // --- Estado publico: quem decide e o Payload -----------------------
  'bypassreview',
  'skipreview',
  'forcepublish',
  'workflowstatus',
  '_status',
  'reviewstatus',
  'indexstatus',
  'publishedat',
  'datepublished',
  'datemodified',
  'canonical',
  'robots',
  'jsonld',

  // --- IDENTIDADE TECNICA: derivada de `req.user`, nunca declarada ---
  //
  // O produtor prova quem e pela CREDENCIAL, nao por um campo do corpo. Se
  // pudesse declarar `serviceAccountId` ou `scopes`, a auditoria passaria a
  // registrar o que o cliente disse ser — e um cliente comprometido assinaria
  // as proprias acoes com a identidade de outro.
  //
  // `.strict()` ja recusaria estes campos, mas com "unrecognized key". Nomea-los
  // aqui produz uma mensagem que ENSINA: o pipeline para de mandar em vez de
  // tentar de novo.
  'technicalactor',
  'technicalactorid',
  'serviceaccount',
  'serviceaccountid',
  'serviceaccountlabel',
  'actor',
  'actorid',
  'publishedby',
  'createdby',
  'updatedby',
  'scopes',
  'scope',
  'authenticatedas',

] as const

/**
 * Nomes de SEO recusados APENAS NO NIVEL SUPERIOR.
 *
 * Profundidade diferente por um motivo concreto: `metaDescription`,
 * `slugSuggestion` e `focusKeyphrase` sao os campos REAIS dentro de `seo`.
 * Varre-los recursivamente recusaria o proprio objeto valido — foi exatamente o
 * que aconteceu na primeira versao desta lista.
 *
 * No topo, porem, eles seriam uma SEGUNDA origem para titulo, meta e slug, e a
 * pergunta "qual vence?" nao tem resposta boa.
 */
export const FORBIDDEN_TOP_LEVEL_SEO_KEYS = [
  'seoproposal',
  'metatitle',
  'metadescription',
  'slugproposal',
  'slugsuggestion',
  'focuskeyphrase',
  'schematyperecommendation',
  'articlesection',
] as const

const FORBIDDEN_TOP_LEVEL_SEO_SET: ReadonlySet<string> = new Set(FORBIDDEN_TOP_LEVEL_SEO_KEYS)

/**
 * SEO duplicado no nivel superior?
 *
 * Nao recursivo de proposito (ver o comentario da lista acima).
 */
export function findDuplicateSeoKey(input: unknown): string | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (FORBIDDEN_TOP_LEVEL_SEO_SET.has(key.toLowerCase().replace(/[_-]/g, ''))) return key
  }
  return null
}

const FORBIDDEN_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_PUBLICATION_KEYS.map((key) => key.toLowerCase().replace(/[_-]/g, '')),
)

/** Grupos de recusa, para que a mensagem diga POR QUE aquele campo nao entra. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'technicalactor',
  'technicalactorid',
  'serviceaccount',
  'serviceaccountid',
  'serviceaccountlabel',
  'actor',
  'actorid',
  'publishedby',
  'createdby',
  'updatedby',
  'scopes',
  'scope',
  'authenticatedas',
])

/** Mensagem por GRUPO. Um "unrecognized key" generico nao ensina nada. */
export function explainForbiddenKey(key: string): string {
  const normalized = key.toLowerCase().replace(/[_-]/g, '')
  if (IDENTITY_KEYS.has(normalized)) {
    return 'identidade tecnica e derivada da credencial autenticada (req.user), nunca declarada no corpo'
  }
  return 'campo de estado publico nao pode vir do produtor (o Payload decide publicacao, datas e indexacao)'
}

export function findForbiddenPublicationKey(input: unknown, depth = 0): string | null {
  if (depth > 12 || input === null || typeof input !== 'object') return null
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findForbiddenPublicationKey(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (FORBIDDEN_SET.has(key.toLowerCase().replace(/[_-]/g, ''))) return key
    const found = findForbiddenPublicationKey(value, depth + 1)
    if (found !== null) return found
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Blocos de apoio                                                     */
/* ------------------------------------------------------------------ */

/** Fonte externa com direito de uso declarado pela origem. */
export const publicationSource = z.object({
  id: stableId,
  name: plainText(LIMITS.shortText),
  url: httpUrl,
  publishedAt: isoDateTime.optional(),
  role: z.enum(['primary', 'secondary', 'press_release', 'catalog']),
})

/** Midia ja aprovada no CMS. O pedido REFERENCIA, nunca envia bytes. */
export const publicationMediaRef = z.object({
  mediaId: stableId,
  intendedUse: z.enum(['hero', 'inline', 'gallery', 'social']),
  /** Sugestao de alt; o alt definitivo e decidido no CMS. */
  altSuggestion: optionalPlainText(LIMITS.shortText),
})

export const publicationEntityLink = z.object({
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
})

/** QA do pipeline. `passed: false` nunca publica automaticamente. */
export const publicationQa = z.object({
  version: plainText(LIMITS.shortText),
  passed: z.boolean(),
  warnings: z.array(plainText(LIMITS.shortText)).max(100).default([]),
  blockingErrors: z.array(plainText(LIMITS.shortText)).max(100).default([]),
})

export const publicationProvenance = z.object({
  pipeline: plainText(LIMITS.shortText),
  model: optionalPlainText(LIMITS.shortText),
  promptVersion: optionalPlainText(LIMITS.shortText),
  inputHash: contentHash,
})

/* ------------------------------------------------------------------ */
/* Contrato                                                            */
/* ------------------------------------------------------------------ */

export const editorialPublicationRequestV1 = z
  .object({
    contractName: z.literal(EDITORIAL_PUBLICATION_REQUEST_NAME),
    /**
     * A versao CORRENTE ou uma das superadas.
     *
     * Um `literal` aqui recusaria o emissor antigo antes de
     * `checkContractCompatibility` sequer rodar — e com a mensagem errada, de
     * campo invalido em vez de versao vencida. Quem decide compatibilidade e
     * aquela funcao; este campo so precisa deixar o pedido chegar ate la.
     */
    contractVersion: z.enum([
      EDITORIAL_PUBLICATION_REQUEST_VERSION,
      ...EDITORIAL_PUBLICATION_REQUEST_SUPERSEDED.map((anterior) => anterior.version),
    ]),
    /**
     * Hash do JSON SCHEMA que o produtor usou (`sha256:<hex>`).
     *
     * Mesmo nome que o manifesto e o endpoint de descoberta usam: `schemaHash`.
     * Chamava-se `contractHash` aqui e `schemaHash` la — dois nomes para a mesma
     * coisa, e a ambiguidade custaria uma leitura errada em algum consumidor.
     *
     * Nao confundir com `sourcePayloadHash`, que e hash de CONTEUDO em hex puro.
     * Divergencia aqui falha FECHADO: schema diferente pode ter campo de mesmo
     * nome com outra semantica.
     */
    schemaHash,

    requestId: stableId,
    idempotencyKey: stableId,
    sourceClusterId: stableId,
    sourceRevision: z.number().int().min(0),
    sourcePayloadHash: contentHash,

    publicationIntent,
    targetArticleId: stableId.optional(),

    // Autoria: id do autor PUBLICO, nunca nome livre. Nome livre criaria
    // assinatura por string, sem entidade, sem politica e sem auditoria.
    publicAuthorId: stableId,
    attributionMode,

    contentType: publicationContentType,
    language: languageCode,
    title: plainText(LIMITS.title),
    subtitle: optionalPlainText(LIMITS.subtitle),
    summary: plainText(LIMITS.summary),
    blocks: editorialBody,

    externalSources: z.array(publicationSource).max(LIMITS.externalSources).default([]),
    entityLinks: z.array(publicationEntityLink).max(LIMITS.entitySuggestions).default([]),
    media: z.array(publicationMediaRef).max(LIMITS.mediaCandidates).default([]),

    seo: editorialSeoProposal,
    provenance: publicationProvenance,
    qa: publicationQa,

    generatedAt: isoDateTime,
    pipelineVersion: plainText(LIMITS.shortText),
  })
  .strict()
  .superRefine((request, ctx) => {
    // `update` age sobre um artigo existente. Sem alvo, o servidor teria de
    // adivinhar qual — e adivinhar aqui significa sobrescrever a materia errada.
    if (request.publicationIntent === 'update' && request.targetArticleId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetArticleId'],
        message: 'publicationIntent "update" exige targetArticleId',
      })
    }
    if (request.publicationIntent === 'publish' && request.targetArticleId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetArticleId'],
        message: 'publicationIntent "publish" nao pode declarar targetArticleId',
      })
    }

    // QA reprovado NUNCA publica automaticamente. O pedido nao e recusado por
    // isso — ele e roteado para revisao —, mas o contrato registra a contradicao
    // de um QA que reprova e mesmo assim se declara sem erro bloqueante.
    if (!request.qa.passed && request.qa.blockingErrors.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['qa', 'blockingErrors'],
        message: 'qa.passed=false exige ao menos um blockingError declarado',
      })
    }

    // Publicacao automatica sem fonte externa e parafrase sem lastro.
    if (request.externalSources.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['externalSources'],
        message: 'publicacao automatica exige ao menos uma fonte externa',
      })
    }

    // Uma sugestao de alt precisa apontar para midia DESTE pedido.
    const mediaIds = new Set(request.media.map((item) => item.mediaId))
    for (const [index, suggestion] of request.seo.imageAltSuggestions.entries()) {
      if (!mediaIds.has(suggestion.mediaRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['seo', 'imageAltSuggestions', index, 'mediaRef'],
          message: 'alt sugerido referencia midia que nao esta no pedido',
        })
      }
    }
  })

export type EditorialPublicationRequestV1 = z.infer<typeof editorialPublicationRequestV1>

/**
 * Valida um pedido cru.
 *
 * A varredura de chaves proibidas acontece ANTES do schema, pelo mesmo motivo do
 * draft: `strict()` recusaria a chave desconhecida, mas com uma mensagem
 * generica de "unrecognized key". Nomear o campo proibido diz ao produtor o que
 * ele tentou fazer — e a diferenca entre corrigir o pipeline e tentar de novo.
 */
export function parseEditorialPublicationRequestV1(
  input: unknown,
): ContractParse<EditorialPublicationRequestV1> {
  const forbiddenPublication = findForbiddenPublicationKey(input)
  if (forbiddenPublication !== null) {
    return {
      ok: false,
      issues: [{ path: forbiddenPublication, message: explainForbiddenKey(forbiddenPublication) }],
    }
  }

  const duplicateSeo = findDuplicateSeoKey(input)
  if (duplicateSeo !== null) {
    return {
      ok: false,
      issues: [
        {
          path: duplicateSeo,
          message:
            'SEO tem UMA fonte de verdade neste contrato: o objeto `seo`. Campo solto no nivel superior (ou `seoProposal` do draft) nao e aceito',
        },
      ],
    }
  }

  const forbiddenSeo = findForbiddenSeoKey(input)
  if (forbiddenSeo !== null) {
    return {
      ok: false,
      issues: [
        {
          path: forbiddenSeo,
          message:
            'campo de CMS de terceiro (WordPress/Yoast) ou de SEO tecnico nao e aceito neste contrato',
        },
      ],
    }
  }

  return parseContract(editorialPublicationRequestV1, input)
}
