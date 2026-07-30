/**
 * editorial-event-mapper.ts — `publication-event-v1` -> `ProjectionEvent`. PURO.
 *
 * O contrato e a fronteira; este modulo e a traducao. A separacao existe porque
 * o nucleo de projecao nao deve conhecer a forma completa do evento (que tem
 * campos de auditoria, ator e proveniencia que o banco publico nao guarda) —
 * so o recorte que vira estado publico.
 *
 * O evento chega de FORA (fila do CMS). Aqui ele e tratado como dado nao
 * confiavel: sem passar pelo contrato, nao vira projecao.
 */

import { parsePublicationEventV1, type PublicationEventV1 } from '@screena/editorial-contracts'

import type { ProjectionBlock, ProjectionEvent, ProjectionEventType } from './editorial-projection.js'

export type EventMapping =
  | { readonly ok: true; readonly event: ProjectionEvent }
  | { readonly ok: false; readonly issues: readonly string[] }

function textOrNull(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Blocos do contrato -> blocos da projecao.
 *
 * O discriminador do contrato e `type`/`id`. O Payload persiste `blockType`/
 * `blockId`; a conversao ja aconteceu antes do evento ser emitido, e o parse
 * abaixo garante que so a forma de contrato chega ate aqui.
 */
function toProjectionBlocks(body: PublicationEventV1['publishedContent']): ProjectionBlock[] {
  if (body === undefined) return []
  return body.body.map((block) => block as unknown as ProjectionBlock)
}

/**
 * Fonte externa PRIMARIA da materia.
 *
 * `primary` e a unica que vira credito visivel (`source_name`/`source_url`);
 * as demais ficam na proveniencia do CMS. Sem uma `primary` explicita, nao
 * inventamos credito a partir da primeira da lista — creditar a fonte errada e
 * pior do que nao creditar.
 */
function primarySource(event: PublicationEventV1): { name: string | null; url: string | null } {
  const primary = event.provenance.externalSources.find((source) => source.role === 'primary')
  if (primary === undefined) return { name: null, url: null }
  return { name: textOrNull(primary.name), url: textOrNull(primary.url) }
}

export function mapPublicationEvent(raw: unknown, emissionSequence: number): EventMapping {
  const parsed = parsePublicationEventV1(raw)
  if (!parsed.ok) {
    // `path: message` — nunca o VALOR recebido. Um erro de validacao que ecoa
    // o corpo do evento vazaria a materia inteira para o log do worker.
    return { ok: false, issues: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`) }
  }

  const event = parsed.value
  const content = event.publishedContent
  const source = primarySource(event)

  return {
    ok: true,
    event: {
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      eventType: event.eventType as ProjectionEventType,
      payloadDocumentId: event.payloadDocumentId,
      emissionSequence,
      language: event.language,
      occurredAtIso: event.occurredAt,
      retractionReason: textOrNull(event.retractionReason),
      publishedContent:
        content === undefined
          ? null
          : {
              title: content.title,
              subtitle: textOrNull(content.subtitle),
              slug: content.slug,
              summary: content.summary,
              contentType: content.contentType,
              body: toProjectionBlocks(content),
              // O primeiro autor e o creditado na ficha publica; o schema do
              // banco publico guarda UM nome (`author_name`). Coautoria segue
              // registrada no CMS, que e a fonte editorial.
              authorName: content.authors[0]?.name ?? '',
              publishedAtIso: content.publishedAt,
              correctedAtIso: textOrNull(content.correctedAt),
              correctionNote: textOrNull(content.correctionNote),
              aiAssisted: content.aiAssisted,
            },
      seo:
        event.seo === undefined
          ? null
          : {
              metaTitle: textOrNull(event.seo.metaTitle),
              metaDescription: textOrNull(event.seo.metaDescription),
              noindex: event.seo.noindex,
              socialTitle: textOrNull(event.seo.socialTitle),
              socialDescription: textOrNull(event.seo.socialDescription),
              canonicalOverride: textOrNull(event.seo.canonicalOverride),
              focusKeyphrase: textOrNull(event.seo.focusKeyphrase),
              relatedKeyphrases: [...event.seo.relatedKeyphrases],
              editorialKeywords: [...event.seo.editorialKeywords],
              schemaTypeRecommendation: textOrNull(event.seo.schemaTypeRecommendation),
              articleSection: textOrNull(event.seo.articleSection),
              approvedImageAlt: event.seo.approvedImageAlt.map((item) => ({
                mediaId: item.mediaId,
                alt: item.alt,
              })),
              approvedInternalLinks: event.seo.approvedInternalLinks.map((link) => ({
                targetType: link.targetType,
                targetId: link.targetId,
                anchorText: link.anchorText,
              })),
            },
      provenance: {
        primarySourceName: source.name,
        primarySourceUrl: source.url,
        externalSources: event.provenance.externalSources.map((item) => ({
          sourceId: textOrNull(item.sourceId),
          name: item.name,
          url: item.url,
          role: item.role,
        })),
      },
      media: event.media.map((item) => ({
        mediaId: item.mediaId,
        role: item.role,
        requiresAttribution: item.requiresAttribution,
        credit: textOrNull(item.credit),
      })),
      // ENTIDADES. Atravessam INTEIRAS (kind incluido, sem filtro) de proposito:
      // o recorte de "o que o lado publico sabe vincular" mora em
      // `editorial-entity-links.ts`, que emite aviso para cada tipo recusado.
      // Filtrar aqui perderia o aviso e faria uma entidade citada desaparecer
      // sem rastro no log do worker.
      //
      // O contrato ja garante `verified: true` em todo item; o CMS so emite
      // entidade confirmada por humano.
      entities: event.entities.map((item) => ({
        entityKind: item.entityKind,
        entityId: item.entityId,
        relation: item.relation,
      })),
    },
  }
}
