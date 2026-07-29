/**
 * editorial-projection.ts — Traducao de `publication-event-v1` (CMS) para o
 * estado do banco publico. PURO.
 *
 * Este modulo NAO escreve nada: ele decide. Recebe o evento ja validado pelo
 * contrato, o estado publico atual e o instante, e devolve a mutacao a aplicar
 * (ou o motivo de nao aplicar). O adapter Prisma executa a decisao numa
 * transacao unica junto com o recibo.
 *
 * Governanca:
 *  - Invariante 3/4: nada aqui roda no render; o worker e offline.
 *  - Invariante 6: sem licenca clara, nao vira pagina publica.
 *  - Invariante 7: idioma fora de `PUBLISHED_LOCALES` projeta como draft/noindex.
 *  - Invariante 12: o CMS ja registrou a decisao HUMANA; a projecao nao publica
 *    nada por conta propria, so reflete o que um humano autorizado decidiu.
 */

import { PUBLISHED_LOCALES } from '@screena/config'

/* ------------------------------------------------------------------ */
/* Entrada: o recorte do evento que a projecao consome                 */
/* ------------------------------------------------------------------ */

export const PROJECTION_EVENT_TYPES = [
  'article.published',
  'article.updated',
  'article.unpublished',
  'article.retracted',
] as const
export type ProjectionEventType = (typeof PROJECTION_EVENT_TYPES)[number]

/** Bloco do corpo editorial, como o contrato o entrega. */
export interface ProjectionBlock {
  readonly type: string
  readonly id: string
  readonly [key: string]: unknown
}

export interface ProjectionEvent {
  readonly eventId: string
  readonly idempotencyKey: string
  readonly eventType: ProjectionEventType
  /** Documento no CMS. E a ANCORA do artigo publico, nao o slug. */
  readonly payloadDocumentId: string
  /**
   * Ordem de EMISSAO do evento: o id serial da linha na outbox do CMS.
   *
   * Nao vem do corpo do evento — vem da fila, que e quem sabe a ordem. O campo
   * `aggregateVersion` da outbox NAO serve para isto: ele guarda um hash do
   * conteudo publicado, e hash nao ordena.
   */
  readonly emissionSequence: number
  readonly language: string
  readonly occurredAtIso: string
  readonly retractionReason: string | null
  readonly publishedContent: {
    readonly title: string
    readonly subtitle: string | null
    readonly slug: string
    readonly summary: string
    readonly contentType: string
    readonly body: readonly ProjectionBlock[]
    readonly authorName: string
    readonly publishedAtIso: string
    readonly correctedAtIso: string | null
    readonly correctionNote: string | null
    readonly aiAssisted: boolean
  } | null
  readonly seo: {
    readonly metaTitle: string | null
    readonly metaDescription: string | null
    readonly noindex: boolean
  } | null
  readonly provenance: {
    readonly primarySourceName: string | null
    readonly primarySourceUrl: string | null
  }
  readonly media: readonly {
    readonly role: string
    readonly requiresAttribution: boolean
    readonly credit: string | null
  }[]
}

/** Estado publico atual do artigo (o que ja existe no screen-db). */
export interface PublicArticleState {
  readonly articleId: string
  /** Maior sequencia ja projetada. `null` = artigo nunca recebeu projecao. */
  readonly projectedSequence: number | null
  readonly translationBodyBlocksVersion: string | null
}

/* ------------------------------------------------------------------ */
/* Saida: a decisao                                                    */
/* ------------------------------------------------------------------ */

export type ProjectionOutcome =
  | 'applied'
  | 'skipped_duplicate'
  | 'skipped_stale'
  | 'skipped_unlicensed'

export interface ArticleWrite {
  readonly payloadDocumentId: string
  readonly category: string | null
  readonly authorName: string | null
  readonly publishedAtIso: string | null
  readonly aiAssisted: boolean
  readonly sourceName: string | null
  readonly sourceUrl: string | null
  readonly licenseStatus: 'official' | 'blocked'
  readonly displayAllowed: boolean
  readonly requiresAttribution: boolean
  readonly requiresLinkback: boolean
  readonly projectedSequence: number
}

export interface TranslationWrite {
  readonly languageCode: string
  readonly slug: string
  readonly title: string
  readonly deck: string | null
  readonly body: string | null
  readonly bodyBlocks: readonly ProjectionBlock[] | null
  readonly bodyBlocksVersion: string | null
  readonly metaTitle: string | null
  readonly metaDescription: string | null
  readonly reviewStatus: 'published' | 'archived' | 'blocked' | 'draft'
  readonly indexStatus: 'index' | 'noindex' | 'draft'
  readonly publishedAtIso: string | null
  readonly correctedAtIso: string | null
  readonly correctionNote: string | null
}

export interface ProjectionDecision {
  readonly outcome: ProjectionOutcome
  readonly reason: string
  readonly article: ArticleWrite | null
  readonly translation: TranslationWrite | null
  /** Avisos operacionais — nao bloqueiam, mas ficam no log do worker. */
  readonly warnings: readonly string[]
}

/* ------------------------------------------------------------------ */
/* Conversao de blocos para texto                                      */
/* ------------------------------------------------------------------ */

/** Campos textuais que um bloco pode expor, em ordem de preferencia. */
const TEXT_KEYS = ['text', 'quote', 'caption', 'question', 'answer', 'summary'] as const

function blockText(block: ProjectionBlock): string {
  const parts: string[] = []
  for (const key of TEXT_KEYS) {
    const value = block[key]
    if (typeof value === 'string' && value.trim() !== '') parts.push(value.trim())
  }
  // Listas guardam os itens em `items`; sem isto, uma materia toda em bullets
  // teria corpo vazio e cairia no gate de conteudo fino.
  const items = block.items
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item === 'string' && item.trim() !== '') parts.push(item.trim())
    }
  }
  return parts.join(' ')
}

/**
 * Achata os blocos em texto corrido.
 *
 * `article_translations.body` continua sendo a fonte de TODAS as superficies
 * publicas existentes (listagem, artigo, busca, gate de conteudo fino). Os
 * blocos entram como coluna aditiva; quem nao sabe le-los nao muda de
 * comportamento por causa desta fase.
 */
export function blocksToPlainText(blocks: readonly ProjectionBlock[]): string {
  return blocks
    .map(blockText)
    .filter((text) => text !== '')
    .join('\n\n')
}

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

export function isPublishedLocale(language: string): boolean {
  return (PUBLISHED_LOCALES as readonly string[]).includes(language)
}

/**
 * Ha midia que exige atribuicao e chegou SEM credito?
 *
 * O contrato ja recusa esse evento na fronteira. A checagem e repetida aqui de
 * proposito: a projecao e a ultima porta antes do banco publico, e um evento
 * que tenha entrado por outro caminho (replay de fila antiga, fixture, teste)
 * nao pode virar pagina publica com credito faltando (invariante 6).
 */
export function hasUncreditedMedia(
  media: readonly { requiresAttribution: boolean; credit: string | null }[],
): boolean {
  return media.some((item) => item.requiresAttribution && (item.credit ?? '').trim() === '')
}

/* ------------------------------------------------------------------ */
/* Decisao                                                             */
/* ------------------------------------------------------------------ */

export interface DecideProjectionInput {
  readonly event: ProjectionEvent
  /** Recibo ja existente para este `eventId` (replay). */
  readonly existingReceipt: { readonly outcome: ProjectionOutcome } | null
  readonly existing: PublicArticleState | null
  /** Hash do conteudo, calculado fora (o nucleo nao faz IO nem cripto). */
  readonly contentVersion: string | null
}

export function decideProjection(input: DecideProjectionInput): ProjectionDecision {
  const { event } = input
  const warnings: string[] = []

  // 1. REPLAY. O recibo e a prova de que este evento exato ja foi processado.
  //    Nunca reaplicar: `article.updated` reaplicado sobrescreveria uma edicao
  //    posterior com conteudo velho.
  if (input.existingReceipt !== null) {
    return {
      outcome: 'skipped_duplicate',
      reason: `evento ${event.eventId} ja possui recibo (${input.existingReceipt.outcome})`,
      article: null,
      translation: null,
      warnings,
    }
  }

  // 2. FORA DE ORDEM. A outbox pode reentregar um evento antigo depois de um
  //    novo ja ter sido projetado (retry apos backoff longo). Versao menor ou
  //    igual nao reescreve o presente.
  const projected = input.existing?.projectedSequence ?? null
  if (projected !== null && event.emissionSequence <= projected) {
    return {
      outcome: 'skipped_stale',
      reason: `emissao ${String(event.emissionSequence)} <= projetada ${String(projected)}`,
      article: null,
      translation: null,
      warnings,
    }
  }

  // 3. LICENCA (invariante 6). Midia sem credito exigido nao vira pagina
  //    publica. O evento fica registrado como recibo, mas nada e exibido.
  if (hasUncreditedMedia(event.media)) {
    return {
      outcome: 'skipped_unlicensed',
      reason: 'midia com requiresAttribution sem credito preenchido',
      article: null,
      translation: null,
      warnings,
    }
  }

  const removal = event.eventType === 'article.unpublished' || event.eventType === 'article.retracted'

  if (removal) {
    // Despublicar/retratar NAO apaga: rebaixa. A URL continua existindo e a
    // evidencia da retratacao fica registrada (correctionNote), em vez de o
    // artigo sumir sem rastro.
    const isRetraction = event.eventType === 'article.retracted'
    return {
      outcome: 'applied',
      reason: isRetraction ? 'retratado' : 'despublicado',
      article: null,
      translation: {
        languageCode: event.language,
        // Os campos de conteudo sao nulos porque a remocao NAO reescreve texto:
        // o adapter aplica so o que nao for nulo aqui.
        slug: '',
        title: '',
        deck: null,
        body: null,
        bodyBlocks: null,
        bodyBlocksVersion: null,
        metaTitle: null,
        metaDescription: null,
        reviewStatus: isRetraction ? 'blocked' : 'archived',
        indexStatus: 'noindex',
        publishedAtIso: null,
        correctedAtIso: isRetraction ? event.occurredAtIso : null,
        correctionNote: isRetraction ? event.retractionReason : null,
      },
      warnings,
    }
  }

  const content = event.publishedContent
  if (content === null || event.seo === null) {
    // O contrato ja exige conteudo em published/updated. Chegar aqui sem ele e
    // um evento que burlou a fronteira: recusar em vez de gravar pagina vazia.
    return {
      outcome: 'skipped_unlicensed',
      reason: `${event.eventType} sem publishedContent/seo`,
      article: null,
      translation: null,
      warnings,
    }
  }

  const publishedLocale = isPublishedLocale(event.language)
  if (!publishedLocale) {
    // Invariante 7: idioma fora de `PUBLISHED_LOCALES` existe no banco, mas nao
    // indexa e nao publica. Nao e erro — e o estado correto de um idioma
    // incompleto.
    warnings.push(`idioma ${event.language} fora de PUBLISHED_LOCALES: projetado como draft/noindex`)
  }

  const body = blocksToPlainText(content.body)
  if (body === '') warnings.push('corpo achatado ficou vazio: nenhum bloco textual no evento')

  // Midia NAO e projetada nesta fase. `articles.hero_image_path` e consumida
  // por `normalizeNewsLocalImagePath`, que recusa URL http(s) por design —
  // gravar a URL do CMS ali criaria dado morto. Trazer a imagem exige pipeline
  // de download/derivada local, deliberadamente FORA desta fase.
  if (event.media.length > 0) {
    warnings.push(`${String(event.media.length)} midia(s) nao projetadas (pipeline de asset ausente)`)
  }

  const requiresAttribution = event.provenance.primarySourceName !== null
  const requiresLinkback = event.provenance.primarySourceUrl !== null

  return {
    outcome: 'applied',
    reason: event.eventType,
    article: {
      payloadDocumentId: event.payloadDocumentId,
      category: content.contentType,
      authorName: content.authorName,
      publishedAtIso: content.publishedAtIso,
      aiAssisted: content.aiAssisted,
      sourceName: event.provenance.primarySourceName,
      sourceUrl: event.provenance.primarySourceUrl,
      // Conteudo PROPRIO, publicado por humano autorizado no CMS: licenca
      // official. Nao ha reexibicao de dado de terceiro aqui — o que vem de
      // fora e a proveniencia creditada, nao o texto.
      licenseStatus: 'official',
      displayAllowed: true,
      requiresAttribution,
      requiresLinkback,
      projectedSequence: event.emissionSequence,
    },
    translation: {
      languageCode: event.language,
      slug: content.slug,
      title: content.title,
      deck: content.subtitle ?? content.summary,
      body: body === '' ? null : body,
      // Blocos e versao andam SEMPRE juntos: o banco tem CHECK exigindo o par,
      // e blocos sem versao seriam impossiveis de comparar na reprojecao.
      bodyBlocks: input.contentVersion === null ? null : content.body,
      bodyBlocksVersion: input.contentVersion,
      metaTitle: event.seo.metaTitle,
      metaDescription: event.seo.metaDescription,
      // Idioma nao publicado nasce `draft`; nunca `published`.
      reviewStatus: publishedLocale ? 'published' : 'draft',
      indexStatus: !publishedLocale ? 'draft' : event.seo.noindex ? 'noindex' : 'index',
      publishedAtIso: content.publishedAtIso,
      correctedAtIso: content.correctedAtIso,
      correctionNote: content.correctionNote,
    },
    warnings,
  }
}
