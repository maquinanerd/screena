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

import {
  planEntityLinks,
  type EventEntityLink,
  type PlannedEntityLink,
} from './editorial-entity-links.js'
import { applyMediaToBlocks, type ResolvedMediaAsset } from './media/media-plan.js'

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
  readonly seo: ApprovedSeo | null
  readonly provenance: {
    readonly primarySourceName: string | null
    readonly primarySourceUrl: string | null
    /**
     * TODAS as fontes externas declaradas, com o id que o bloco `sourceList`
     * usa em `sourceRefs`. So o `primary` vira credito visivel da materia
     * (`source_name`/`source_url`); esta lista existe para resolver os blocos.
     */
    readonly externalSources: readonly {
      readonly sourceId: string | null
      readonly name: string
      readonly url: string
      readonly role: string
    }[]
  }
  readonly media: readonly {
    /** Id CANONICO do documento no CMS. E por ele que os bytes sao pedidos. */
    readonly mediaId: string
    readonly role: string
    readonly requiresAttribution: boolean
    readonly credit: string | null
  }[]
  /**
   * Entidades do catalogo CONFIRMADAS por humano no CMS.
   *
   * Conjunto AUTORITATIVO do documento: o que nao esta aqui foi desmarcado pelo
   * editor. Por isso a projecao pode reconciliar `entity_news_links` em vez de
   * so inserir.
   */
  readonly entities: readonly EventEntityLink[]
}

/**
 * SEO APROVADO que atravessa para o lado publico.
 *
 * Note o que NAO esta aqui: `canonical`, `robots` e o JSON-LD montado. Esses sao
 * DERIVADOS no lado publico, de `slugs`/`redirects` e da decisao de
 * indexabilidade. Projeta-los do CMS criaria duas fontes discordando sobre a
 * mesma URL — e a divergencia so apareceria no indice do buscador.
 *
 * `canonicalOverride` e a unica excecao, e e editorial explicita: sindicacao e
 * conteudo espelhado.
 */
export interface ApprovedSeo {
  readonly metaTitle: string | null
  readonly metaDescription: string | null
  readonly noindex: boolean
  readonly socialTitle: string | null
  readonly socialDescription: string | null
  readonly canonicalOverride: string | null
  readonly focusKeyphrase: string | null
  readonly relatedKeyphrases: readonly string[]
  readonly editorialKeywords: readonly string[]
  readonly schemaTypeRecommendation: string | null
  readonly articleSection: string | null
  readonly approvedImageAlt: readonly { readonly mediaId: string; readonly alt: string }[]
  readonly approvedInternalLinks: readonly {
    readonly targetType: string
    readonly targetId: string
    readonly anchorText: string
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
  /**
   * Caminho publico da capa (`/media/editorial/...`) ou `null`.
   *
   * NUNCA uma URL http(s): `normalizeNewsLocalImagePath` no `apps/web` recusa
   * URL absoluta por design, e gravar uma aqui produziria materia sem imagem em
   * silencio — o defeito exato que a FASE 2D existe para fechar.
   */
  readonly heroImagePath: string | null
  /** `mediaId` do CMS da capa, para o adapter resolver o vinculo do asset. */
  readonly heroMediaId: string | null
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
  readonly socialTitle: string | null
  readonly socialDescription: string | null
  readonly canonicalOverride: string | null
  readonly focusKeyphrase: string | null
  readonly relatedKeyphrases: readonly string[]
  readonly editorialKeywords: readonly string[]
  readonly schemaTypeRecommendation: string | null
  readonly articleSection: string | null
  readonly approvedImageAlt: readonly { readonly mediaId: string; readonly alt: string }[]
  readonly approvedInternalLinks: readonly {
    readonly targetType: string
    readonly targetId: string
    readonly anchorText: string
  }[]
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
  /**
   * Conjunto AUTORITATIVO de vinculos entidade<->materia, ou `null` quando o
   * evento nao carrega conteudo (replay, stale, remocao).
   *
   * `null` e `[]` sao estados DIFERENTES: `null` significa "nao reconcilie
   * nada"; `[]` significa "o editor nao deixou nenhuma entidade" — e ai os
   * vinculos antigos precisam sair. Colapsar os dois faria uma retratacao
   * apagar vinculos, ou uma materia sem entidades manter para sempre a citacao
   * que o editor removeu.
   */
  readonly entityLinks: readonly PlannedEntityLink[] | null
  /**
   * Ate onde a SEQUENCIA PROJETADA deste artigo deve avancar.
   *
   * Existe porque `article` e `null` na REMOCAO — e era ali que a sequencia
   * parava de andar. Retratar no evento 50 deixava `projected_sequence` no 30
   * da ultima publicacao, e um `article.updated` de 40 reentregue depois
   * passava pelo portao de "fora de ordem" e REPUBLICAVA a materia retratada.
   *
   * `null` = nao mexa (replay, stale, licenca). Numero = grave este valor.
   */
  readonly sequenceAdvance: number | null
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
/* Blocos de fonte (`sourceList`)                                      */
/* ------------------------------------------------------------------ */

/** Fonte externa ja resolvida, pronta para o render. */
export interface ProjectedSource {
  readonly name: string
  readonly url: string
}

/**
 * Reescreve blocos `sourceList` trocando `sourceRefs` (ids internos do documento
 * no CMS) pelas fontes RESOLVIDAS (nome + url).
 *
 * Mesma disciplina de `applyMediaToBlocks`: o bloco publico carrega o dado
 * pronto, nunca um identificador que so o CMS entende. A alternativa seria o
 * render receber `["s1","s2"]` e ter de adivinhar a que fonte cada id
 * corresponde — e adivinhar aqui significa creditar a fonte errada.
 *
 * Ref que nao resolve e DESCARTADA (com aviso), nao substituida pela primeira
 * fonte da lista: um credito errado e pior do que um credito ausente.
 */
export function applySourcesToBlocks(
  blocks: readonly ProjectionBlock[],
  sources: readonly { readonly sourceId: string | null; readonly name: string; readonly url: string }[],
): { readonly blocks: ProjectionBlock[]; readonly warnings: string[] } {
  const warnings: string[] = []
  const byId = new Map<string, ProjectedSource>()
  for (const source of sources) {
    const id = source.sourceId?.trim() ?? ''
    if (id === '') continue
    byId.set(id, { name: source.name, url: source.url })
  }

  const projected = blocks.map((block) => {
    if (block.type !== 'sourceList') return block
    const refs = Array.isArray(block.sourceRefs) ? block.sourceRefs : []
    const resolved: ProjectedSource[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
      if (typeof ref !== 'string') continue
      const source = byId.get(ref.trim())
      if (source === undefined) {
        warnings.push(`bloco de fontes ${block.id}: ref ${ref} nao resolve para fonte declarada`)
        continue
      }
      if (seen.has(source.url)) continue
      seen.add(source.url)
      resolved.push(source)
    }
    // `sourceRefs` sai do bloco publico: id interno do CMS nao serve ao render.
    const { sourceRefs: _dropped, ...rest } = block
    return { ...rest, sources: resolved } as ProjectionBlock
  })

  return { blocks: projected, warnings }
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
  /**
   * Midias JA projetadas no storage publico, por `mediaId`.
   *
   * Chegam prontas de proposito: baixar arquivo e uma operacao de rede, e o
   * nucleo de decisao nao faz IO. Vazio significa "nenhuma midia disponivel",
   * nao "materia sem midia" — a diferenca e tratada abaixo.
   */
  readonly media?: ReadonlyMap<string, ResolvedMediaAsset>
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
      entityLinks: null,
      sequenceAdvance: null,
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
      entityLinks: null,
      sequenceAdvance: null,
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
      entityLinks: null,
      sequenceAdvance: null,
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
        // Idem para o SEO: retratar NAO apaga os sinais gravados, so tira do
        // indice. Zerar aqui destruiria o historico de uma materia que pode
        // voltar depois de revisao humana.
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
        reviewStatus: isRetraction ? 'blocked' : 'archived',
        indexStatus: 'noindex',
        publishedAtIso: null,
        correctedAtIso: isRetraction ? event.occurredAtIso : null,
        correctionNote: isRetraction ? event.retractionReason : null,
      },
      // `null`, nao `[]`: despublicar/retratar NAO apaga os vinculos, do mesmo
      // jeito que nao apaga o texto. O que tira a materia das relacionadas do
      // filme e o `indexStatus: noindex` aplicado acima — o gate esta na
      // leitura. Se a materia voltar apos revisao humana, as citacoes voltam
      // com ela.
      entityLinks: null,
      // A REMOCAO AVANCA A SEQUENCIA. Este numero e a correcao inteira.
      //
      // Como o ramo de remocao devolve `article: null`, nada gravava
      // `projected_sequence` — ela ficava no valor da ultima PUBLICACAO.
      // Retratar no evento 50 deixava a sequencia em 30, e um `article.updated`
      // de 40 reentregue depois (retry apos backoff longo, redelivery da fila)
      // passava pelo portao de "fora de ordem" e ressuscitava a materia
      // retratada — publicada de novo, indexavel de novo, sem ninguem decidir.
      sequenceAdvance: event.emissionSequence,
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
      entityLinks: null,
      sequenceAdvance: null,
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

  // MIDIA (FASE 2D). Os assets chegam ja verificados e gravados no storage; aqui
  // so resolvemos a capa e reescrevemos os blocos de imagem.
  const media = input.media ?? new Map<string, ResolvedMediaAsset>()
  const heroMediaId =
    event.media.find((item) => item.role === 'hero')?.mediaId ?? null
  const heroAsset = heroMediaId === null ? undefined : media.get(heroMediaId)
  if (heroMediaId !== null && heroAsset === undefined) {
    // Capa pedida e nao resolvida NAO vira materia sem foto em silencio. O
    // chamador ja teria falhado o evento; este aviso existe para o caso de a
    // politica de obrigatoriedade mudar sem que alguem lembre deste ponto.
    warnings.push(`capa ${heroMediaId} nao foi projetada`)
  }

  const { blocks: withMedia, unresolved } = applyMediaToBlocks(content.body, media)
  for (const blockId of unresolved) {
    warnings.push(`bloco de imagem ${blockId} sem asset projetado`)
  }

  // FONTES. Depois da midia, sobre os mesmos blocos: cada passo troca uma
  // referencia interna do CMS pelo dado pronto do lado publico.
  const { blocks: projectedBlocks, warnings: sourceWarnings } = applySourcesToBlocks(
    withMedia,
    event.provenance.externalSources,
  )
  warnings.push(...sourceWarnings)

  const requiresAttribution = event.provenance.primarySourceName !== null
  const requiresLinkback = event.provenance.primarySourceUrl !== null

  // VINCULOS DE ENTIDADE. O plano e puro; a verificacao contra o catalogo e a
  // reconciliacao acontecem no adapter, dentro da mesma transacao do artigo.
  const entityPlan = planEntityLinks(event.entities)
  warnings.push(...entityPlan.warnings)

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
      heroImagePath: heroAsset?.publicPath ?? null,
      heroMediaId,
    },
    translation: {
      languageCode: event.language,
      slug: content.slug,
      title: content.title,
      deck: content.subtitle ?? content.summary,
      body: body === '' ? null : body,
      // Blocos e versao andam SEMPRE juntos: o banco tem CHECK exigindo o par,
      // e blocos sem versao seriam impossiveis de comparar na reprojecao.
      bodyBlocks: input.contentVersion === null ? null : projectedBlocks,
      bodyBlocksVersion: input.contentVersion,
      metaTitle: event.seo.metaTitle,
      metaDescription: event.seo.metaDescription,
      socialTitle: event.seo.socialTitle,
      socialDescription: event.seo.socialDescription,
      canonicalOverride: event.seo.canonicalOverride,
      focusKeyphrase: event.seo.focusKeyphrase,
      relatedKeyphrases: event.seo.relatedKeyphrases,
      editorialKeywords: event.seo.editorialKeywords,
      schemaTypeRecommendation: event.seo.schemaTypeRecommendation,
      articleSection: event.seo.articleSection,
      approvedImageAlt: event.seo.approvedImageAlt,
      approvedInternalLinks: event.seo.approvedInternalLinks,
      // Idioma nao publicado nasce `draft`; nunca `published`.
      reviewStatus: publishedLocale ? 'published' : 'draft',
      indexStatus: !publishedLocale ? 'draft' : event.seo.noindex ? 'noindex' : 'index',
      publishedAtIso: content.publishedAtIso,
      correctedAtIso: content.correctedAtIso,
      correctionNote: content.correctionNote,
    },
    entityLinks: entityPlan.links,
    // Mesmo valor que `article.projectedSequence` acima. Redundante de
    // proposito: o adapter passa a ter UMA fonte para "ate onde este artigo
    // ja foi projetado", em vez de depender de qual dos dois ramos correu.
    sequenceAdvance: event.emissionSequence,
    warnings,
  }
}
