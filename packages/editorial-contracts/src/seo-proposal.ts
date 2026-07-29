/**
 * seo-proposal.ts — Sugestao de SEO vinda do pipeline. PURO.
 *
 * A palavra do nome importa: **proposal**. Tudo aqui e SUGESTAO. O que o MNScr
 * manda passa por revalidacao no Payload, normalizacao (slug) e decisao final do
 * lado publico. Nada nesta estrutura controla, direta ou indiretamente:
 * canonical, robots, index/noindex, datas, publisher, breadcrumbs, hreflang,
 * redirects, sitemap ou JSON-LD final.
 *
 * NEUTRO POR CONSTRUCAO. Nao ha `yoast_*`, nao ha `post_status`, nao ha nada com
 * forma de WordPress. A razao nao e estetica: aceitar o objeto de um CMS de
 * terceiro faria a semantica DELE virar a nossa por acidente — e o primeiro
 * campo que entrasse arrastaria os proximos.
 */

import { z } from 'zod'

import {
  LIMITS,
  optionalPlainText,
  plainText,
  slugProposal,
  stableId,
} from './common.js'

export const SEO_PROPOSAL_VERSION = 'seo-proposal-v1' as const

/* ------------------------------------------------------------------ */
/* Politica canonica de tamanho                                        */
/* ------------------------------------------------------------------ */

/**
 * UMA fonte de verdade para os limites de SEO.
 *
 * Estes numeros vivem aqui e sao importados pelo contrato, pela validacao do
 * Payload e pelos testes. Duplica-los produziria o classico: o contrato aceita
 * 70 caracteres, a validacao recusa acima de 60, e a materia fica presa num
 * limbo em que o pipeline nao entende a recusa.
 *
 * Os valores refletem o que os buscadores costumam exibir, com folga: um titulo
 * mais longo nao e invalido, e so trunca na SERP. Por isso `max` bloqueia e
 * `idealMax` apenas avisa.
 */
export const SEO_POLICY = {
  // TRANSPORTE (o que o schema aceita) x AUTO-PUBLICACAO (o que sai sem humano).
  //
  // A faixa ampla existe para o CMS RECEBER material imperfeito destinado a
  // revisao. Publicar automaticamente so porque passou no transporte seria
  // confundir "cabe no campo" com "esta bom o suficiente para ir ao ar sozinho".
  title: { min: 15, idealMax: 60, max: 120, autoMin: 15, autoMax: 65 },
  metaDescription: {
    min: 70,
    idealMax: 160,
    max: 320,
    autoMin: 120,
    autoMax: 160,
    // Faixa preferencial da redacao. DOCUMENTADA, nao bloqueante: 120-160
    // continua elegivel, e apertar aqui rejeitaria material bom.
    editorialMin: 140,
    editorialMax: 155,
  },
  focusKeyphrase: { min: 2, max: 80 },
  relatedKeyphrases: { max: 10, itemMax: 80 },
  editorialKeywords: { max: 20, itemMax: 60 },
  socialTitle: { max: 120 },
  socialDescription: { max: 220 },
  imageAlt: { min: 4, max: 200, max_items: 20 },
  internalLinks: { max: 20 },
  /**
   * Repeticoes da mesma keyphrase toleradas no conjunto de campos SEO.
   *
   * Acima disso e stuffing: o texto passa a ser escrito para o robo, e o
   * resultado pratico e rebaixamento, nao ganho.
   */
  maxKeyphraseRepetition: 3,
} as const

/* ------------------------------------------------------------------ */
/* Chaves proibidas                                                    */
/* ------------------------------------------------------------------ */

/**
 * Campos de CMS de terceiro recusados em QUALQUER profundidade.
 *
 * Dois grupos, com motivos diferentes:
 *
 *  - `yoast_*` e afins trazem a semantica de outro plugin (inclusive controle de
 *    index/canonical) para dentro de um contrato que declara nao ter isso;
 *  - `post_status`, `wp_post` e afins sao PUBLICACAO DIRETA: aceitar um deles
 *    seria deixar o produtor decidir o estado publico, exatamente o que a
 *    revalidacao no Payload existe para impedir.
 */
export const FORBIDDEN_SEO_KEYS = [
  'yoast_meta',
  'yoast',
  '_yoast_wpseo_title',
  '_yoast_wpseo_metadesc',
  '_yoast_wpseo_focuskw',
  '_yoast_wpseo_canonical',
  '_yoast_wpseo_meta-robots-noindex',
  '_yoast_news_keywords',
  'post_status',
  'poststatus',
  'wp_post',
  'wppost',
  'wordpress',
  'rank_math',
  'rankmath',
  'aioseo',
  // Campos tecnicos que pertencem ao lado publico, nunca ao produtor.
  'canonical',
  'canonicalurl',
  'canonical_url',
  'robots',
  'noindex',
  'index_status',
  'indexstatus',
  'jsonld',
  'json_ld',
  'schema_json',
  'datepublished',
  'date_published',
  'datemodified',
  'date_modified',
  'publisher',
  'hreflang',
  'sitemap',
] as const

const FORBIDDEN_SEO_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_SEO_KEYS.map((key) => key.toLowerCase().replace(/[_-]/g, '')),
)

/**
 * Varre o payload cru procurando campo proibido, em qualquer nivel.
 *
 * Comparacao sem underscore/hifen e case-insensitive: `post_status`,
 * `postStatus` e `POST-STATUS` sao a mesma tentativa.
 *
 * Recusar e diferente de ignorar. O Zod descartaria a chave desconhecida em
 * silencio, e o produtor continuaria mandando — achando que funciona.
 */
export function findForbiddenSeoKey(input: unknown, depth = 0): string | null {
  if (depth > 12 || input === null || typeof input !== 'object') return null
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findForbiddenSeoKey(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (FORBIDDEN_SEO_SET.has(key.toLowerCase().replace(/[_-]/g, ''))) return key
    const found = findForbiddenSeoKey(value, depth + 1)
    if (found !== null) return found
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Schema.org recomendado                                              */
/* ------------------------------------------------------------------ */

/**
 * Tipos que o pipeline pode RECOMENDAR.
 *
 * `HowTo` exige passos executaveis reais e `Review` exige avaliacao real — a
 * compatibilidade com os blocos e verificada no Payload, nao aqui: o contrato
 * nao ve o corpo final.
 */
export const SCHEMA_TYPE_RECOMMENDATIONS = [
  'NewsArticle',
  'Article',
  'Review',
  'ItemList',
  'HowTo',
] as const

/**
 * MATRIZ contentType x Schema.org.
 *
 * `Article` e o fallback aceito em todos: ele nao promete estrutura nenhuma, e
 * por isso nunca produz structured data falso. Os demais prometem algo — passos,
 * itens, avaliacao — e a promessa e verificada contra o CORPO no servidor.
 *
 * Uma combinacao FORA da matriz e ambiguidade de classificacao, nao conteudo
 * invalido: vai para revisao humana. Uma combinacao DENTRO da matriz mas sem a
 * estrutura prometida e structured data falso: bloqueia.
 */
export const SCHEMA_BY_CONTENT_TYPE: Readonly<
  Record<string, readonly (typeof SCHEMA_TYPE_RECOMMENDATIONS)[number][]>
> = {
  news: ['NewsArticle', 'Article'],
  feature: ['Article'],
  review: ['Review', 'Article'],
  guide: ['HowTo', 'Article'],
  list: ['ItemList', 'Article'],
  interview: ['Article'],
  evergreen: ['Article', 'HowTo'],
}
export const schemaTypeRecommendation = z.enum(SCHEMA_TYPE_RECOMMENDATIONS)
export type SchemaTypeRecommendation = (typeof SCHEMA_TYPE_RECOMMENDATIONS)[number]

/* ------------------------------------------------------------------ */
/* Alt text e links internos                                           */
/* ------------------------------------------------------------------ */

/**
 * Sugestao de alt para uma midia CONHECIDA.
 *
 * A referencia e obrigatoria: alt sem midia e texto solto que nunca chega a
 * nenhuma imagem, e o produtor acharia que descreveu algo.
 */
export const imageAltSuggestion = z.object({
  /** `mediaCandidateId` (draft) ou `mediaId` (publicacao). */
  mediaRef: stableId,
  alt: plainText(SEO_POLICY.imageAlt.max).refine(
    (value) => value.trim().length >= SEO_POLICY.imageAlt.min,
    `alt precisa de ao menos ${String(SEO_POLICY.imageAlt.min)} caracteres`,
  ),
})
export type ImageAltSuggestion = z.infer<typeof imageAltSuggestion>

export const INTERNAL_LINK_TARGET_TYPES = [
  'article',
  'movie',
  'tv_show',
  'person',
  'collection',
  'section',
] as const

/**
 * Link interno sugerido.
 *
 * Estruturado, nunca uma URL solta: o alvo precisa ser VERIFICAVEL. `reason` e
 * `confidence` existem para que a revisao humana entenda por que o pipeline
 * propos aquele link — semelhanca de categoria generica nao e prova.
 */
export const internalLinkSuggestion = z.object({
  targetType: z.enum(INTERNAL_LINK_TARGET_TYPES),
  /** Id canonico da entidade. Preferido sobre caminho. */
  targetId: stableId.optional(),
  /** Caminho interno de site (`/pt/...`). NUNCA URL absoluta. */
  targetPath: z
    .string()
    .min(1)
    .max(LIMITS.url)
    .regex(/^\/[^\s]*$/, 'targetPath precisa ser caminho de site iniciado por /')
    .optional(),
  anchorText: plainText(LIMITS.shortText),
  reason: optionalPlainText(LIMITS.shortText),
  confidence: z.number().min(0).max(1).optional(),
  sourceContext: optionalPlainText(LIMITS.shortText),
})

export type InternalLinkSuggestion = z.infer<typeof internalLinkSuggestion>

/* ------------------------------------------------------------------ */
/* A proposta                                                          */
/* ------------------------------------------------------------------ */

/**
 * NOME DELIBERADO: `editorialSeoProposal`, e nao `seoProposal`.
 *
 * `editorial-draft-v1` ja exporta um `seoProposal` MINIMO (metaTitle,
 * metaDescription, socialTitle, socialDescription) que o MNScr usa hoje no modo
 * draft. Reusar o nome quebraria aquele contrato em silencio — e contrato que
 * quebra em silencio e a pior forma de quebrar. Os dois convivem: o antigo
 * continua servindo ao draft; este, mais rico e versionado, serve a publicacao
 * automatica.
 */
export const editorialSeoProposal = z
  .object({
    version: z.literal(SEO_PROPOSAL_VERSION),

    /** Titulo para busca. Pode diferir do titulo editorial. */
    title: plainText(SEO_POLICY.title.max),
    metaDescription: plainText(SEO_POLICY.metaDescription.max),
    /** SUGESTAO. A slug canonica e derivada no Payload. */
    slugSuggestion: slugProposal,

    focusKeyphrase: plainText(SEO_POLICY.focusKeyphrase.max),
    relatedKeyphrases: z
      .array(plainText(SEO_POLICY.relatedKeyphrases.itemMax))
      .max(SEO_POLICY.relatedKeyphrases.max)
      .default([]),
    editorialKeywords: z
      .array(plainText(SEO_POLICY.editorialKeywords.itemMax))
      .max(SEO_POLICY.editorialKeywords.max)
      .default([]),

    schemaTypeRecommendation,
    articleSectionSuggestion: optionalPlainText(LIMITS.shortText),

    openGraphTitleSuggestion: optionalPlainText(SEO_POLICY.socialTitle.max),
    openGraphDescriptionSuggestion: optionalPlainText(SEO_POLICY.socialDescription.max),
    twitterTitleSuggestion: optionalPlainText(SEO_POLICY.socialTitle.max),
    twitterDescriptionSuggestion: optionalPlainText(SEO_POLICY.socialDescription.max),

    imageAltSuggestions: z
      .array(imageAltSuggestion)
      .max(SEO_POLICY.imageAlt.max_items)
      .default([]),
    internalLinkSuggestions: z
      .array(internalLinkSuggestion)
      .max(SEO_POLICY.internalLinks.max)
      .default([]),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    if (proposal.title.trim().length < SEO_POLICY.title.min) {
      ctx.addIssue({
        code: 'custom',
        path: ['title'],
        message: `title precisa de ao menos ${String(SEO_POLICY.title.min)} caracteres`,
      })
    }
    if (proposal.metaDescription.trim().length < SEO_POLICY.metaDescription.min) {
      ctx.addIssue({
        code: 'custom',
        path: ['metaDescription'],
        message: `metaDescription precisa de ao menos ${String(SEO_POLICY.metaDescription.min)} caracteres`,
      })
    }

    // Uma keyphrase repetida na lista de relacionadas nao adiciona nada e
    // costuma ser sinal de geracao automatica sem revisao.
    const related = proposal.relatedKeyphrases.map((item) => normalizeKeyphrase(item))
    if (new Set(related).size !== related.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['relatedKeyphrases'],
        message: 'relatedKeyphrases contem duplicata (normalizada)',
      })
    }
    if (related.includes(normalizeKeyphrase(proposal.focusKeyphrase))) {
      ctx.addIssue({
        code: 'custom',
        path: ['relatedKeyphrases'],
        message: 'relatedKeyphrases nao pode repetir a focusKeyphrase',
      })
    }

    // Um link precisa saber PARA ONDE aponta.
    for (const [index, link] of proposal.internalLinkSuggestions.entries()) {
      if (link.targetId === undefined && link.targetPath === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['internalLinkSuggestions', index],
          message: 'link interno exige targetId ou targetPath',
        })
      }
    }

    // Alt duplicado para a MESMA midia e contradicao: qual seria o certo?
    const mediaRefs = proposal.imageAltSuggestions.map((item) => item.mediaRef)
    if (new Set(mediaRefs).size !== mediaRefs.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['imageAltSuggestions'],
        message: 'duas sugestoes de alt para a mesma midia',
      })
    }
  })

export type EditorialSeoProposal = z.infer<typeof editorialSeoProposal>

/** Normaliza uma keyphrase para comparacao: minuscula, sem acento, sem pontuacao. */
export function normalizeKeyphrase(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Conta quantas vezes a keyphrase aparece no conjunto de campos SEO.
 *
 * Serve ao gate de stuffing. Contar por CAMPO seria permissivo demais: a mesma
 * frase em titulo, meta, og, twitter e alt e o padrao classico de texto escrito
 * para robo.
 */
export function countKeyphraseOccurrences(proposal: EditorialSeoProposal): number {
  const needle = normalizeKeyphrase(proposal.focusKeyphrase)
  if (needle === '') return 0
  const haystacks = [
    proposal.title,
    proposal.metaDescription,
    proposal.openGraphTitleSuggestion,
    proposal.openGraphDescriptionSuggestion,
    proposal.twitterTitleSuggestion,
    proposal.twitterDescriptionSuggestion,
    ...proposal.imageAltSuggestions.map((item) => item.alt),
  ]
  let total = 0
  for (const field of haystacks) {
    if (typeof field !== 'string') continue
    const normalized = normalizeKeyphrase(field)
    if (normalized === '') continue
    let index = normalized.indexOf(needle)
    while (index !== -1) {
      total += 1
      index = normalized.indexOf(needle, index + needle.length)
    }
  }
  return total
}
