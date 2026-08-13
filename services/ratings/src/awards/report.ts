/**
 * report.ts — Relatorio PURO da promocao de premiacao (markdown + resumo).
 *
 * O que este relatorio existe para impedir: "41 promovidos" sozinho nao diz
 * nada sobre os 10 que nao viraram registro. Titulo sem premio e FATO, nao
 * falha — mas some se ninguem o escrever. Por isso as recusas sao AGRUPADAS por
 * motivo e contadas, e o literal bruto de um formato desconhecido aparece.
 */

import { describeCreditResolution, type AwardsRunResult } from './run.js'
import type { AwardsRejectionReason } from './types.js'

const REASON_LABEL: Readonly<Record<AwardsRejectionReason, string>> = {
  'payload-unusable': 'payload inutilizavel (nao e objeto ou Response=False)',
  'no-imdb-id': 'sem imdbID valido no payload',
  'entity-not-found': 'sem entidade local para o IMDb id',
  'awards-absent': 'campo Awards ausente ou vazio (titulo sem premio: nao vira registro)',
  'awards-not-available': 'Awards = "N/A" (titulo sem premio conhecido: nao vira registro)',
  'awards-unrecognized': 'formato de Awards nao reconhecido (literal bruto no detalhe)',
  'no-license': 'sem licenca de premiacao vigente',
  'write-refused': 'escrita recusada pelo banco (trigger de governanca)',
}

/** Uma linha de resumo para o terminal. */
export function summaryLine(result: AwardsRunResult): string {
  const c = result.counters
  return (
    `payloads=${c.payloadsRead} · reconhecidos=${c.recognized} · ` +
    `criados=${c.created} · atualizados=${c.updated} · inalterados=${c.unchanged} · ` +
    `exibiveis=${c.displayable} · recusas=${result.rejections.length} · status=${result.status}`
  )
}

/** Recusas agrupadas por motivo, com contagem. Nada some. */
export function rejectionsByReason(
  result: AwardsRunResult,
): readonly { readonly reason: AwardsRejectionReason; readonly count: number; readonly details: readonly string[] }[] {
  const groups = new Map<AwardsRejectionReason, string[]>()
  for (const rejection of result.rejections) {
    const bucket = groups.get(rejection.reason)
    if (bucket === undefined) groups.set(rejection.reason, [rejection.detail])
    else bucket.push(rejection.detail)
  }
  return [...groups.entries()].map(([reason, details]) => ({
    reason,
    count: details.length,
    details,
  }))
}

/** Relatorio markdown completo. Sem segredo, sem URL de chave, sem payload cru. */
export function renderAwardsReport(result: AwardsRunResult): string {
  const lines: string[] = []
  lines.push('# Promocao de premiacao (api_cache -> entity_awards)')
  lines.push('')
  lines.push(result.applied ? '- modo: **--apply** (escrita real)' : '- modo: **dry-run** (nada escrito)')
  lines.push(`- rede: **nenhuma** (o literal ja estava em api_cache; cota gasta: 0)`)
  lines.push(`- licenca: ${describeCreditResolution(result.creditResolution)}`)
  lines.push(`- ${summaryLine(result)}`)
  lines.push('')

  lines.push('## Recusas por motivo')
  lines.push('')
  const groups = rejectionsByReason(result)
  if (groups.length === 0) {
    lines.push('Nenhuma.')
  } else {
    for (const group of groups) {
      lines.push(`### ${REASON_LABEL[group.reason]} — ${group.count}`)
      lines.push('')
      for (const detail of group.details) lines.push(`- ${detail}`)
      lines.push('')
    }
  }

  lines.push('## Linhas')
  lines.push('')
  lines.push('| IMDb | entidade | exibivel | Awards (literal da fonte) |')
  lines.push('| --- | --- | --- | --- |')
  for (const item of result.items) {
    if (item.awardsRaw === null) continue
    const entity =
      item.entityType === null || item.entityId === null ? '—' : `${item.entityType}#${item.entityId}`
    lines.push(
      `| ${item.imdbId ?? '—'} | ${entity} | ${item.displayAllowed ? 'sim' : 'nao'} | ${item.awardsRaw.replace(/\|/g, '\\|')} |`,
    )
  }

  return lines.join('\n')
}
