/**
 * report.ts — Relatorio do worker de disponibilidade. Modulo PURO.
 *
 * Nunca contem segredo, header ou payload cru — so contagens e motivos de
 * recusa. `unmapped-offer-type` e onde os `addon` aparecem: descartados de
 * proposito, nunca coagidos a `subscription`.
 */

import type { OfferRejection, OfferRejectionReason } from './types.js'
import type { StreamingRunResult } from './run.js'

/** Agrupa recusas por motivo, preservando ordem de primeira aparicao. */
export function groupOfferRejections(
  rejections: readonly OfferRejection[],
): ReadonlyArray<{ reason: OfferRejectionReason; count: number; sample: string }> {
  const order: OfferRejectionReason[] = []
  const byReason = new Map<OfferRejectionReason, { count: number; sample: string }>()

  for (const rejection of rejections) {
    const existing = byReason.get(rejection.reason)
    if (existing === undefined) {
      order.push(rejection.reason)
      byReason.set(rejection.reason, { count: 1, sample: rejection.detail })
    } else {
      existing.count += 1
    }
  }

  return order.map((reason) => {
    const entry = byReason.get(reason)
    return { reason, count: entry?.count ?? 0, sample: entry?.sample ?? '' }
  })
}

/** Forma serializavel do relatorio (sem BigInt, sem segredo). */
export interface StreamingReportJson {
  readonly provider_api: string
  readonly endpoint: string
  readonly mode: 'dry-run' | 'sample' | 'apply'
  readonly kind: string
  readonly country: string
  readonly status: string
  readonly touched_network: boolean
  readonly duration_ms: number
  readonly quota_cost: number
  readonly error_code: string | null
  readonly counters: {
    readonly entities_selected: number
    readonly entities_fetched: number
    readonly entities_failed: number
    readonly offers_recognized: number
    readonly offers_written: number
    readonly offers_deleted: number
  }
  readonly planned: readonly string[]
  readonly rejections: ReadonlyArray<{
    readonly reason: string
    readonly count: number
    readonly sample: string
  }>
}

/** Modo de execucao, para o cabecalho. */
export function runMode(options: {
  apply: boolean
  sample: boolean
}): 'dry-run' | 'sample' | 'apply' {
  if (options.apply) return 'apply'
  if (options.sample) return 'sample'
  return 'dry-run'
}

/** Monta o DTO do relatorio (nunca BigInt). */
export function buildStreamingReport(
  result: StreamingRunResult,
  options: {
    readonly apply: boolean
    readonly sample: boolean
    readonly kind: string
    readonly country: string
    readonly providerApi: string
  },
): StreamingReportJson {
  return {
    provider_api: options.providerApi,
    endpoint: result.endpoint,
    mode: runMode(options),
    kind: options.kind,
    country: options.country,
    status: result.status,
    touched_network: result.touchedNetwork,
    duration_ms: result.durationMs,
    quota_cost: result.quotaCost,
    error_code: result.errorCode,
    counters: {
      entities_selected: result.counters.entitiesSelected,
      entities_fetched: result.counters.entitiesFetched,
      entities_failed: result.counters.entitiesFailed,
      offers_recognized: result.counters.offersRecognized,
      offers_written: result.counters.offersWritten,
      offers_deleted: result.counters.offersDeleted,
    },
    planned: result.planned,
    rejections: groupOfferRejections(result.rejections).map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      sample: entry.sample,
    })),
  }
}

/** Serializa como JSON (o DTO nao tem BigInt). */
export function serializeStreamingReportJson(report: StreamingReportJson): string {
  return JSON.stringify(report, null, 2)
}

/** Renderiza o relatorio em Markdown. */
export function renderStreamingReport(report: StreamingReportJson): string {
  const lines: string[] = []
  lines.push('# Streaming Availability — relatorio de sync')
  lines.push('')
  lines.push(`- provider_api: \`${report.provider_api}\` (fornecedor TECNICO)`)
  lines.push(`- endpoint: \`${report.endpoint}\``)
  lines.push(`- modo: **${report.mode}** · tipo: \`${report.kind}\` · pais: \`${report.country}\``)
  lines.push(`- status: \`${report.status}\``)
  lines.push(`- tocou a rede: ${report.touched_network ? 'sim' : 'nao'}`)
  lines.push(`- duracao: ${report.duration_ms} ms · quota_cost: ${report.quota_cost}`)
  if (report.error_code !== null) lines.push(`- error_code: \`${report.error_code}\``)
  lines.push('')
  lines.push('## Contagens')
  lines.push('')
  lines.push(`- entidades selecionadas: ${report.counters.entities_selected}`)
  lines.push(`- entidades consultadas: ${report.counters.entities_fetched}`)
  lines.push(`- entidades com falha: ${report.counters.entities_failed}`)
  lines.push(`- ofertas reconhecidas: ${report.counters.offers_recognized}`)
  lines.push(`- ofertas gravadas: ${report.counters.offers_written}`)
  lines.push(`- ofertas removidas no replace: ${report.counters.offers_deleted}`)
  lines.push('')

  if (report.planned.length > 0) {
    lines.push('## Plano (o que seria/foi chamado)')
    lines.push('')
    for (const endpoint of report.planned) lines.push(`- \`GET ${endpoint}?country=${report.country}\``)
    lines.push('')
  }

  if (report.rejections.length > 0) {
    lines.push('## Recusas (nada gravado para estes casos)')
    lines.push('')
    lines.push('| motivo | ocorrencias | exemplo |')
    lines.push('| --- | ---: | --- |')
    for (const entry of report.rejections) {
      lines.push(`| \`${entry.reason}\` | ${entry.count} | ${entry.sample} |`)
    }
    lines.push('')
    lines.push(
      '> `unmapped-offer-type` inclui `addon`: uma camada paga dentro de outro ' +
        'servico. Nao e assinatura e nao existe no enum `OfferType` — por isso e ' +
        'descartado, nunca coagido.',
    )
    lines.push('')
  }

  lines.push('## Governanca')
  lines.push('')
  lines.push('- Toda oferta nasce `display_allowed=false` (atribuicao exigida pelos termos).')
  lines.push('- Replace transacional por `(entity, country, provider_api)`; outros providers intactos.')
  lines.push('- Somente ofertas LEGAIS; deep link so `http(s)`.')
  lines.push('- `screen_score` e `external_ratings` NAO sao tocados por este worker.')

  return lines.join('\n')
}
