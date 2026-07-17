/**
 * guardrails.ts — Guardrails PUROS da promocao de `external_ratings`.
 *
 * Uma unica funcao decide se uma nota pode ir de `display_allowed=false` para
 * `true`. Nao toca banco/rede: recebe a candidata materializada e devolve
 * `eligible` + `reason` + `detail`.
 *
 * Tres camadas dizem "nao" a mesma coisa, de proposito:
 *   1. AQUI (puro)   — explica ao operador POR QUE a nota nao pode subir, antes
 *                      de gastar um UPDATE.
 *   2. `WHERE` do adapter — reafirma o estado (defesa em profundidade).
 *   3. TRIGGER no banco   — a trava real, que vale para psql, script e seed.
 * A camada 1 existe para dar DIAGNOSTICO; ela nao e a seguranca. Se um dia ela
 * discordar do trigger, o trigger vence e a promocao simplesmente falha — nunca
 * o contrario.
 *
 * Precedencia (a primeira que bate e reportada): integridade da nota antes de
 * governanca. Uma nota com escala errada esta ERRADA — dizer "falta licenca"
 * mandaria o operador atras da licenca de um dado que nunca deveria existir.
 */

import { RATING_SCALES, RATING_SOURCES, type RatingSource } from '@screena/config'
import { evaluateRatingFreshness } from '@screena/schemas'

import type {
  RatingPromotionCandidate,
  RatingPromotionEvaluation,
  RatingPromotionRejectionReason,
  RatingRevocationEvaluation,
} from './types.js'

/** `license_status` que permitem exibicao (espelha o trigger). */
const DISPLAYABLE_LICENSE_STATUS: readonly string[] = ['official', 'licensed', 'third_party']

/** Marca -> fonte dona. Espelha LABEL_SOURCE_RULES de @screena/schemas. */
const LABEL_OWNERS: readonly (readonly [RegExp, string])[] = [
  [/tomatometer|popcornmeter|tomate/i, 'rotten_tomatoes'],
  [/imdb/i, 'imdb'],
  [/metacritic|metascore/i, 'metacritic'],
]

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

function reject(
  reason: RatingPromotionRejectionReason,
  detail: string,
): RatingPromotionEvaluation {
  return { eligible: false, reason, detail }
}

/**
 * Avalia se uma nota pode ser promovida a `display_allowed=true`.
 *
 * `ctx.now` e injetado: o teste de frescor precisa ser deterministico.
 */
export function evaluateRatingPromotionEligibility(
  candidate: RatingPromotionCandidate,
  ctx: { readonly now: Date },
): RatingPromotionEvaluation {
  if (candidate.displayAllowed) {
    return reject('already-display-allowed', 'nota ja exibivel')
  }

  // --- Integridade (invariantes 1 e 2) ---

  if (
    isBlank(candidate.providerApi) ||
    candidate.providerApi === candidate.ratingSource ||
    (RATING_SOURCES as readonly string[]).includes(candidate.providerApi as string)
  ) {
    return reject(
      'provider-is-source',
      `provider_api "${candidate.providerApi ?? '<null>'}" nao pode ser (nem ser o id de) uma fonte editorial — invariante 2`,
    )
  }

  if (!(RATING_SOURCES as readonly string[]).includes(candidate.ratingSource)) {
    return reject('scale-mismatch', `fonte "${candidate.ratingSource}" nao e editorial reconhecida`)
  }
  const expectedScale = RATING_SCALES[candidate.ratingSource as RatingSource]
  if (candidate.ratingScale !== expectedScale) {
    return reject(
      'scale-mismatch',
      `escala ${candidate.ratingScale ?? '<null>'} != escala canonica ${expectedScale} de "${candidate.ratingSource}" — invariante 1`,
    )
  }

  for (const [pattern, owner] of LABEL_OWNERS) {
    if (pattern.test(candidate.ratingLabel) && candidate.ratingSource !== owner) {
      return reject(
        'cross-label',
        `rotulo "${candidate.ratingLabel}" pertence a ${owner}, nao a ${candidate.ratingSource} — invariante 1`,
      )
    }
  }

  if (
    candidate.ratingValue === null ||
    !Number.isFinite(candidate.ratingValue) ||
    candidate.ratingValue < 0 ||
    candidate.ratingValue > expectedScale
  ) {
    return reject(
      'invalid-value',
      `valor ${candidate.ratingValue ?? '<null>'} fora da escala 0..${expectedScale}`,
    )
  }

  if (candidate.scoreType === null) {
    return reject(
      'unclassified-score-type',
      `metrica "${candidate.metric}" nao permite afirmar critics/audience — classificar antes de exibir`,
    )
  }

  // --- Governanca (invariante 6) ---

  if (!DISPLAYABLE_LICENSE_STATUS.includes(candidate.licenseStatus)) {
    return reject(
      'license-not-displayable',
      `license_status "${candidate.licenseStatus}" nao permite exibicao`,
    )
  }
  if (candidate.requiresAttribution && isBlank(candidate.attributionText)) {
    return reject('missing-attribution', 'licenca exige atribuicao e attribution_text esta vazio')
  }
  if (candidate.requiresLinkback && isBlank(candidate.attributionUrl)) {
    return reject('missing-linkback', 'licenca exige linkback e attribution_url esta vazio')
  }
  if (!isBlank(candidate.attributionUrl) && !(candidate.attributionUrl as string).startsWith('https://')) {
    return reject('unsafe-attribution-url', 'attribution_url deve ser HTTPS')
  }
  if (candidate.usageDecisionId === null) {
    return reject(
      'no-usage-decision',
      `nao ha DataUsageDecision vigente para rating_display da fonte "${candidate.ratingSource}"`,
    )
  }

  // --- Frescor ---

  const freshness = evaluateRatingFreshness({
    ratingSource: candidate.ratingSource,
    fetchedAt: candidate.fetchedAt,
    now: ctx.now,
  })
  if (freshness.state === 'unknown-fetch') {
    return reject('unknown-fetch', 'sem fetched_at confiavel: nao ha frescor a afirmar')
  }
  if (freshness.state === 'unknown-policy') {
    return reject(
      'unknown-stale-policy',
      `fonte "${candidate.ratingSource}" nao tem politica de frescor declarada`,
    )
  }
  if (freshness.state === 'expired') {
    return reject(
      'expired',
      `nota coletada ha ${Math.round(freshness.ageHours ?? 0)}h — expirada para exibicao`,
    )
  }

  return { eligible: true, reason: null, detail: null }
}

/** Avalia se uma nota pode ter a exibicao REVOGADA (`true` -> `false`). */
export function evaluateRatingRevocationEligibility(
  candidate: RatingPromotionCandidate,
): RatingRevocationEvaluation {
  if (!candidate.displayAllowed) return { eligible: false, reason: 'already-disallowed' }
  return { eligible: true, reason: null }
}

/** Host de uma URL, para o relatorio nunca despejar a URL inteira. */
export function attributionHost(url: string | null): string {
  if (isBlank(url)) return '(sem link)'
  try {
    return new URL((url as string).trim()).host || '(host vazio)'
  } catch {
    return '(link invalido)'
  }
}
