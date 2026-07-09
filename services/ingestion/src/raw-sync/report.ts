/**
 * report.ts — Renderizacao PURA do relatorio do piloto (markdown/JSON) e derivacao
 * do status de `api_sync_logs`. Sem IO — o CLI escreve o arquivo (gitignored).
 *
 * O `api_sync_logs` guarda so o AGREGADO possivel (schema sem coluna JSON): status
 * + itemsProcessed/Created/Updated. O breakdown COMPLETO por tipo (movie/tv/person/
 * unsupported/failed/skipped/created/updated) vive neste relatorio, em `.data/`.
 */

import type { KindCounts, PayloadSizeStats, RawSyncReport, SupportedRawKind } from './types.js'
import type { SyncStatus } from '../ports.js'

/** Total processado (desfechos que consumiram uma tentativa de fetch). */
export function processedOf(counts: KindCounts): number {
  return counts.created + counts.updated + counts.skipped + counts.failed
}

/** Formata bytes como "12345 (12.1 KB)" para leitura humana no relatorio. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0'
  return `${bytes} (${(bytes / 1024).toFixed(1)} KB)`
}

/**
 * Status do ciclo para `api_sync_logs` (apply):
 *  - nada selecionado            -> `empty`
 *  - lote interrompido (teto/breaker) -> `aborted` (regra de ingestao: o abort
 *    do circuit breaker tambem gera log; sempre retomavel)
 *  - tudo falhou                 -> `failed`
 *  - alguma falha (parcial)      -> `partial`
 *  - caso contrario              -> `success`
 */
export function deriveSyncStatus(report: RawSyncReport): SyncStatus {
  const processed = processedOf(report.totals)
  if (report.selected === 0) return 'empty'
  if (report.aborted) return 'aborted'
  if (report.totals.failed > 0) {
    return report.totals.failed >= processed ? 'failed' : 'partial'
  }
  return 'success'
}

const KIND_LABEL: Record<SupportedRawKind, string> = {
  movie: 'movie',
  tv: 'tv',
  person: 'person',
}

/** Renderiza o relatorio como markdown legivel (para arquivo gitignored). */
export function renderRawSyncReport(report: RawSyncReport): string {
  const lines: string[] = []
  lines.push(`# Screen · TMDB raw sync — relatorio (${report.mode})`)
  lines.push('')
  lines.push(`- baseLanguage: ${report.baseLanguage}`)
  lines.push(
    `- limites: movie=${report.limits.movie}, tv=${report.limits.tv}, person=${report.limits.person}`,
  )
  lines.push(`- fila escaneada (scan inteiro): ${report.scanned} item(ns)`)
  lines.push(`- selecionados (suportados): ${report.selected}`)
  lines.push(`- duracao: ${report.durationMs} ms`)
  lines.push('')

  if (report.mode === 'dry-run') {
    lines.push('## Plano (dry-run — nada buscado, nada gravado)')
    lines.push('')
    lines.push('| tipo | a processar |')
    lines.push('| --- | ---: |')
    for (const kind of ['movie', 'tv', 'person'] as const) {
      lines.push(`| ${KIND_LABEL[kind]} | ${report.perKindSelected[kind]} |`)
    }
  } else {
    lines.push('## Desfechos por tipo (apply)')
    lines.push('')
    lines.push('| tipo | selecionado | created | updated | skipped | failed |')
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |')
    for (const kind of ['movie', 'tv', 'person'] as const) {
      const c = report.perKind[kind]
      lines.push(
        `| ${KIND_LABEL[kind]} | ${report.perKindSelected[kind]} | ${c.created} | ${c.updated} | ${c.skipped} | ${c.failed} |`,
      )
    }
    const t = report.totals
    lines.push(
      `| **total** | ${report.selected} | ${t.created} | ${t.updated} | ${t.skipped} | ${t.failed} |`,
    )
    lines.push('')
    lines.push(`- requisicoes (fetch): ${report.requests}`)
    lines.push(`- retries transitorios (core): ${report.retries} (dos quais 429: ${report.rate429})`)
    if (report.aborted) {
      lines.push(
        `- **ABORTADO** (${report.abortReason ?? 'desconhecido'}): ${report.notProcessed} item(ns) NAO processado(s) — retomavel no proximo ciclo (nada gravado para eles).`,
      )
    }

    lines.push('')
    lines.push('## Tamanho de payload por tipo')
    lines.push('')
    lines.push('_(bytes UTF-8 da serializacao canonica usada no hash; inclui skip)_')
    lines.push('')
    lines.push('| tipo | amostras | media | maximo | minimo |')
    lines.push('| --- | ---: | ---: | ---: | ---: |')
    for (const kind of ['movie', 'tv', 'person'] as const) {
      const s: PayloadSizeStats = report.payloadSizes[kind]
      lines.push(
        `| ${KIND_LABEL[kind]} | ${s.count} | ${formatBytes(s.avgBytes)} | ${formatBytes(s.maxBytes)} | ${formatBytes(s.minBytes)} |`,
      )
    }
    const pt = report.payloadSizesTotal
    lines.push(
      `| **total** | ${pt.count} | ${formatBytes(pt.avgBytes)} | ${formatBytes(pt.maxBytes)} | ${formatBytes(pt.minBytes)} |`,
    )
  }

  lines.push('')
  lines.push('## Nao suportados (contados, fora do piloto)')
  lines.push('')
  lines.push(`- total unsupportedSkipped: ${report.unsupportedSkipped}`)
  const entries = Object.entries(report.unsupportedByKind).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length > 0) {
    lines.push('')
    lines.push('| tipo | contagem |')
    lines.push('| --- | ---: |')
    for (const [kind, count] of entries) lines.push(`| ${kind} | ${count} |`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Serializa o relatorio como JSON estavel (para `--report *.json`). */
export function serializeRawSyncReportJson(report: RawSyncReport): string {
  return JSON.stringify(
    {
      ...report,
      processed: processedOf(report.totals),
      status: report.mode === 'apply' ? deriveSyncStatus(report) : undefined,
    },
    null,
    2,
  )
}
