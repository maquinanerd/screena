/**
 * status.ts — O PAINEL: uma tela que responde, sem terminal, tres perguntas.
 *
 *   1. quando cada fila rodou pela ultima vez;
 *   2. o que esta atrasado;
 *   3. quanto de cota sobrou hoje.
 *
 * Nucleo PURO: monta o relatorio a partir de fatos ja coletados. O HTML e o
 * JSON saem daqui; quem os serve e o servidor de health do agendador.
 *
 * ============================================================================
 * POR QUE HTML, E NAO SO JSON
 * ============================================================================
 * O requisito e "o dono tem que enxergar sem abrir terminal". JSON cru num
 * navegador atende a letra e falha o proposito: ninguem le atraso relativo em
 * JSON. O HTML e uma tabela sem dependencia externa, sem script e sem fonte
 * remota — cabe num container sem rede de saida e num celular.
 *
 * ============================================================================
 * O QUE ESTE PAINEL NAO MOSTRA
 * ============================================================================
 * Nenhum valor de segredo, nenhuma connection string, nenhum token. Os fatos que
 * ele recebe ja sao contagens e carimbos de tempo. E ele NAO tem verbo de
 * escrita: um painel com botao de "rodar agora" exposto na rede interna seria um
 * console de administracao sem autenticacao.
 */

import type { QueueSchedule } from './due.js'
import type { StallAlert } from './stalled.js'

/** Saldo de cota de um fornecedor, medido no dia corrente. */
export interface QuotaSnapshot {
  readonly providerApi: string
  /** Teto do dia. `null` = o fornecedor nao impoe teto diario. */
  readonly dailyLimit: number | null
  /** Gasto de hoje, somado de `api_sync_logs.quota_cost`. */
  readonly spentToday: number
  /** Fatia reservada a quem espera na tela. `0` quando nao ha reserva. */
  readonly reservedForReader: number
  /** De onde veio o numero do teto (`published` | `measured` | `assumed_floor`). */
  readonly basis: string
}

/** Tudo que o painel precisa. */
export interface StatusInput {
  readonly now: Date
  readonly startedAt: Date
  readonly schedules: readonly QueueSchedule[]
  readonly alerts: readonly StallAlert[]
  readonly quotas: readonly QuotaSnapshot[]
  /** Instancia que respondeu. Duas replicas mostram ids diferentes. */
  readonly workerId: string
}

/** Uma linha do painel, ja formatada. */
export interface StatusRow {
  readonly queue: string
  readonly label: string
  readonly intervalHours: number
  readonly lastSuccessAt: string
  readonly state: 'em dia' | 'vencida' | 'PARADA' | 'NUNCA RODOU'
  readonly overdue: string
  readonly note: string
}

/** O painel inteiro, pronto para virar JSON ou HTML. */
export interface StatusReport {
  readonly generatedAt: string
  readonly workerId: string
  readonly uptimeHours: number
  /** `degraded` quando ha QUALQUER alerta. E o semaforo da tela. */
  readonly overall: 'ok' | 'degraded'
  readonly rows: readonly StatusRow[]
  readonly alerts: readonly { readonly queue: string; readonly kind: string; readonly message: string }[]
  readonly quotas: readonly (QuotaSnapshot & {
    /** Saldo do dia. `null` quando nao ha teto. */
    readonly remaining: number | null
    /** Saldo alcancavel pela fila de FUNDO (ja descontada a reserva). */
    readonly remainingForBackground: number | null
  })[]
}

const HOUR_MS = 60 * 60 * 1000

function stateOf(entry: QueueSchedule, alerts: readonly StallAlert[]): StatusRow['state'] {
  const alert = alerts.find((a) => a.queue === entry.queue)
  if (alert?.kind === 'never_ran') return 'NUNCA RODOU'
  if (alert?.kind === 'stalled') return 'PARADA'
  if (entry.lastSuccessAt === null) return 'NUNCA RODOU'
  return entry.due ? 'vencida' : 'em dia'
}

/** Monta o painel. Determinista: mesma entrada, mesmo relatorio. */
export function buildStatusReport(input: StatusInput): StatusReport {
  const rows: StatusRow[] = input.schedules.map((entry) => ({
    queue: entry.queue,
    label: entry.rhythm.label,
    intervalHours: entry.intervalHours,
    lastSuccessAt: entry.lastSuccessAt === null ? 'nunca' : entry.lastSuccessAt.toISOString(),
    state: stateOf(entry, input.alerts),
    overdue: Number.isFinite(entry.overdueRatio)
      ? `${(entry.overdueRatio * 100).toFixed(0)}%`
      : '—',
    note: entry.seasonNote,
  }))

  const quotas = input.quotas.map((quota) => {
    const remaining = quota.dailyLimit === null ? null : Math.max(0, quota.dailyLimit - quota.spentToday)
    return {
      ...quota,
      remaining,
      remainingForBackground:
        remaining === null ? null : Math.max(0, remaining - quota.reservedForReader),
    }
  })

  return {
    generatedAt: input.now.toISOString(),
    workerId: input.workerId,
    uptimeHours: Math.max(0, (input.now.getTime() - input.startedAt.getTime()) / HOUR_MS),
    overall: input.alerts.length > 0 ? 'degraded' : 'ok',
    rows,
    alerts: input.alerts.map((a) => ({ queue: a.queue, kind: a.kind, message: a.message })),
    quotas,
  }
}

/** Escapa para HTML. Nenhum valor do painel vai cru para a pagina. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Cor do estado. Vermelho SO para o que exige acao. */
function stateColor(state: StatusRow['state']): string {
  if (state === 'PARADA' || state === 'NUNCA RODOU') return '#FF3B30'
  if (state === 'vencida') return '#B8860B'
  return '#7AA66D'
}

/**
 * O painel como HTML autocontido: sem script, sem CSS remoto, sem fonte remota.
 *
 * Um `<style>` inline em vez de classes de um design system: esta pagina e
 * servida por um worker que nao compartilha build com o site, e depender do CSS
 * do site aqui criaria um acoplamento que quebra em silencio no dia em que o
 * site mudar de tema.
 */
export function renderStatusHtml(report: StatusReport): string {
  const alertBlock =
    report.alerts.length === 0
      ? '<p class="ok">Nenhuma fila parada.</p>'
      : `<ul class="alerts">${report.alerts
          .map((a) => `<li><strong>${escapeHtml(a.queue)}</strong> — ${escapeHtml(a.message)}</li>`)
          .join('')}</ul>`

  const rows = report.rows
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.label)}<br><code>${escapeHtml(row.queue)}</code></td>
      <td>${row.intervalHours}h</td>
      <td>${escapeHtml(row.lastSuccessAt)}</td>
      <td style="color:${stateColor(row.state)};font-weight:600">${escapeHtml(row.state)}</td>
      <td>${escapeHtml(row.overdue)}</td>
      <td>${escapeHtml(row.note)}</td>
    </tr>`,
    )
    .join('')

  const quotas = report.quotas
    .map(
      (q) => `<tr>
      <td><code>${escapeHtml(q.providerApi)}</code></td>
      <td>${q.dailyLimit === null ? 'sem teto diario' : String(q.dailyLimit)}</td>
      <td>${q.spentToday}</td>
      <td>${q.remaining === null ? '—' : String(q.remaining)}</td>
      <td>${q.remainingForBackground === null ? '—' : String(q.remainingForBackground)}</td>
      <td>${escapeHtml(q.basis)}</td>
    </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Cinerie — estado da ingestao</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#050505;color:#F5F5F5}
 h1{font-size:18px;margin:0 0 4px} h2{font-size:15px;margin:28px 0 8px}
 .meta{color:#999;font-size:12px;margin-bottom:16px}
 table{border-collapse:collapse;width:100%;max-width:1100px}
 th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #222;vertical-align:top}
 th{color:#999;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
 code{color:#9ab;font-size:12px}
 .alerts{margin:0;padding-left:18px;color:#FF3B30}
 .ok{color:#7AA66D;margin:0}
 .badge{display:inline-block;padding:2px 8px;border-radius:99px;font-weight:600;font-size:12px}
</style></head><body>
<h1>Estado da ingestao — <span class="badge" style="background:${
    report.overall === 'ok' ? '#7AA66D' : '#FF3B30'
  };color:#050505">${report.overall === 'ok' ? 'OK' : 'DEGRADADO'}</span></h1>
<p class="meta">gerado em ${escapeHtml(report.generatedAt)} · instancia <code>${escapeHtml(
    report.workerId,
  )}</code> · de pe ha ${report.uptimeHours.toFixed(1)}h</p>
<h2>Alertas</h2>
${alertBlock}
<h2>Filas</h2>
<table><thead><tr><th>Fila</th><th>Intervalo</th><th>Ultimo sucesso</th><th>Estado</th><th>Atraso</th><th>Nota</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Cota de hoje</h2>
<table><thead><tr><th>Fornecedor</th><th>Teto/dia</th><th>Gasto</th><th>Saldo</th><th>Saldo p/ fila de fundo</th><th>Base do teto</th></tr></thead><tbody>${quotas}</tbody></table>
</body></html>`
}

/** O painel como texto, para a CLI. */
export function renderStatusText(report: StatusReport): string {
  const lines: string[] = []
  lines.push(
    `estado da ingestao: ${report.overall.toUpperCase()} · ${report.generatedAt} · instancia ${report.workerId}`,
  )
  lines.push('')
  lines.push('FILAS')
  for (const row of report.rows) {
    lines.push(
      `  ${row.state.padEnd(12)} ${row.queue.padEnd(20)} intervalo ${String(row.intervalHours).padStart(4)}h · ` +
        `ultimo sucesso ${row.lastSuccessAt} · atraso ${row.overdue}${row.note === '' ? '' : ` · ${row.note}`}`,
    )
  }
  lines.push('')
  lines.push('COTA DE HOJE')
  for (const quota of report.quotas) {
    lines.push(
      `  ${quota.providerApi.padEnd(14)} teto ${quota.dailyLimit === null ? 'sem teto diario' : quota.dailyLimit} · ` +
        `gasto ${quota.spentToday} · saldo ${quota.remaining ?? '—'} · ` +
        `saldo p/ fila de fundo ${quota.remainingForBackground ?? '—'} · base ${quota.basis}`,
    )
  }
  lines.push('')
  if (report.alerts.length === 0) {
    lines.push('ALERTAS: nenhuma fila parada.')
  } else {
    lines.push('ALERTAS')
    for (const alert of report.alerts) lines.push(`  [${alert.kind}] ${alert.message}`)
  }
  return lines.join('\n')
}
