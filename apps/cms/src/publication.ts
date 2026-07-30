/**
 * publication.ts — Monta o `publication-event-v1` a partir do estado PERSISTIDO.
 *
 * O evento e derivado do documento que ja esta no banco, nunca do corpo da
 * requisicao: e a diferenca entre "o que o lado publico vai receber" e "o que
 * alguem pediu". Se um campo nao sobreviveu ao `beforeChange`, ele nao existe
 * aqui tambem.
 */

import type { PayloadRequest } from 'payload'

import type { PublicationEventType } from '@screena/editorial-contracts'

import { toActor } from './actor.js'
import { buildEventIdempotencyKey } from './outbox.js'
import { canonicalHash } from './idempotency.js'

function idsOf(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((item) =>
      item !== null && typeof item === 'object' && 'id' in item
        ? String((item as { id: unknown }).id)
        : String(item),
    )
    .filter((id) => id !== '' && id !== 'null' && id !== 'undefined')
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function isoOf(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString()
}

/**
 * Versao publica do artigo.
 *
 * Deriva do conteudo, e nao de um contador: duas publicacoes do MESMO conteudo
 * produzem a mesma versao (e, portanto, a mesma chave de idempotencia), enquanto
 * qualquer mudanca material produz outra. E o que faz "republicar sem mudar
 * nada" nao virar um segundo evento.
 */
export function publicContentVersion(doc: Record<string, unknown>): string {
  return canonicalHash({
    title: doc.title ?? null,
    subtitle: doc.subtitle ?? null,
    slug: doc.slug ?? null,
    summary: doc.summary ?? null,
    body: toContractBlocks(doc.body),
    authors: idsOf(doc.authors),
    heroMedia: idsOf(doc.heroMedia),
    gallery: idsOf(doc.gallery),
    entityReferences: doc.entityReferences ?? [],
    metaTitle: doc.metaTitle ?? null,
    metaDescription: doc.metaDescription ?? null,
    noindex: doc.noindex === true,
  }).slice(0, 32)
}

/* ------------------------------------------------------------------ */
/* Blocos: forma do Payload -> forma do contrato                       */
/* ------------------------------------------------------------------ */

/**
 * O Payload persiste blocos com `blockType`/`blockId` e uma `id` propria de
 * linha; o contrato discrimina por `type`/`id`. Sao duas formas do MESMO bloco,
 * e sem esta traducao o `publication-event-v1` nunca valida — foi o que a suite
 * de integracao pegou, com a publicacao falhando fechada (artigo nao publicado
 * sem evento valido, exatamente como a atomicidade exige).
 *
 * A traducao e EXPLICITA por tipo, e nao um spread: um campo novo no CMS nao
 * deve atravessar para o lado publico sem alguem decidir que ele atravessa.
 */
export function toContractBlocks(body: unknown): unknown[] {
  if (!Array.isArray(body)) return []

  // Anotacao explicita: sem ela o TS tenta unificar dez formas diferentes de
  // bloco num unico tipo e falha. A validacao real e do contrato, no Zod.
  return body.flatMap((raw): unknown[] => {
    if (raw === null || typeof raw !== 'object') return []
    const block = raw as Record<string, unknown>
    const type = String(block.blockType ?? block.type ?? '')
    const id = String(block.blockId ?? block.id ?? '')
    if (type === '' || id === '') return []

    const provenance = Array.isArray(block.provenance)
      ? block.provenance.flatMap((entry) => {
          if (entry === null || typeof entry !== 'object') return []
          const ref = entry as Record<string, unknown>
          const origin = text(ref.origin)
          if (origin === undefined) return []
          const value = text(ref.ref)
          return [{ origin, ...(value === undefined ? {} : { ref: value }) }]
        })
      : []
    const withProvenance = provenance.length === 0 ? {} : { provenance }

    switch (type) {
      case 'paragraph':
        return [{ id, type, text: String(block.text ?? ''), ...withProvenance }]
      case 'heading':
        return [
          {
            id,
            type,
            // O select do painel guarda '2'|'3'|'4'; o contrato quer numero.
            level: Number(block.level ?? 2),
            text: String(block.text ?? ''),
          },
        ]
      case 'image':
        return [
          {
            id,
            type,
            mediaRef: idsOf(block.media)[0] ?? '',
            alt: String(block.alt ?? ''),
            ...(text(block.caption) === undefined ? {} : { caption: text(block.caption) }),
            ...(text(block.credit) === undefined ? {} : { credit: text(block.credit) }),
          },
        ]
      case 'video':
        return [
          {
            id,
            type,
            provider: block.provider,
            ...(text(block.externalId) === undefined
              ? {}
              : { externalId: text(block.externalId) }),
            ...(text(block.url) === undefined ? {} : { url: text(block.url) }),
            ...(text(block.title) === undefined ? {} : { title: text(block.title) }),
            ...(text(block.credit) === undefined ? {} : { credit: text(block.credit) }),
          },
        ]
      case 'quote':
        return [
          {
            id,
            type,
            text: String(block.text ?? ''),
            ...(text(block.attribution) === undefined
              ? {}
              : { attribution: text(block.attribution) }),
            ...(text(block.sourceRef) === undefined ? {} : { sourceRef: text(block.sourceRef) }),
          },
        ]
      case 'entityCard':
        return [
          {
            id,
            type,
            entityKind: block.entityKind,
            entityId: String(block.entityId ?? ''),
            ...(text(block.note) === undefined ? {} : { note: text(block.note) }),
          },
        ]
      case 'factBox':
        return [
          {
            id,
            type,
            title: String(block.title ?? ''),
            items: (Array.isArray(block.items) ? block.items : []).map((item) => {
              const entry = item as Record<string, unknown>
              return { label: String(entry.label ?? ''), value: String(entry.value ?? '') }
            }),
          },
        ]
      case 'relatedContent':
        return [
          { id, type, articleRefs: (block.articleRefs as unknown[] | null ?? []).map(String) },
        ]
      case 'sourceList':
        return [{ id, type, sourceRefs: (block.sourceRefs as unknown[] | null ?? []).map(String) }]
      case 'divider':
        return [{ id, type }]
      default:
        // Tipo desconhecido nao atravessa: melhor um corpo menor do que um
        // evento que o consumidor nao sabe interpretar.
        return []
    }
  })
}

/** Monta o evento. `req` e usado so para LER autores e midia ja persistidos. */
/**
 * Tipos de entidade que viram LINK INTERNO no lado publico.
 *
 * `franchise` e `season` ficam de fora porque nao tem rota publica propria
 * hoje: gerar link para elas produziria 404 em pagina indexavel.
 */
const INTERNAL_LINK_TARGETS = new Set(['movie', 'tv_show', 'person', 'article'])

/** Lista de texto saneada. Entrada malformada vira lista vazia, nunca `[undefined]`. */
function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter((item) => item.trim() !== '')
}

export async function buildPublicationEvent(input: {
  readonly req: PayloadRequest
  readonly doc: Record<string, unknown>
  readonly eventType: PublicationEventType
}): Promise<Record<string, unknown>> {
  const { req, doc, eventType } = input
  const actor = toActor(req.user)
  const now = new Date().toISOString()

  const articleId = String(doc.id)
  const versionId = publicContentVersion(doc)
  const carriesContent = eventType === 'article.published' || eventType === 'article.updated'

  const authorIds = idsOf(doc.authors)
  const authors =
    authorIds.length === 0
      ? []
      : (
          await req.payload.find({
            collection: 'authors',
            where: { id: { in: authorIds } },
            limit: authorIds.length,
            depth: 0,
            overrideAccess: true,
            req,
          })
        ).docs.map((author) => ({
          authorId: String(author.id),
          name: String(author.name),
          slug: String(author.slug),
          ...(text(author.roleLabel) === undefined ? {} : { roleLabel: text(author.roleLabel) }),
        }))

  const heroId = idsOf(doc.heroMedia)[0] ?? null
  const mediaIds = [...new Set([...(heroId === null ? [] : [heroId]), ...idsOf(doc.gallery)])]
  const media =
    mediaIds.length === 0
      ? []
      : (
          await req.payload.find({
            collection: 'media',
            where: { id: { in: mediaIds } },
            limit: mediaIds.length,
            depth: 0,
            overrideAccess: true,
            req,
          })
        ).docs.map((item) => ({
          mediaId: String(item.id),
          role: String(item.id) === heroId ? ('hero' as const) : ('gallery' as const),
          url: text(item.url) ?? `https://media.invalid/${String(item.id)}`,
          alt: text(item.alt) ?? 'sem descricao',
          ...(text(item.caption) === undefined ? {} : { caption: text(item.caption) }),
          ...(text(item.credit) === undefined ? {} : { credit: text(item.credit) }),
          ...(text(item.rightsHolder) === undefined
            ? {}
            : { rightsHolder: text(item.rightsHolder) }),
          requiresAttribution: item.requiresAttribution === true,
          ...(typeof item.width === 'number' ? { width: item.width } : {}),
          ...(typeof item.height === 'number' ? { height: item.height } : {}),
        }))

  // So entidades CONFIRMADAS por humano atravessam para o lado publico.
  const entities = (Array.isArray(doc.entityReferences) ? doc.entityReferences : [])
    .filter((ref) => (ref as { verified?: unknown }).verified === true)
    .map((ref) => {
      const entity = ref as Record<string, unknown>
      return {
        entityKind: entity.entityKind,
        entityId: String(entity.entityId),
        relation: entity.relation,
        verified: true as const,
      }
    })

  const externalSources = (Array.isArray(doc.externalSources) ? doc.externalSources : []).map(
    (source) => {
      const entry = source as Record<string, unknown>
      return {
        // `sourceId` atravessa porque o bloco `sourceList` do corpo cita fontes
        // por id. Sem ele, o lado publico nao consegue casar ref com fonte.
        ...(text(entry.sourceId) === undefined ? {} : { sourceId: text(entry.sourceId) }),
        name: String(entry.name),
        url: String(entry.url),
        role: entry.role,
      }
    },
  )

  const event: Record<string, unknown> = {
    contractVersion: 'publication-event-v1',
    eventId: `${articleId}-${versionId}-${eventType}`,
    idempotencyKey: buildEventIdempotencyKey(articleId, versionId, eventType),
    eventType,
    articleId,
    articleVersionId: versionId,
    payloadDocumentId: articleId,
    language: String(doc.language ?? 'pt-BR'),
    occurredAt: now,
    actor: {
      userId: actor.kind === 'anonymous' ? 'system' : actor.id,
      // O contrato so aceita quem pode publicar; o `beforeChange` ja garantiu
      // que ninguem mais chega aqui.
      role: actor.kind === 'human' && actor.role === 'administrator'
        ? 'administrator'
        : 'editor_in_chief',
    },
    entities,
    media,
    provenance: {
      externalSources,
      ...(text(doc.draftPayloadHash) === undefined
        ? {}
        : { draftPayloadHash: text(doc.draftPayloadHash) }),
      ...(text(doc.pipelineVersion) === undefined
        ? {}
        : { pipelineVersion: text(doc.pipelineVersion) }),
      reviewedBy: [],
    },
  }

  if (carriesContent) {
    event.publishedContent = {
      title: String(doc.title),
      ...(text(doc.subtitle) === undefined ? {} : { subtitle: text(doc.subtitle) }),
      slug: String(doc.slug),
      summary: String(doc.summary ?? ''),
      contentType: doc.contentType ?? 'news',
      body: toContractBlocks(doc.body),
      authors,
      ...(text(doc.section) === undefined ? {} : { section: text(doc.section) }),
      publishedAt: isoOf(doc.publishedAt, now),
      ...(doc.correctedAt === null || doc.correctedAt === undefined
        ? {}
        : { correctedAt: isoOf(doc.correctedAt, now) }),
      ...(text(doc.correctionNote) === undefined
        ? {}
        : { correctionNote: text(doc.correctionNote) }),
      aiAssisted: doc.aiAssisted === true,
    }
    // SEO APROVADO. Tudo aqui saiu do documento persistido, nao do pedido: o
    // que atravessa para o lado publico e a decisao do CMS, nunca a sugestao do
    // produtor. Um campo que o CMS nao aceitou simplesmente nao existe aqui.
    //
    // `approvedImageAlt` sai da MIDIA, nao da sugestao: o `alt` que vale e o
    // que sobreviveu a revisao de licenca e acessibilidade.
    const approvedImageAlt = media
      .filter((item) => item.alt !== 'sem descricao')
      .map((item) => ({ mediaId: item.mediaId, alt: item.alt }))

    // Links internos so para entidade CONFIRMADA por humano. Uma entidade nao
    // verificada viraria link interno quebrado em pagina indexavel.
    const approvedInternalLinks = entities
      .filter((entity) => INTERNAL_LINK_TARGETS.has(String(entity.entityKind)))
      .map((entity) => ({
        targetType: String(entity.entityKind) as 'movie' | 'tv_show' | 'person' | 'article',
        targetId: String(entity.entityId),
        anchorText: String(doc.title),
      }))

    event.seo = {
      ...(text(doc.metaTitle) === undefined ? {} : { metaTitle: text(doc.metaTitle) }),
      ...(text(doc.metaDescription) === undefined
        ? {}
        : { metaDescription: text(doc.metaDescription) }),
      ...(text(doc.socialTitle) === undefined ? {} : { socialTitle: text(doc.socialTitle) }),
      ...(text(doc.socialDescription) === undefined
        ? {}
        : { socialDescription: text(doc.socialDescription) }),
      noindex: doc.noindex === true,
      ...(text(doc.focusKeyphrase) === undefined
        ? {}
        : { focusKeyphrase: text(doc.focusKeyphrase) }),
      relatedKeyphrases: stringsOf(doc.relatedKeyphrases),
      editorialKeywords: stringsOf(doc.editorialKeywords),
      ...(text(doc.schemaTypeRecommendation) === undefined
        ? {}
        : {
            schemaTypeRecommendation: text(doc.schemaTypeRecommendation) as
              | 'NewsArticle'
              | 'Article'
              | 'Review'
              | 'ItemList'
              | 'HowTo',
          }),
      ...(text(doc.articleSection) === undefined
        ? {}
        : { articleSection: text(doc.articleSection) }),
      approvedImageAlt,
      approvedInternalLinks,
    }
  }

  if (eventType === 'article.retracted') {
    event.retractionReason = text(doc.retractionReason) ?? 'retratacao registrada pela redacao'
  }

  return event
}
