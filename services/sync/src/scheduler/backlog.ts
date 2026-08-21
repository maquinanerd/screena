/**
 * backlog.ts — O QUE O PAINEL NAO OLHAVA: a fila de trabalho de verdade.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE MODULO EXISTE PARA FECHAR
 * ============================================================================
 * O painel tinha uma linha por FILA DO AGENDADOR e media cada uma por
 * `api_sync_logs`. Nenhuma das duas coisas fala de `catalog_jobs`.
 *
 * A consequencia foi medida: 534 jobs `pending`, nenhum jamais processado, e o
 * painel dizendo OK com nove filas verdes. E coerente — cada fila REALMENTE
 * tiquetaqueou e REALMENTE enfileirou. O que ninguem perguntou foi se alguem do
 * outro lado tirou o job de `pending`.
 *
 *   verde ANTES  = "o agendador rodou"          (`api_sync_logs`)
 *   verde AGORA  = "o agendador rodou" E        (`api_sync_logs`)
 *                  "o trabalho saiu da fila"    (`catalog_jobs`)
 *
 * Um painel que fica verde com a fila cheia compra confianca sem entregar nada;
 * e pior que nao ter painel, porque um painel ausente manda o dono ir olhar.
 *
 * ============================================================================
 * POR QUE 24h, E POR QUE E ABSOLUTO
 * ============================================================================
 * O alerta de fila parada (`stalled.ts`) e RELATIVO ao intervalo de cada fila,
 * e isso esta certo la: uma fila mensal atrasada um dia nao e defeito.
 *
 * Aqui e o contrario. Um job `pending` nao tem intervalo — ele tem um
 * consumidor, ou nao tem. Vinte e quatro horas e o prazo em que QUALQUER job
 * deste sistema deveria ter sido drenado, porque a fila mais lenta que enfileira
 * (descoberta) e diaria: se o job de ontem ainda esta la quando o de hoje chega,
 * o consumidor nao esta consumindo. Nao ha janela em que isso seja normal.
 *
 * ============================================================================
 * O QUE ESTE MODULO NAO FAZ
 * ============================================================================
 * Nao le banco (o adapter esta em `runtime/facts.ts`), nao tem relogio proprio
 * (`now` entra) e nao escreve. Recebe contagens e devolve julgamento — para que
 * o julgamento tenha teste sem PostgreSQL.
 */

/**
 * Horas de `pending` a partir das quais um tipo de job esta REPRESADO.
 *
 * Absoluto de proposito: ver o cabecalho. Nao confundir com
 * `STALL_THRESHOLD_RATIO`, que e relativo ao intervalo da fila.
 */
export const BACKLOG_STALE_HOURS = 24

const HOUR_MS = 60 * 60 * 1000

/**
 * Contagem crua de um tipo de job, como o adapter a leu de `catalog_jobs`.
 *
 * Os nomes espelham `CatalogJobStatus` do Prisma um a um. Colapsar dois estados
 * aqui esconderia a diferenca entre "esta sendo trabalhado" e "morreu": e
 * exatamente a diferenca que o dono precisa ver as 3 da manha.
 */
export interface JobBacklogCounts {
  readonly jobType: string
  readonly pending: number
  readonly claimed: number
  readonly running: number
  readonly retryWait: number
  readonly succeeded: number
  readonly failed: number
  readonly deadLetter: number
  readonly cancelled: number
  /** Criacao do job `pending` mais ANTIGO deste tipo. `null` = nao ha pendente. */
  readonly oldestPendingAt: Date | null
}

/** Estado de um tipo de job, ja julgado contra o relogio. */
export type BacklogState =
  /** Nenhum job deste tipo, em nenhum estado. Nao e defeito: e ausencia. */
  | 'vazia'
  /** Ha pendentes, e o mais velho esta dentro do prazo. */
  | 'em dia'
  /** Nada pendente e ha trabalho concluido. O desfecho saudavel. */
  | 'drenada'
  /** Job pendente ha mais de {@link BACKLOG_STALE_HOURS}. Vermelho. */
  | 'REPRESADA'

/** Uma linha do painel de fila, pronta para virar HTML, texto ou JSON. */
export interface BacklogRow extends JobBacklogCounts {
  /** Idade do pendente mais antigo, em horas. `null` = nao ha pendente. */
  readonly oldestPendingHours: number | null
  readonly state: BacklogState
  /** `pending + claimed + running + retry_wait` — o que ainda deve trabalho. */
  readonly openTotal: number
}

/** Um tipo de job represado. Vira alerta no painel e linha de log. */
export interface BacklogAlert {
  readonly jobType: string
  readonly pending: number
  readonly oldestPendingHours: number
  /** Uma linha pronta para a tela. Nunca vazia. */
  readonly message: string
}

/** O painel de fila inteiro. */
export interface BacklogReport {
  readonly rows: readonly BacklogRow[]
  /** Soma de `openTotal` de todos os tipos. E o numero que o dono le primeiro. */
  readonly openTotal: number
  /** Soma de `pending` de todos os tipos. */
  readonly pendingTotal: number
  /** Tipos represados. Vazio = nenhum. */
  readonly alerts: readonly BacklogAlert[]
  /**
   * `true` quando ha QUALQUER job aberto e NENHUM concluido, em nenhum tipo.
   *
   * E a assinatura exata do defeito de 2026-08-21: produtor sem consumidor. Ela
   * merece nome proprio porque o desfecho e diferente de "represada" — nao ha um
   * consumidor lento, nao ha consumidor nenhum, e o conserto e de DEPLOY.
   */
  readonly neverDrained: boolean
}

function ageHours(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / HOUR_MS)
}

function stateOf(counts: JobBacklogCounts, oldestPendingHours: number | null): BacklogState {
  const open = counts.pending + counts.claimed + counts.running + counts.retryWait
  const closed = counts.succeeded + counts.failed + counts.deadLetter + counts.cancelled
  if (open === 0 && closed === 0) return 'vazia'
  if (open === 0) return 'drenada'
  if (oldestPendingHours !== null && oldestPendingHours >= BACKLOG_STALE_HOURS) return 'REPRESADA'
  return 'em dia'
}

/**
 * Julga o backlog. Determinista: mesma entrada, mesmo relatorio.
 *
 * Nunca lanca. Um painel que morre porque a fila esta feia e um painel que some
 * exatamente quando serve para alguma coisa.
 */
export function evaluateBacklog(
  counts: readonly JobBacklogCounts[],
  now: Date,
): BacklogReport {
  const rows: BacklogRow[] = counts.map((entry) => {
    const oldestPendingHours =
      entry.oldestPendingAt === null ? null : ageHours(entry.oldestPendingAt, now)
    return {
      ...entry,
      oldestPendingHours,
      state: stateOf(entry, oldestPendingHours),
      openTotal: entry.pending + entry.claimed + entry.running + entry.retryWait,
    }
  })

  const alerts: BacklogAlert[] = []
  for (const row of rows) {
    if (row.state !== 'REPRESADA') continue
    // `oldestPendingHours` nunca e null quando o estado e REPRESADA (ver
    // `stateOf`), mas o tipo nao sabe disso e um `!` aqui seria uma afirmacao
    // sem prova. O `?? 0` e inalcancavel e barato.
    const hours = row.oldestPendingHours ?? 0
    alerts.push({
      jobType: row.jobType,
      pending: row.pending,
      oldestPendingHours: hours,
      message:
        `fila "${row.jobType}" REPRESADA: ${String(row.pending)} job(s) pendentes, o mais ` +
        `antigo ha ${hours.toFixed(1)}h (limiar ${String(BACKLOG_STALE_HOURS)}h). ` +
        `Quem drena e o servico screen-catalog-worker ` +
        `(pnpm --filter @screena/ingestion catalog-worker:start).`,
    })
  }

  const openTotal = rows.reduce((sum, row) => sum + row.openTotal, 0)
  const pendingTotal = rows.reduce((sum, row) => sum + row.pending, 0)
  const closedTotal = rows.reduce(
    (sum, row) => sum + row.succeeded + row.failed + row.deadLetter + row.cancelled,
    0,
  )

  return {
    rows,
    openTotal,
    pendingTotal,
    alerts,
    neverDrained: openTotal > 0 && closedTotal === 0,
  }
}

/** O nome do evento de log. Fixo: e por ele que se filtra e se monta o aviso. */
export const BACKLOG_ALERT_EVENT = 'catalog_backlog_stalled'

/** O destino de um alerta de backlog. O servico passa o proprio logger. */
export interface BacklogAlertSink {
  log(level: 'error', event: string, fields: Record<string, unknown>): void
}

/**
 * EMITE os alertas de backlog. Uma linha `error` por tipo represado.
 *
 * Existe como funcao pelo mesmo motivo de `emitStallAlerts`: para ter teste. Um
 * alerta que so existe dentro do `while (true)` de um bin nao tem como reprovar
 * nada. Devolve quantos sairam.
 */
export function emitBacklogAlerts(
  report: BacklogReport,
  sink: BacklogAlertSink,
): number {
  for (const alert of report.alerts) {
    sink.log('error', BACKLOG_ALERT_EVENT, {
      jobType: alert.jobType,
      pending: alert.pending,
      oldestPendingHours: alert.oldestPendingHours,
      neverDrained: report.neverDrained,
      message: alert.message,
    })
  }
  return report.alerts.length
}
