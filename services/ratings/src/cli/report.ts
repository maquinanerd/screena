/**
 * report.ts — Relatorios PUROS da CLI `pnpm ratings`.
 *
 * Regra que atravessa o arquivo: o relatorio NUNCA imprime segredo, chave,
 * payload cru nem URL inteira. Host, contagem e hash — nunca o conteudo. Um
 * relatorio colado num ticket nao pode virar vazamento.
 */

import type { MetricsSnapshot } from '../metrics.js'
import { attributionHost } from '../promotion/guardrails.js'
import type {
  RatingPromotionCandidate,
  RatingPromotionEvaluation,
  RatingPromotionRejectionReason,
} from '../promotion/types.js'

/** Uma candidata + o veredito dos guardrails. */
export interface EvaluatedCandidate {
  readonly candidate: RatingPromotionCandidate
  readonly evaluation: RatingPromotionEvaluation
}

/** Sumario de um lote avaliado. */
export interface ReviewSummary {
  readonly total: number
  readonly eligible: number
  readonly rejected: number
  readonly byReason: Readonly<Record<string, number>>
}

/** Agrega vereditos por motivo (o "porque nao subiu" agregado). */
export function summarizeEvaluations(evaluated: readonly EvaluatedCandidate[]): ReviewSummary {
  const byReason: Record<string, number> = {}
  let eligible = 0
  for (const item of evaluated) {
    if (item.evaluation.eligible) {
      eligible += 1
      continue
    }
    const reason = item.evaluation.reason ?? 'unknown'
    byReason[reason] = (byReason[reason] ?? 0) + 1
  }
  return { total: evaluated.length, eligible, rejected: evaluated.length - eligible, byReason }
}

/** Forma JSON de uma candidata (sanitizada). */
export interface CandidateJson {
  readonly id: string
  readonly entity: string
  readonly title: string | null
  readonly source: string
  readonly label: string
  readonly metric: string
  readonly scoreType: string | null
  readonly value: number | null
  readonly scale: number | null
  readonly count: number | null
  readonly providerApi: string | null
  readonly licenseStatus: string
  /** SO o host da atribuicao — nunca a URL completa. */
  readonly attributionHost: string
  readonly hasUsageDecision: boolean
  readonly fetchedAt: string | null
  readonly displayAllowed: boolean
  readonly eligible: boolean
  readonly reason: RatingPromotionRejectionReason | null
  readonly detail: string | null
}

/** Projeta uma candidata avaliada para JSON sanitizado. */
export function toCandidateJson(item: EvaluatedCandidate): CandidateJson {
  const c = item.candidate
  return {
    id: c.id,
    entity: `${c.entityType}:${c.entityId}`,
    title: c.title,
    source: c.ratingSource,
    label: c.ratingLabel,
    metric: c.metric,
    scoreType: c.scoreType,
    value: c.ratingValue,
    scale: c.ratingScale,
    count: c.ratingCount,
    providerApi: c.providerApi,
    licenseStatus: c.licenseStatus,
    attributionHost: attributionHost(c.attributionUrl),
    hasUsageDecision: c.usageDecisionId !== null,
    fetchedAt: c.fetchedAt === null ? null : c.fetchedAt.toISOString(),
    displayAllowed: c.displayAllowed,
    eligible: item.evaluation.eligible,
    reason: item.evaluation.reason,
    detail: item.evaluation.detail,
  }
}

/**
 * Relatorio completo em JSON.
 *
 * `RatingsCliReportJson` e nao `RatingsReportJson`: o worker de sync
 * (film-show-ratings/report.ts) ja usa esse nome para outra coisa (o relatorio
 * do ciclo de sync). Dois tipos com o mesmo nome no barrel do pacote seriam uma
 * ambiguidade que o consumidor resolveria por sorte.
 */
export interface RatingsCliReportJson {
  readonly command: string
  readonly mode: 'dry-run' | 'apply'
  readonly summary: ReviewSummary
  readonly candidates: readonly CandidateJson[]
  readonly metrics: MetricsSnapshot
}

/** Monta o relatorio JSON (sanitizado). */
export function buildReportJson(input: {
  readonly command: string
  readonly mode: 'dry-run' | 'apply'
  readonly evaluated: readonly EvaluatedCandidate[]
  readonly metrics: MetricsSnapshot
}): RatingsCliReportJson {
  return {
    command: input.command,
    mode: input.mode,
    summary: summarizeEvaluations(input.evaluated),
    candidates: input.evaluated.map(toCandidateJson),
    metrics: input.metrics,
  }
}

/**
 * Relatorio de texto para leitura humana.
 *
 * Reporta o que a missao pede num sample: campos, reconhecidas, recusadas,
 * escalas, votos, rotulos, licenca, drift e hashes.
 */
export function renderReport(report: RatingsCliReportJson): string {
  const lines: string[] = []
  lines.push(`# ratings ${report.command} — modo: ${report.mode}`)
  lines.push('')
  lines.push(
    `Total: ${report.summary.total} | elegiveis: ${report.summary.eligible} | recusadas: ${report.summary.rejected}`,
  )

  if (report.summary.rejected > 0) {
    lines.push('')
    lines.push('## Recusas por motivo')
    for (const [reason, count] of Object.entries(report.summary.byReason).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${count.toString().padStart(4)}  ${reason}`)
    }
  }

  if (report.candidates.length > 0) {
    lines.push('')
    lines.push('## Notas')
    for (const c of report.candidates) {
      const mark = c.eligible ? 'OK ' : '-- '
      // Escala SEMPRE explicita: "8.4" sozinho e ambiguo, "8.4/10" nao e.
      const value = c.value === null ? '?' : `${c.value}/${c.scale ?? '?'}`
      const votes = c.count === null ? 'votos=?' : `votos=${c.count}`
      lines.push(
        `${mark}[${c.id}] ${c.entity} ${c.title ?? ''}`.trimEnd(),
      )
      lines.push(
        `      ${c.source} "${c.label}" (${c.metric}, ${c.scoreType ?? 'NAO CLASSIFICADO'}) ${value} ${votes}`,
      )
      lines.push(
        `      provider=${c.providerApi ?? '<null>'} licenca=${c.licenseStatus} decisao=${c.hasUsageDecision ? 'sim' : 'NAO'} atribuicao=${c.attributionHost}`,
      )
      if (!c.eligible) lines.push(`      recusada: ${c.reason} — ${c.detail ?? ''}`)
    }
  }

  lines.push('')
  lines.push('## Metricas')
  for (const [name, value] of Object.entries(report.metrics).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${name} ${value}`)
  }

  if (report.mode === 'dry-run') {
    lines.push('')
    lines.push('DRY-RUN: nada foi escrito. Use --apply (sync) ou --confirm (promote/revoke).')
  }

  return lines.join('\n')
}
