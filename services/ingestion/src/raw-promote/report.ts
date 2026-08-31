/**
 * report.ts — Status de `api_sync_logs` e relatorio markdown/JSON da promocao
 * (P0-00f). PURO — o CLI escreve o arquivo (gitignored).
 */

import type { SyncStatus } from '../ports.js'
import type { PromoteCounts, PromoteReport } from './types.js'

/**
 * Total processado (desfechos que consumiram uma tentativa de promocao).
 *
 * `refused` ENTRA na conta: o raw foi lido, normalizado e avaliado — custou
 * trabalho. O que ele nao pode e entrar em `failed` (ver `PromoteCounts`).
 */
export function promoteProcessed(counts: PromoteCounts): number {
  return counts.created + counts.updated + counts.failed + counts.refused
}

/**
 * Status do ciclo para `api_sync_logs` (apply):
 *  - nada selecionado             -> `empty`
 *  - tudo falhou                  -> `failed`
 *  - alguma falha (parcial)       -> `partial`
 *  - tudo recusado pelo recorte   -> `empty` (rodou, nada materializou)
 *  - caso contrario               -> `success`
 *
 * Recusa NAO vira `failed` nem `partial`: nao e defeito, e a decisao de idioma
 * sendo aplicada. Mas tambem nao vira `success` quando e o ciclo INTEIRO — um
 * lote em que nada entrou e `empty`, e chamar isso de sucesso e exatamente o
 * proxy que este projeto ja pagou vinte vezes.
 */
export function derivePromoteStatus(report: PromoteReport): SyncStatus {
  const processed = promoteProcessed(report.counts)
  if (report.selected === 0) return 'empty'
  if (report.counts.failed > 0) {
    return report.counts.failed >= processed ? 'failed' : 'partial'
  }
  if (report.counts.refused > 0 && report.counts.created + report.counts.updated === 0) {
    return 'empty'
  }
  return 'success'
}

/** Renderiza o relatorio como markdown legivel (para arquivo gitignored). */
export function renderPromoteReport(report: PromoteReport): string {
  const lines: string[] = []
  lines.push(`# Cinerie · Promocao tmdb_raw -> tabelas tipadas — relatorio (${report.mode})`)
  lines.push('')
  lines.push(`- entidade: ${report.entityType}`)
  lines.push(`- baseLanguage: ${report.baseLanguage}`)
  lines.push(`- limite: ${report.limit}`)
  lines.push(`- ${report.entityType} disponiveis em tmdb_raw: ${report.available}`)
  lines.push(`- selecionados: ${report.selected}`)
  lines.push(`- duracao: ${report.durationMs} ms`)
  lines.push('')

  if (report.mode === 'dry-run') {
    lines.push('## Plano (dry-run — nada promovido)')
    lines.push('')
    lines.push(`Promoveria ${report.selected} ${report.entityType}(s) de tmdb_raw para as tabelas tipadas.`)
  } else {
    const c = report.counts
    lines.push('## Desfechos (apply)')
    lines.push('')
    lines.push('| created | updated | failed | recusados (idioma) |')
    lines.push('| ---: | ---: | ---: | ---: |')
    lines.push(`| ${c.created} | ${c.updated} | ${c.failed} | ${c.refused} |`)
    if (report.failedIds.length > 0) {
      lines.push('')
      lines.push(`- ids que falharam (amostra): ${report.failedIds.join(', ')}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/** Serializa o relatorio como JSON estavel (para `--report *.json`). */
export function serializePromoteReportJson(report: PromoteReport): string {
  return JSON.stringify(
    {
      ...report,
      processed: promoteProcessed(report.counts),
      status: report.mode === 'apply' ? derivePromoteStatus(report) : undefined,
    },
    null,
    2,
  )
}
