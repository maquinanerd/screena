/**
 * report.ts — Relatorio do worker OMDb. Modulo PURO (nao escreve arquivo).
 *
 * O relatorio NUNCA contem segredo, header, URL ou payload cru — so contagens,
 * motivos de recusa e o `payload_hash`. O sample (payload sanitizado) e um
 * artefato separado, escrito pelo bin em `.data/` (gitignored).
 *
 * DUAS SECOES QUE O RELATORIO ANTERIOR NAO TINHA, e que existem porque o
 * desenho da OMDb as exige:
 *  - **por fonte editorial**: um payload rende ate tres notas de tres fontes
 *    diferentes. Um total agregado esconderia "o IMDb entrou e o Rotten
 *    Tomatoes nao", que e exatamente a pergunta operacional.
 *  - **cota**: o plano gratuito tem teto DIARIO (1.000). O relatorio diz quanto
 *    foi gasto e quanto sobra do teto.
 */

import { OMDB_FREE_TIER_DAILY_LIMIT } from '@screena/omdb-client'

import type { OmdbRunResult } from './run.js'
import type { OmdbRejection, OmdbRejectionReason } from './types.js'

/** Agrupa recusas por motivo, preservando ordem estavel de primeira aparicao. */
export function groupOmdbRejections(
  rejections: readonly OmdbRejection[],
): ReadonlyArray<{ reason: OmdbRejectionReason; count: number; sample: string }> {
  const order: OmdbRejectionReason[] = []
  const byReason = new Map<OmdbRejectionReason, { count: number; sample: string }>()

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

/** Notas reconhecidas por fonte editorial (a contagem que importa operacionalmente). */
export function countBySource(result: OmdbRunResult): ReadonlyArray<{
  readonly source: string
  readonly count: number
}> {
  const counts = new Map<string, number>()
  for (const item of result.items) {
    for (const source of item.sources) {
      counts.set(source, (counts.get(source) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => a.source.localeCompare(b.source))
}

/** Modo de execucao, para o cabecalho do relatorio. */
export function omdbRunMode(options: {
  apply: boolean
  sample: boolean
}): 'dry-run' | 'sample' | 'apply' {
  if (options.apply) return 'apply'
  if (options.sample) return 'sample'
  return 'dry-run'
}

/** Forma serializavel do relatorio (sem BigInt, sem segredo). */
export interface OmdbReportJson {
  readonly provider_api: string
  readonly endpoint: string
  readonly mode: 'dry-run' | 'sample' | 'apply'
  readonly status: string
  readonly touched_network: boolean
  readonly payload_recognized: boolean
  readonly payload_hash: string | null
  readonly duration_ms: number
  readonly error_code: string | null
  readonly quota: {
    /** Requisicoes disparadas neste ciclo (inclui retries). */
    readonly spent: number
    /** Teto diario do plano gratuito. */
    readonly daily_limit: number
    /** Sobra do teto DIARIO apos este ciclo, se ele fosse o unico do dia. */
    readonly remaining_if_only_run: number
  }
  readonly ids: {
    readonly queried: number
    readonly failed: number
    /** Nao consultados por interrupcao do lote (protecao de cota). */
    readonly skipped_batch_abort: number
    /** Pulados por coleta recente (frescor) — NAO e falha. */
    readonly skipped_fresh: number
    readonly without_entity: number
  }
  /** Janela de frescor aplicada, em horas; `null` quando desligada. */
  readonly refresh_window_hours: number | null
  readonly counters: {
    readonly items_seen: number
    readonly ratings_recognized: number
    readonly ratings_written: number
    readonly ratings_created: number
    readonly ratings_updated: number
    readonly ratings_unchanged: number
  }
  readonly by_source: ReadonlyArray<{ readonly source: string; readonly count: number }>
  readonly rejections: ReadonlyArray<{
    readonly reason: string
    readonly count: number
    readonly sample: string
  }>
}

/** Monta o DTO do relatorio (tudo `number`/`string`/`boolean` — nunca BigInt). */
export function buildOmdbReport(
  result: OmdbRunResult,
  options: { readonly apply: boolean; readonly sample: boolean; readonly providerApi: string },
): OmdbReportJson {
  const recognized =
    result.idsQueried > 0 && result.idsFailed === 0 && result.items.every((item) => item.recognized)
  const payloadHash = result.items.length === 1 ? (result.items[0]?.payloadHash ?? null) : null

  return {
    provider_api: options.providerApi,
    endpoint: result.endpoint,
    mode: omdbRunMode(options),
    status: result.status,
    touched_network: result.touchedNetwork,
    payload_recognized: recognized,
    payload_hash: payloadHash,
    duration_ms: result.durationMs,
    error_code: result.errorCode,
    quota: {
      spent: result.quotaCost,
      daily_limit: OMDB_FREE_TIER_DAILY_LIMIT,
      remaining_if_only_run: Math.max(0, OMDB_FREE_TIER_DAILY_LIMIT - result.quotaCost),
    },
    ids: {
      queried: result.idsQueried,
      failed: result.idsFailed,
      skipped_batch_abort: result.idsSkipped,
      skipped_fresh: result.idsSkippedFresh,
      without_entity: result.idsWithoutEntity,
    },
    refresh_window_hours: result.refreshWindowHours,
    counters: {
      items_seen: result.counters.itemsSeen,
      ratings_recognized: result.counters.ratingsRecognized,
      ratings_written: result.counters.ratingsWritten,
      ratings_created: result.counters.ratingsCreated,
      ratings_updated: result.counters.ratingsUpdated,
      ratings_unchanged: result.counters.ratingsUnchanged,
    },
    by_source: countBySource(result),
    rejections: groupOmdbRejections(result.rejections).map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      sample: entry.sample,
    })),
  }
}

/** Serializa o relatorio como JSON (sem replacer: o DTO nao tem BigInt). */
export function serializeOmdbReportJson(report: OmdbReportJson): string {
  return JSON.stringify(report, null, 2)
}

/** Renderiza o relatorio em Markdown legivel. */
export function renderOmdbReport(report: OmdbReportJson): string {
  const lines: string[] = []
  lines.push('# OMDb — relatorio de sync de ratings')
  lines.push('')
  lines.push(
    `- provider_api: \`${report.provider_api}\` (fornecedor TECNICO, nunca fonte editorial)`,
  )
  lines.push(`- endpoint: \`${report.endpoint}\` (chave viaja em query; nunca aparece aqui)`)
  lines.push(`- modo: **${report.mode}**`)
  lines.push(`- status: \`${report.status}\``)
  lines.push(`- tocou a rede: ${report.touched_network ? 'sim' : 'nao'}`)
  lines.push(`- forma do payload reconhecida: ${report.payload_recognized ? 'sim' : 'NAO'}`)
  lines.push(`- payload_hash: \`${report.payload_hash ?? '-'}\``)
  lines.push(`- duracao: ${report.duration_ms} ms`)
  if (report.error_code !== null) lines.push(`- error_code: \`${report.error_code}\``)
  lines.push('')

  lines.push('## Cota')
  lines.push('')
  lines.push(`- requisicoes gastas neste ciclo: **${report.quota.spent}**`)
  lines.push(`- teto do plano gratuito: ${report.quota.daily_limit} req/dia`)
  lines.push(
    `- sobra do teto se este fosse o unico ciclo do dia: ${report.quota.remaining_if_only_run}`,
  )
  lines.push(
    '- uma requisicao devolve as TRES fontes de uma vez: o teto vale em entidades/dia, nao em notas.',
  )
  lines.push('')

  lines.push('## Ids')
  lines.push('')
  lines.push(`- consultados: ${report.ids.queried}`)
  lines.push(`- com falha de rede/HTTP: ${report.ids.failed}`)
  lines.push(`- pulados por lote interrompido (protecao de cota): ${report.ids.skipped_batch_abort}`)
  lines.push(
    `- pulados por coleta recente (frescor${
      report.refresh_window_hours === null ? ' desligado' : `: ${report.refresh_window_hours}h`
    }): ${report.ids.skipped_fresh}`,
  )
  lines.push(`- sem entidade local (apply): ${report.ids.without_entity}`)
  lines.push('')

  lines.push('## Contagens')
  lines.push('')
  lines.push(`- itens vistos: ${report.counters.items_seen}`)
  lines.push(`- ratings reconhecidos: ${report.counters.ratings_recognized}`)
  lines.push(`- ratings gravados: ${report.counters.ratings_written}`)
  lines.push(`  - criados: ${report.counters.ratings_created}`)
  lines.push(`  - atualizados: ${report.counters.ratings_updated}`)
  lines.push(`- ratings inalterados (sem reescrita): ${report.counters.ratings_unchanged}`)
  lines.push('')

  lines.push('## Por fonte editorial')
  lines.push('')
  if (report.by_source.length === 0) {
    lines.push('_Nenhuma nota reconhecida._')
  } else {
    lines.push('| fonte (`rating_source`) | notas reconhecidas |')
    lines.push('| --- | ---: |')
    for (const entry of report.by_source) {
      lines.push(`| \`${entry.source}\` | ${entry.count} |`)
    }
  }
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
  lines.push('- `omdb` e o fornecedor TECNICO; as fontes sao IMDb, Rotten Tomatoes e Metacritic.')
  lines.push('- Nenhuma nota entra em `external_ratings` sem mapping inequivoco.')
  lines.push('- Toda linha nasce `display_allowed=false` e `license_status=unknown`.')
  lines.push('- A exibicao e decidida DEPOIS, pela licenca de `services/legal` + o trigger.')
  lines.push('- `screen_score` (nota editorial propria) NAO e tocado por este worker.')

  return lines.join('\n')
}
