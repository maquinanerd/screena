/**
 * report.ts — Relatorio do worker de ratings. Modulo PURO (nao escreve arquivo).
 *
 * O relatorio NUNCA contem segredo, header ou payload cru — so contagens,
 * motivos de recusa e o `payload_hash`. O sample (payload sanitizado) e um
 * artefato separado, escrito pelo bin em `.data/` (gitignored).
 */

import type { RatingRejection, RatingRejectionReason } from './types.js'
import type { RatingsItemRunResult, RatingsRunResult } from './run.js'

/** Agrupa recusas por motivo, preservando ordem estavel de primeira aparicao. */
export function groupRejections(
  rejections: readonly RatingRejection[],
): ReadonlyArray<{ reason: RatingRejectionReason; count: number; sample: string }> {
  const order: RatingRejectionReason[] = []
  const byReason = new Map<RatingRejectionReason, { count: number; sample: string }>()

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
export interface RatingsReportJson {
  readonly provider_api: string
  readonly endpoint: string
  readonly mode: 'dry-run' | 'sample' | 'apply'
  readonly status: string
  readonly touched_network: boolean
  readonly payload_recognized: boolean
  readonly payload_hash: string | null
  readonly duration_ms: number
  readonly quota_cost: number
  readonly error_code: string | null
  readonly counters: {
    readonly items_seen: number
    readonly ratings_recognized: number
    readonly ratings_written: number
    readonly ratings_created: number
    readonly ratings_updated: number
    readonly ratings_unchanged: number
  }
  readonly rejections: ReadonlyArray<{
    readonly reason: string
    readonly count: number
    readonly sample: string
  }>
  /** Item enrichment (`/item/`): quantos ids foram consultados. Ausente no popular. */
  readonly ids_queried?: number
  /** Item enrichment: ids cuja busca de rede falhou. */
  readonly ids_failed?: number
  /** Item enrichment: ids nao consultados por interrupcao do lote (protecao de quota). */
  readonly ids_skipped?: number
  /** Item enrichment: ids (sob apply) com ratings porem SEM entidade local. */
  readonly ids_without_entity?: number
}

/** Modo de execucao, para o cabecalho do relatorio. */
export function runMode(options: { apply: boolean; sample: boolean }): 'dry-run' | 'sample' | 'apply' {
  if (options.apply) return 'apply'
  if (options.sample) return 'sample'
  return 'dry-run'
}

/** Monta o DTO do relatorio (tudo `number`/`string`/`boolean` — nunca BigInt). */
export function buildRatingsReport(
  result: RatingsRunResult,
  options: { readonly apply: boolean; readonly sample: boolean; readonly providerApi: string },
): RatingsReportJson {
  return {
    provider_api: options.providerApi,
    endpoint: result.endpoint,
    mode: runMode(options),
    status: result.status,
    touched_network: result.touchedNetwork,
    payload_recognized: result.recognized,
    payload_hash: result.payloadHash,
    duration_ms: result.durationMs,
    quota_cost: result.quotaCost,
    error_code: result.errorCode,
    counters: {
      items_seen: result.counters.itemsSeen,
      ratings_recognized: result.counters.ratingsRecognized,
      ratings_written: result.counters.ratingsWritten,
      ratings_created: result.counters.ratingsCreated,
      ratings_updated: result.counters.ratingsUpdated,
      ratings_unchanged: result.counters.ratingsUnchanged,
    },
    rejections: groupRejections(result.rejections).map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      sample: entry.sample,
    })),
  }
}

/**
 * Monta o DTO do relatorio a partir de um ciclo de ITEM enrichment (`/item/`).
 *
 * Reusa `groupRejections`/`runMode` e adiciona a contabilidade por id (quantos
 * consultados, quantos falharam, quantos sem entidade local). `payload_hash` so
 * e preenchido quando exatamente um id foi consultado.
 */
export function buildItemRatingsReport(
  result: RatingsItemRunResult,
  options: { readonly apply: boolean; readonly sample: boolean; readonly providerApi: string },
): RatingsReportJson {
  const recognized =
    result.idsQueried > 0 && result.idsFailed === 0 && result.items.every((item) => item.recognized)
  const payloadHash = result.items.length === 1 ? (result.items[0]?.payloadHash ?? null) : null

  return {
    provider_api: options.providerApi,
    endpoint: result.endpoint,
    mode: runMode(options),
    status: result.status,
    touched_network: result.touchedNetwork,
    payload_recognized: recognized,
    payload_hash: payloadHash,
    duration_ms: result.durationMs,
    quota_cost: result.quotaCost,
    error_code: result.errorCode,
    counters: {
      items_seen: result.counters.itemsSeen,
      ratings_recognized: result.counters.ratingsRecognized,
      ratings_written: result.counters.ratingsWritten,
      ratings_created: result.counters.ratingsCreated,
      ratings_updated: result.counters.ratingsUpdated,
      ratings_unchanged: result.counters.ratingsUnchanged,
    },
    rejections: groupRejections(result.rejections).map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      sample: entry.sample,
    })),
    ids_queried: result.idsQueried,
    ids_failed: result.idsFailed,
    ids_skipped: result.idsSkipped,
    ids_without_entity: result.idsWithoutEntity,
  }
}

/** Serializa o relatorio como JSON (sem replacer: o DTO nao tem BigInt). */
export function serializeRatingsReportJson(report: RatingsReportJson): string {
  return JSON.stringify(report, null, 2)
}

/** Renderiza o relatorio em Markdown legivel. */
export function renderRatingsReport(report: RatingsReportJson): string {
  const lines: string[] = []
  lines.push('# Film/Show Ratings — relatorio de sync')
  lines.push('')
  lines.push(`- provider_api: \`${report.provider_api}\` (fornecedor TECNICO, nunca fonte editorial)`)
  lines.push(`- endpoint: \`${report.endpoint}\``)
  lines.push(`- modo: **${report.mode}**`)
  lines.push(`- status: \`${report.status}\``)
  lines.push(`- tocou a rede: ${report.touched_network ? 'sim' : 'nao'}`)
  lines.push(`- forma do payload reconhecida: ${report.payload_recognized ? 'sim' : 'NAO'}`)
  lines.push(`- payload_hash: \`${report.payload_hash ?? '-'}\``)
  lines.push(`- duracao: ${report.duration_ms} ms · quota_cost: ${report.quota_cost}`)
  if (report.error_code !== null) lines.push(`- error_code: \`${report.error_code}\``)
  lines.push('')
  lines.push('## Contagens')
  lines.push('')
  if (report.ids_queried !== undefined) {
    lines.push(`- ids consultados (\`/item/\`): ${report.ids_queried}`)
    lines.push(`- ids com falha de rede/HTTP: ${report.ids_failed ?? 0}`)
    lines.push(`- ids pulados (lote interrompido, protecao de quota): ${report.ids_skipped ?? 0}`)
    lines.push(`- ids sem entidade local (apply): ${report.ids_without_entity ?? 0}`)
  }
  lines.push(`- itens vistos: ${report.counters.items_seen}`)
  lines.push(`- ratings reconhecidos: ${report.counters.ratings_recognized}`)
  lines.push(`- ratings gravados: ${report.counters.ratings_written}`)
  lines.push(`  - criados: ${report.counters.ratings_created}`)
  lines.push(`  - atualizados: ${report.counters.ratings_updated}`)
  lines.push(`- ratings inalterados (sem reescrita): ${report.counters.ratings_unchanged}`)
  lines.push('')

  if (report.rejections.length > 0) {
    lines.push('## Recusas (nada gravado para estes casos)')
    lines.push('')
    lines.push('| motivo | ocorrencias | exemplo |')
    lines.push('| --- | ---: | --- |')
    for (const entry of report.rejections) {
      lines.push(`| \`${entry.reason}\` | ${entry.count} | ${entry.sample} |`)
    }
    lines.push('')
  }

  lines.push('## Governanca')
  lines.push('')
  lines.push('- Nenhuma nota entra em `external_ratings` sem mapping inequivoco.')
  lines.push('- Toda linha nasce `display_allowed=false` e `license_status=unknown`.')
  lines.push('- `screen_score` (nota editorial propria) NAO e tocado por este worker.')
  lines.push('- Zero exibicao publica nesta fase.')

  return lines.join('\n')
}
