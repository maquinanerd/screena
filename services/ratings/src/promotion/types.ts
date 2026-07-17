/**
 * types.ts — Tipos da revisao/promocao de `external_ratings`. Modulo PURO.
 *
 * Espelha `services/streaming/src/promotion/types.ts`: mesmo vocabulario, mesma
 * disciplina. A promocao apenas vira `display_allowed` de `false` para `true`
 * numa nota JA gravada. Nunca cria linha, nunca altera valor de nota, nunca
 * inventa licenca, nunca encosta em watch_availability/screen_score.
 */

import type { RatingScoreType } from '@screena/config'

/**
 * Uma nota candidata: o subconjunto de `external_ratings` que os guardrails e o
 * relatorio inspecionam. `id`/`entityId` sao BigInt serializados como string
 * (BigInt nunca vaza para o relatorio JSON).
 */
export interface RatingPromotionCandidate {
  readonly id: string
  readonly entityType: string
  readonly entityId: string
  /** Titulo original da entidade, quando facil de obter; senao `null`. */
  readonly title: string | null
  readonly ratingSource: string
  readonly ratingLabel: string
  readonly metric: string
  readonly scoreType: RatingScoreType | null
  readonly ratingValue: number | null
  readonly ratingScale: number | null
  readonly ratingCount: number | null
  readonly ratingUrl: string | null
  readonly providerApi: string | null
  readonly licenseStatus: string
  readonly requiresAttribution: boolean
  readonly requiresLinkback: boolean
  readonly attributionText: string | null
  readonly attributionUrl: string | null
  readonly fetchedAt: Date | null
  readonly displayAllowed: boolean
  /** Decisao de uso vigente para `rating_display` desta fonte; `null` se nao ha. */
  readonly usageDecisionId: string | null
}

/**
 * Motivos de recusa de uma promocao.
 *
 * Os quatro primeiros sao integridade (a nota esta ERRADA e nunca deveria ser
 * exibida); os demais sao governanca (a nota pode estar certa, mas ninguem
 * autorizou mostra-la ainda).
 */
export type RatingPromotionRejectionReason =
  /** Ja exibivel — nada a promover. */
  | 'already-display-allowed'
  /** `provider_api` ausente, igual a fonte, ou e o id de uma fonte editorial (inv. 2). */
  | 'provider-is-source'
  /** Escala nao corresponde a escala canonica da fonte (inv. 1). */
  | 'scale-mismatch'
  /** Rotulo cita marca de outra fonte (inv. 1). */
  | 'cross-label'
  /** Valor ausente ou fora da escala. */
  | 'invalid-value'
  /** `score_type` nao classificado — critics/audience nunca se misturam. */
  | 'unclassified-score-type'
  /** `license_status` nao permite exibicao (inv. 6). */
  | 'license-not-displayable'
  /** Licenca exige atribuicao e nao ha `attribution_text`. */
  | 'missing-attribution'
  /** Licenca exige linkback e nao ha `attribution_url`. */
  | 'missing-linkback'
  /** `attribution_url` nao e HTTPS. */
  | 'unsafe-attribution-url'
  /** Nao ha DataUsageDecision vigente para `rating_display` desta fonte. */
  | 'no-usage-decision'
  /** Sem `fetched_at`: nao ha como afirmar frescor. */
  | 'unknown-fetch'
  /** Fonte sem politica de frescor declarada. */
  | 'unknown-stale-policy'
  /** Nota velha demais para ser apresentada como atual. */
  | 'expired'

/** Motivos de recusa de uma revogacao. */
export type RatingRevocationRejectionReason = 'already-disallowed'

/** Decisao sobre uma promocao. */
export interface RatingPromotionEvaluation {
  readonly eligible: boolean
  readonly reason: RatingPromotionRejectionReason | null
  /** Detalhe humano do motivo (relatorio); `null` quando elegivel. */
  readonly detail: string | null
}

/** Decisao sobre uma revogacao. */
export interface RatingRevocationEvaluation {
  readonly eligible: boolean
  readonly reason: RatingRevocationRejectionReason | null
}
