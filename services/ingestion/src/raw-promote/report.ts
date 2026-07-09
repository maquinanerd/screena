/**
 * report.ts — Status de `api_sync_logs` e relatorio markdown/JSON da promocao
 * (P0-00f). PURO — o CLI escreve o arquivo (gitignored).
 */

import type { SyncStatus } from '../ports.js'
import type { PromoteCounts, PromoteReport } from './types.js'

/** Total processado (desfechos que consumiram uma tentativa de promocao). */
export function promoteProcessed(counts: PromoteCounts): number {
  return counts.created + counts.updated + counts.failed
}

/**
 * Status do ciclo para `api_sync_logs` (apply):
 *  - nada selecionado         -> `empty`
 *  - tudo falhou              -> `failed`
 *  - alguma falha (parcial)   -> `partial`
 *  - caso contrario           -> `success`
 */
export function derivePromoteStatus(report: PromoteReport): SyncStatus {
  const processed = promoteProcessed(report.counts)
  if (report.selected === 0) return 'empty'
  if (report.counts.failed > 0) {
    return report.counts.failed >= processed ? 'failed' : 'partial'
  }
  return 'success'
}

/** Renderiza o relatorio como markdown legivel (para arquivo gitignored). */
export function renderPromoteReport(report: PromoteReport): string {
  const lines: string[] = []
  lines.push(`# Screen · Promocao tmdb_raw -> tabelas tipadas — relatorio (${report.mode})`)
  lines.push('')
  lines.push(`- entidade: movie (P0-00f.1)`)
  lines.push(`- baseLanguage: ${report.baseLanguage}`)
  lines.push(`- limite: ${report.limit}`)
  lines.push(`- filmes disponiveis em tmdb_raw: ${report.available}`)
  lines.push(`- selecionados: ${report.selected}`)
  lines.push(`- duracao: ${report.durationMs} ms`)
  lines.push('')

  if (report.mode === 'dry-run') {
    lines.push('## Plano (dry-run — nada promovido)')
    lines.push('')
    lines.push(`Promoveria ${report.selected} filme(s) de tmdb_raw para as tabelas tipadas.`)
  } else {
    const c = report.counts
    lines.push('## Desfechos (apply)')
    lines.push('')
    lines.push('| created | updated | failed |')
    lines.push('| ---: | ---: | ---: |')
    lines.push(`| ${c.created} | ${c.updated} | ${c.failed} |`)
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
