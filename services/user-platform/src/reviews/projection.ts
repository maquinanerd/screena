/**
 * projection.ts — Projecao PUBLICA segura de review (Backend C, unidade C5B).
 *
 * PURO e DETERMINISTICO: sem rede, sem DB, sem relogio. Mapper por WHITELIST:
 * o DTO publico e construido campo a campo a partir de uma lista fechada de
 * campos seguros — nunca por "remocao" de campos sensiveis (que vazaria se um
 * campo novo surgisse). NUNCA inclui:
 *   userId, entityId, deletedAt, publishedAt, status interno, moderationNote,
 *   reasonCode, reporterId, motivo de denuncia, e-mail, hash, sessao, IP,
 *   nota numerica, rating externo, Cinerie Score.
 *
 * Datas em ISO 8601 UTC (nunca Date/BigInt no DTO publico).
 *
 * SPOILER: review com `containsSpoiler=true` esconde o CORPO por default
 * (`body=null`, `bodyHidden=true`). So uma opcao EXPLICITA
 * `includeSpoilerBody=true` libera o corpo — nunca vaza trecho/snippet/primeira
 * linha por acidente. O `contains_spoiler` de `user_ratings` (C5A) NUNCA e
 * consultado aqui: a fonte e a propria review.
 */

import type { ReviewModerationStatus, Visibility } from "../core/types.js";
import { canRenderPublicly } from "./review.js";
import type { ReviewableEntityType } from "./types.js";

/** Entrada da projecao publica (campos lidos da review persistida). */
export interface ReviewForProjection {
  readonly entityType: ReviewableEntityType;
  readonly title: string | null;
  readonly body: string;
  readonly containsSpoiler: boolean;
  readonly status: ReviewModerationStatus;
  readonly visibility: Visibility;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PublicReviewOptions {
  /** Handle publico do autor JA resolvido pelo chamador (nunca o userId). */
  readonly authorPublicHandle?: string | null;
  /** Consentimento EXPLICITO para revelar o corpo de review com spoiler. */
  readonly includeSpoilerBody?: boolean;
}

/** DTO PUBLICO de review — apenas campos seguros e aprovados. */
export interface PublicReviewDTO {
  readonly entityType: ReviewableEntityType;
  readonly title: string | null;
  /** Corpo em texto plano; `null` quando protegido por spoiler. */
  readonly body: string | null;
  readonly bodyHidden: boolean;
  readonly containsSpoiler: boolean;
  readonly authorHandle: string | null;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  /** ISO 8601 UTC. */
  readonly updatedAt: string;
}

/**
 * Projeta uma review para o DTO publico, ou `null` quando ela NAO e
 * publicamente renderavel (so approved + public + nao deletada rende; qualquer
 * outro estado => null, nunca DTO parcial com corpo vazado).
 *
 * Review com spoiler: por default `body=null` e `bodyHidden=true`; so
 * `includeSpoilerBody === true` (consentimento explicito do consumidor) libera
 * o corpo.
 */
export function toPublicReview(
  review: ReviewForProjection,
  options: PublicReviewOptions = {},
): PublicReviewDTO | null {
  if (
    !canRenderPublicly({
      status: review.status,
      visibility: review.visibility,
      deletedAt: review.deletedAt,
    })
  ) {
    return null;
  }

  const revealSpoilerBody = options.includeSpoilerBody === true;
  const bodyHidden = review.containsSpoiler && !revealSpoilerBody;

  return {
    entityType: review.entityType,
    title: review.title,
    body: bodyHidden ? null : review.body,
    bodyHidden,
    containsSpoiler: review.containsSpoiler,
    authorHandle: options.authorPublicHandle ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}
