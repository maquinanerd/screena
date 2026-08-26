/**
 * report.ts — O CENSO em texto. PURO (recebe o resultado, devolve string).
 *
 * O relatorio e a parte do comando que o operador realmente le, e por isso ele
 * responde as tres perguntas na ordem em que se pergunta:
 *
 *   O que autorizou isto?   (licenca + policy_version)
 *   O que vai acender?      (censo por tipo/entidade/oficialidade)
 *   O que NAO vai, e por que? (recusas por motivo)
 *
 * A terceira e a que costuma ser cortada por economia, e e a mais util: um
 * "0 elegiveis" sem motivos e indistinguivel de um bug.
 */

import type { PromotionResult } from './run.js'

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function bar(count: number, total: number, width = 24): string {
  if (total <= 0) return ''
  const filled = Math.max(0, Math.min(width, Math.round((count / total) * width)))
  return '#'.repeat(filled).padEnd(width, '.')
}

/** Cabecalho: modo, alvo e o que autorizou. */
function renderHeader(result: PromotionResult): string[] {
  const acao = result.mode === 'revoke' ? 'REVERSAO' : 'PROMOCAO'
  const modo = result.confirm ? '--confirm (MUTACAO REAL)' : 'DRY-RUN (nada muda)'
  const lines = [`${acao} de midia · alvo=${result.target} · ${modo}`, '']

  lines.push('LICENCA')
  lines.push(`  ${result.authorization.authorized ? 'AUTORIZA' : 'NEGA'}: ${result.authorization.reason}`)
  if (result.authorization.policyVersion !== null) {
    lines.push(`  policy_version: ${result.authorization.policyVersion}`)
  }
  if (result.authorization.licenseStatus !== null) {
    lines.push(`  license_status a gravar nas linhas: "${result.authorization.licenseStatus}"`)
  }
  return lines
}

/** O censo propriamente dito. */
function renderCensus(result: PromotionResult): string[] {
  const c = result.census
  const lines = ['', 'CENSO']
  lines.push(`  linhas no alvo (denominador): ${c.totalInTarget}`)
  lines.push(`  inspecionadas nesta execucao: ${c.inspected}`)
  lines.push(`  MUDARIAM de estado:           ${c.changing}`)

  if (c.byType.length > 0) {
    lines.push('', '  elegiveis por tipo:')
    for (const row of [...c.byType].sort((a, b) => b.count - a.count)) {
      lines.push(`    ${String(row.count).padStart(5)}  ${bar(row.count, c.changing)}  ${row.type}`)
    }
  }

  if (c.byEntityType.length > 0) {
    lines.push('', '  elegiveis por entidade:')
    for (const row of [...c.byEntityType].sort((a, b) => b.count - a.count)) {
      lines.push(`    ${String(row.count).padStart(5)}  ${row.entityType}`)
    }
  }

  // Sempre impresso no alvo `video`, mesmo (sobretudo) quando `--only-official`
  // esta desligado: a decisao de nao filtrar por `official` tem de ser VISTA a
  // cada execucao, nunca herdada em silencio.
  if (c.target === 'video') {
    const o = c.official
    lines.push('', '  elegiveis por oficialidade (official):')
    lines.push(`    ${String(o.yes).padStart(5)}  true  (oficial do estudio/distribuidor)`)
    lines.push(`    ${String(o.no).padStart(5)}  false (canal de terceiro)`)
    lines.push(`    ${String(o.unknown).padStart(5)}  null  (o TMDB nao informou)`)
    if (o.no + o.unknown > 0) {
      lines.push(
        `    -> ${o.no + o.unknown} linha(s) NAO-oficiais entram nesta promocao.` +
          ` Use --only-official para restringir.`,
      )
    }
  }

  if (c.byReason.length > 0) {
    lines.push('', '  RECUSADAS por motivo:')
    for (const row of [...c.byReason].sort((a, b) => b.count - a.count)) {
      lines.push(`    ${String(row.count).padStart(5)}  ${row.reason}`)
    }
  }
  return lines
}

/** O freio. */
function renderBrake(result: PromotionResult): string[] {
  if (result.brake === null) return []
  const b = result.brake
  return [
    '',
    'FREIO DE MUDANCA EM MASSA',
    `  ${b.changing}/${b.totalInTarget} = ${pct(b.changeRatio)}` +
      ` · tetos ${b.limits.maxChanges} / ${pct(b.limits.maxChangeRatio)}`,
    `  ${b.explanation}`,
  ]
}

/** O desfecho e o que fazer a seguir. */
function renderOutcome(result: PromotionResult): string[] {
  const lines = ['', 'DESFECHO']
  switch (result.outcome) {
    case 'license-denied':
      lines.push('  LICENCA NEGADA. Zero linhas lidas como candidatas, zero escritas.')
      lines.push('  Nenhuma flag desta CLI pula este gate — conserte a licenca, nao o comando.')
      break
    case 'mass-change-blocked':
      lines.push('  FREIO ACIONADO. Tudo foi calculado; ZERO linhas escritas.')
      lines.push('  Revise o censo acima e repita com --confirm-mass-change se for intencional.')
      break
    case 'nothing-to-do':
      lines.push('  Nada elegivel. Veja as recusas por motivo acima.')
      break
    case 'dry-run':
      lines.push(`  DRY-RUN: ${result.eligibleIds.length} linha(s) SERIAM mutadas. Nada mudou.`)
      lines.push('  Repita com --confirm --reviewer="Seu Nome" para aplicar.')
      break
    case 'applied':
      lines.push(`  APLICADO: ${result.updated} linha(s) mutadas.`)
      if (result.updated < result.eligibleIds.length) {
        lines.push(
          `  ATENCAO: ${result.eligibleIds.length - result.updated} elegivel(is) nao foram` +
            ' mutadas (concorrencia ou recusa do banco).',
        )
      }
      break
  }

  if (result.refusals.length > 0) {
    lines.push('', `  RECUSADAS PELO BANCO (${result.refusals.length}):`)
    for (const refusal of result.refusals.slice(0, 20)) {
      lines.push(`    #${refusal.id}: ${refusal.message}`)
    }
    if (result.refusals.length > 20) {
      lines.push(`    ... e mais ${result.refusals.length - 20}.`)
    }
  }
  return lines
}

/** Relatorio completo. */
export function renderPromotionReport(result: PromotionResult): string {
  return [
    ...renderHeader(result),
    ...renderCensus(result),
    ...renderBrake(result),
    ...renderOutcome(result),
    '',
  ].join('\n')
}

/** Uma linha resumida, para log de ciclo. */
export function summaryLine(result: PromotionResult): string {
  const c = result.census
  return (
    `${result.mode}/${result.target} · outcome=${result.outcome} · ` +
    `inspecionadas=${c.inspected} elegiveis=${c.changing} mutadas=${result.updated} ` +
    `de ${c.totalInTarget} no alvo`
  )
}
