/**
 * status.ts — O PAINEL: uma tela que responde, sem terminal, quatro perguntas.
 *
 *   1. quando cada fila rodou pela ultima vez;
 *   2. o que esta atrasado;
 *   3. quanto de cota sobrou hoje;
 *   4. O TRABALHO SAIU DA FILA? (`catalog_jobs`, por tipo de job)
 *
 * ============================================================================
 * A QUARTA PERGUNTA FOI ACRESCENTADA DEPOIS, E ELA E A QUE FALTAVA
 * ============================================================================
 * As tres primeiras medem o AGENDADOR. Nenhuma delas mede o TRABALHO. Em
 * 2026-08-21 mediu-se 534 jobs `pending` em `catalog_jobs`, nenhum jamais
 * processado, com este painel exibindo nove filas verdes e o semaforo em OK.
 *
 * Nao havia bug nas tres primeiras: o agendador tiquetaqueou e enfileirou, e foi
 * exatamente isso que elas relataram. O erro era de ESCOPO — o painel afirmava
 * um estado de ingestao lendo so a metade produtora dela.
 *
 * A quarta pergunta vem de `backlog.ts` e entra no semaforo: um tipo de job
 * represado deixa o painel `degraded`, com a contagem e a idade na tela.
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

import type { BacklogReport, BacklogRow } from './backlog.js'
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
  /**
   * O estado de `catalog_jobs`, por tipo de job.
   *
   * OBRIGATORIO de proposito. Nasceu opcional na primeira escrita e voltou a
   * obrigatorio antes do commit: um painel que PODE ser montado sem a fila e um
   * painel que um dia sera montado sem a fila, e o defeito que este campo existe
   * para fechar e exatamente esse. Os dois bins que montam o relatorio
   * (`cinerie-scheduler.ts`, `ingestion-status.ts`) estao em
   * `tsconfig.runtime.json`, entao esquecer o campo e erro de compilacao.
   */
  readonly backlog: BacklogReport
  /** Instancia que respondeu. Duas replicas mostram ids diferentes. */
  readonly workerId: string
}

/**
 * O QUE a linha esta medindo. Duas filas medem coisa diferente das outras.
 *
 * ============================================================================
 * A CONFUSAO QUE ESTE CAMPO DESFAZ
 * ============================================================================
 * Fila que consome FORNECEDOR tem o ultimo sucesso lido de `api_sync_logs` — um
 * registro de que o CICLO rodou. Fila DERIVADA (`cinerie_score`,
 * `search_projection`, as de `providerApi: null`) nao consome fornecedor nenhum,
 * e gravar linha de sync para ela afirmaria um sync externo que nao houve. Para
 * essas duas o ultimo sucesso vem do ARTEFATO que elas produzem
 * (`MAX(cinerie_score_calculations.calculated_at)`,
 * `MAX(search_documents.updated_at)`).
 *
 * A escolha e melhor para detectar artefato velho — mas ela COLAPSA dois
 * estados que pedem acoes opostas:
 *
 *   "o agendador nunca tentou"        -> conserto de deploy/config
 *   "tentou e produziu ZERO"          -> conserto de dado (falta insumo)
 *
 * Os dois apareciam identicos, como `NUNCA RODOU`. Sem este campo, o operador
 * lia "nunca rodou" e ia procurar um agendador parado que estava funcionando.
 */
export type StatusMeasuredBy =
  /** `api_sync_logs`: afirma que o CICLO rodou. */
  | 'ciclo'
  /** O artefato produzido: afirma que o TRABALHO saiu, nao que foi tentado. */
  | 'artefato'

/** Uma linha do painel, ja formatada. */
export interface StatusRow {
  readonly queue: string
  readonly label: string
  readonly intervalHours: number
  readonly lastSuccessAt: string
  readonly state: 'em dia' | 'vencida' | 'PARADA' | 'NUNCA RODOU'
  readonly overdue: string
  readonly note: string
  /** Ver {@link StatusMeasuredBy}. */
  readonly measuredBy: StatusMeasuredBy
}

/** O painel inteiro, pronto para virar JSON ou HTML. */
export interface StatusReport {
  readonly generatedAt: string
  readonly workerId: string
  readonly uptimeHours: number
  /**
   * `degraded` quando ha QUALQUER alerta — de fila parada OU de fila represada.
   *
   * As duas fontes entram no MESMO semaforo. Ter um semaforo por fonte deixaria
   * o dono escolher qual olhar, e ele escolheria o verde.
   */
  readonly overall: 'ok' | 'degraded'
  readonly rows: readonly StatusRow[]
  /** O estado de `catalog_jobs`, ja julgado. Ver `backlog.ts`. */
  readonly backlog: BacklogReport
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
    // `providerApi: null` E a definicao de fila derivada na tabela de ritmos.
    // Derivar daqui evita uma segunda lista de nomes que divergiria da primeira.
    measuredBy: entry.rhythm.providerApi === null ? 'artefato' : 'ciclo',
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

  // O semaforo soma as DUAS fontes. Antes lia so `input.alerts` (fila parada), e
  // era por isso que 534 jobs represados cabiam num painel "OK".
  const degraded = input.alerts.length > 0 || input.backlog.alerts.length > 0

  return {
    generatedAt: input.now.toISOString(),
    workerId: input.workerId,
    uptimeHours: Math.max(0, (input.now.getTime() - input.startedAt.getTime()) / HOUR_MS),
    overall: degraded ? 'degraded' : 'ok',
    rows,
    backlog: input.backlog,
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
 * Cor do estado da FILA DE JOBS.
 *
 * `vazia` e cinza, nao verde: "nao ha job deste tipo" nao e saude, e ausencia.
 * Pintar ausencia de verde e a mesma classe de mentira que este painel existe
 * para nao repetir.
 */
function backlogColor(state: BacklogRow['state']): string {
  if (state === 'REPRESADA') return '#FF3B30'
  if (state === 'vazia') return '#999999'
  return '#7AA66D'
}

/** Idade formatada do pendente mais antigo. Nunca "—" quando ha pendente. */
function oldestPendingLabel(row: BacklogRow): string {
  if (row.oldestPendingHours === null) return '—'
  return `${row.oldestPendingHours.toFixed(1)}h`
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
  // Os dois tipos de alerta na MESMA lista: quem abre o painel as 3 da manha nao
  // deve ter de descobrir que ha uma segunda lista mais abaixo.
  const todosOsAlertas = [
    ...report.alerts.map((a) => ({ chave: a.queue, mensagem: a.message })),
    ...report.backlog.alerts.map((a) => ({ chave: a.jobType, mensagem: a.message })),
  ]
  const alertBlock =
    todosOsAlertas.length === 0
      ? '<p class="ok">Nenhuma fila parada e nenhuma fila represada.</p>'
      : `<ul class="alerts">${todosOsAlertas
          .map((a) => `<li><strong>${escapeHtml(a.chave)}</strong> — ${escapeHtml(a.mensagem)}</li>`)
          .join('')}</ul>`

  const backlogRows = report.backlog.rows
    .map(
      (row) => `<tr>
      <td><code>${escapeHtml(row.jobType)}</code></td>
      <td style="color:${row.pending > 0 ? '#FF9F0A' : 'inherit'};font-weight:${
        row.pending > 0 ? '600' : '400'
      }">${row.pending}</td>
      <td>${row.claimed + row.running}</td>
      <td>${row.retryWait}</td>
      <td>${row.succeeded}</td>
      <td>${row.failed + row.deadLetter}</td>
      <td style="color:${
        row.state === 'REPRESADA' ? '#FF3B30' : 'inherit'
      };font-weight:600">${escapeHtml(oldestPendingLabel(row))}</td>
      <td style="color:${backlogColor(row.state)};font-weight:600">${escapeHtml(row.state)}</td>
    </tr>`,
    )
    .join('')

  // Fila de jobs VAZIA (nenhum job de nenhum tipo) merece frase, nao tabela em
  // branco: tabela vazia se le como "nao mediu", e a diferenca importa.
  const backlogBlock =
    report.backlog.rows.length === 0
      ? '<p class="ok">Nenhum job em <code>catalog_jobs</code>.</p>'
      : `${
          report.backlog.neverDrained
            ? `<p class="alerts"><strong>NENHUM job jamais foi processado.</strong> ${String(
                report.backlog.openTotal,
              )} aberto(s) e zero concluido(s) — a assinatura de produtor sem consumidor. ` +
              'Verifique se o servico <code>screen-catalog-worker</code> existe e esta de pe.</p>'
            : ''
        }<table><thead><tr><th>Tipo de job</th><th>Pendentes</th><th>Em execucao</th><th>Aguardando retry</th><th>Concluidos</th><th>Falhos</th><th>Pendente mais antigo</th><th>Estado</th></tr></thead><tbody>${backlogRows}</tbody></table>`

  const rows = report.rows
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.label)}<br><code>${escapeHtml(row.queue)}</code></td>
      <td>${row.intervalHours}h</td>
      <td>${escapeHtml(row.lastSuccessAt)}</td>
      <td style="color:${stateColor(row.state)};font-weight:600">${escapeHtml(row.state)}</td>
      <td>${escapeHtml(row.overdue)}</td>
      <td>${
        row.measuredBy === 'artefato'
          ? 'artefato produzido<br><small>"nunca" = artefato vazio, nao "nao tentou"</small>'
          : 'ciclo do agendador'
      }</td>
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
<h2>Fila de trabalho (<code>catalog_jobs</code>) — ${String(
    report.backlog.pendingTotal,
  )} pendente(s)</h2>
${backlogBlock}
<h2>Filas do agendador</h2>
<table><thead><tr><th>Fila</th><th>Intervalo</th><th>Ultimo sucesso</th><th>Estado</th><th>Atraso</th><th>Mede o que</th><th>Nota</th></tr></thead><tbody>${rows}</tbody></table>
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
  // A FILA DE TRABALHO VEM PRIMEIRO, e a ordem e a mensagem: e a pergunta que o
  // painel nao fazia. Deixa-la por ultimo repetiria o erro em outra forma.
  lines.push(`FILA DE TRABALHO (catalog_jobs) — ${String(report.backlog.pendingTotal)} pendente(s)`)
  if (report.backlog.rows.length === 0) {
    lines.push('  (nenhum job em catalog_jobs)')
  } else {
    if (report.backlog.neverDrained) {
      lines.push(
        `  !! NENHUM job jamais foi processado: ${String(report.backlog.openTotal)} aberto(s), ` +
          'zero concluido(s). Assinatura de produtor sem consumidor —',
      )
      lines.push('     verifique se o servico screen-catalog-worker existe e esta de pe.')
    }
    lines.push(
      `  ${'ESTADO'.padEnd(12)} ${'TIPO'.padEnd(20)} ${'PEND'.padStart(6)} ${'EXEC'.padStart(
        5,
      )} ${'RETRY'.padStart(6)} ${'OK'.padStart(7)} ${'FALHA'.padStart(6)}  MAIS ANTIGO`,
    )
    for (const row of report.backlog.rows) {
      lines.push(
        `  ${row.state.padEnd(12)} ${row.jobType.padEnd(20)} ` +
          `${String(row.pending).padStart(6)} ${String(row.claimed + row.running).padStart(5)} ` +
          `${String(row.retryWait).padStart(6)} ${String(row.succeeded).padStart(7)} ` +
          `${String(row.failed + row.deadLetter).padStart(6)}  ${oldestPendingLabel(row)}`,
      )
    }
  }
  lines.push('')
  lines.push('FILAS DO AGENDADOR')
  for (const row of report.rows) {
    lines.push(
      `  ${row.state.padEnd(12)} ${row.queue.padEnd(20)} intervalo ${String(row.intervalHours).padStart(4)}h · ` +
        `ultimo ${row.measuredBy} ${row.lastSuccessAt} · atraso ${row.overdue}` +
        `${row.measuredBy === 'artefato' ? ' · "nunca" = artefato vazio, nao "nao tentou"' : ''}` +
        `${row.note === '' ? '' : ` · ${row.note}`}`,
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
  if (report.alerts.length === 0 && report.backlog.alerts.length === 0) {
    lines.push('ALERTAS: nenhuma fila parada e nenhuma fila represada.')
  } else {
    lines.push('ALERTAS')
    for (const alert of report.alerts) lines.push(`  [${alert.kind}] ${alert.message}`)
    for (const alert of report.backlog.alerts) lines.push(`  [backlog] ${alert.message}`)
  }
  return lines.join('\n')
}
