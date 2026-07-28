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
    body: doc.body ?? [],
    authors: idsOf(doc.authors),
    heroMedia: idsOf(doc.heroMedia),
    gallery: idsOf(doc.gallery),
    entityReferences: doc.entityReferences ?? [],
    metaTitle: doc.metaTitle ?? null,
    metaDescription: doc.metaDescription ?? null,
    noindex: doc.noindex === true,
  }).slice(0, 32)
}

/** Monta o evento. `req` e usado so para LER autores e midia ja persistidos. */
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
      return { name: String(entry.name), url: String(entry.url), role: entry.role }
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
      body: doc.body ?? [],
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
    }
  }

  if (eventType === 'article.retracted') {
    event.retractionReason = text(doc.retractionReason) ?? 'retratacao registrada pela redacao'
  }

  return event
}
