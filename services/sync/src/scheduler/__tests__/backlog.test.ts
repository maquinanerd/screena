/**
 * backlog.test.ts — O painel tem de FICAR VERMELHO com a fila cheia.
 *
 * O caso (1) e o unico teste desta suite que reproduz o defeito medido em
 * 2026-08-21: 534 jobs `pending`, nenhum processado, painel OK. Ele existe para
 * reprovar se alguem voltar a montar o semaforo so com `alerts` de fila parada.
 *
 * CONTROLE NEGATIVO em (6) e (7): uma fila SAUDAVEL nao pode acender vermelho, e
 * uma fila VAZIA nao pode acender verde. Sem os dois, um `evaluateBacklog` que
 * devolvesse 'REPRESADA' para tudo passaria em todos os casos positivos.
 */

import { describe, expect, it } from 'vitest'

import {
  BACKLOG_ALERT_EVENT,
  BACKLOG_STALE_HOURS,
  emitBacklogAlerts,
  evaluateBacklog,
  type JobBacklogCounts,
} from '../backlog.js'
import { buildStatusReport, renderStatusHtml, renderStatusText } from '../status.js'
import { evaluateSchedule } from '../due.js'
import { detectStalledQueues } from '../stalled.js'

const AGORA = new Date('2026-08-21T18:00:00.000Z')

/** Um tipo de job zerado. Cada caso sobrescreve so o que interessa. */
function conta(over: Partial<JobBacklogCounts> & { jobType: string }): JobBacklogCounts {
  return {
    pending: 0,
    claimed: 0,
    running: 0,
    retryWait: 0,
    succeeded: 0,
    failed: 0,
    deadLetter: 0,
    cancelled: 0,
    oldestPendingAt: null,
    ...over,
  }
}

function horasAtras(horas: number): Date {
  return new Date(AGORA.getTime() - horas * 60 * 60 * 1000)
}

/**
 * A fila REAL de 2026-08-21, com os seis tipos e as contagens medidas.
 * Total: 331 + 113 + 82 + 4 + 3 + 1 = 534.
 */
const FILA_DE_21_DE_AGOSTO: readonly JobBacklogCounts[] = [
  conta({ jobType: 'sync_details', pending: 331, oldestPendingAt: horasAtras(30) }),
  conta({ jobType: 'sync_media', pending: 113, oldestPendingAt: horasAtras(30) }),
  conta({ jobType: 'sync_seasons', pending: 82, oldestPendingAt: horasAtras(30) }),
  conta({ jobType: 'sync_lists', pending: 4, oldestPendingAt: horasAtras(30) }),
  conta({ jobType: 'discover_ids', pending: 3, oldestPendingAt: horasAtras(30) }),
  conta({ jobType: 'sync_changes', pending: 1, oldestPendingAt: horasAtras(30) }),
]

describe('backlog de catalog_jobs', () => {
  it('(1) 534 pendentes e zero processados => REPRESADA, e o semaforo do painel vira degraded', () => {
    const backlog = evaluateBacklog(FILA_DE_21_DE_AGOSTO, AGORA)

    expect(backlog.pendingTotal).toBe(534)
    expect(backlog.openTotal).toBe(534)
    expect(backlog.neverDrained).toBe(true)
    expect(backlog.alerts).toHaveLength(6)
    expect(backlog.rows.every((row) => row.state === 'REPRESADA')).toBe(true)

    // A prova que importa: SEM alerta de fila parada, o painel ainda tem de
    // ficar degradado. Era exatamente esta combinacao que dava "OK".
    const relatorio = buildStatusReport({
      now: AGORA,
      startedAt: AGORA,
      schedules: [],
      alerts: [],
      quotas: [],
      backlog,
      workerId: 'teste',
    })
    expect(relatorio.overall).toBe('degraded')
  })

  it('(2) a idade do pendente mais antigo aparece na tela, em numero', () => {
    const backlog = evaluateBacklog(
      [conta({ jobType: 'sync_details', pending: 331, oldestPendingAt: horasAtras(30) })],
      AGORA,
    )
    const relatorio = buildStatusReport({
      now: AGORA,
      startedAt: AGORA,
      schedules: [],
      alerts: [],
      quotas: [],
      backlog,
      workerId: 'teste',
    })

    const texto = renderStatusText(relatorio)
    // Nao basta a palavra "REPRESADA": o requisito e "o numero na cara".
    expect(texto).toContain('30.0h')
    expect(texto).toContain('331')

    const html = renderStatusHtml(relatorio)
    expect(html).toContain('30.0h')
    // Vermelho de acao, o mesmo do alerta de fila parada.
    expect(html).toContain('#FF3B30')
  })

  it('(3) o limiar e 24h: 23,9h ainda e "em dia" e 24,0h ja e REPRESADA', () => {
    const quase = evaluateBacklog(
      [conta({ jobType: 'sync_details', pending: 1, oldestPendingAt: horasAtras(23.9) })],
      AGORA,
    )
    expect(quase.rows[0]?.state).toBe('em dia')
    expect(quase.alerts).toHaveLength(0)

    const noPonto = evaluateBacklog(
      [conta({ jobType: 'sync_details', pending: 1, oldestPendingAt: horasAtras(BACKLOG_STALE_HOURS) })],
      AGORA,
    )
    expect(noPonto.rows[0]?.state).toBe('REPRESADA')
    expect(noPonto.alerts).toHaveLength(1)
  })

  it('(4) fila com consumidor lento e REPRESADA, mas NAO e neverDrained', () => {
    // Ha trabalho concluido: existe consumidor, ele so nao da conta. O conserto
    // e de capacidade (concorrencia, cota), nao de deploy — e o painel tem de
    // separar os dois, senao manda o dono criar um servico que ja existe.
    const backlog = evaluateBacklog(
      [
        conta({
          jobType: 'sync_details',
          pending: 200,
          succeeded: 4000,
          oldestPendingAt: horasAtras(48),
        }),
      ],
      AGORA,
    )
    expect(backlog.rows[0]?.state).toBe('REPRESADA')
    expect(backlog.neverDrained).toBe(false)
  })

  it('(5) o alerta nomeia QUEM drena — um alerta sem acao e so um susto', () => {
    const backlog = evaluateBacklog(FILA_DE_21_DE_AGOSTO, AGORA)
    const linhas: Array<{ event: string; fields: Record<string, unknown> }> = []
    const emitidos = emitBacklogAlerts(backlog, {
      log(_level, event, fields) {
        linhas.push({ event, fields })
      },
    })

    expect(emitidos).toBe(6)
    expect(linhas).toHaveLength(6)
    expect(linhas.every((linha) => linha.event === BACKLOG_ALERT_EVENT)).toBe(true)
    // O nome do servico que falta, e o comando que o sobe.
    expect(String(linhas[0]?.fields.message)).toContain('screen-catalog-worker')
    expect(String(linhas[0]?.fields.message)).toContain('catalog-worker:start')
  })

  // ---- CONTROLES NEGATIVOS -------------------------------------------------

  it('(6) CONTROLE NEGATIVO: fila drenada fica VERDE e nao emite alerta nenhum', () => {
    const backlog = evaluateBacklog(
      [
        conta({ jobType: 'sync_details', succeeded: 331 }),
        conta({ jobType: 'sync_media', succeeded: 112, failed: 1 }),
      ],
      AGORA,
    )

    expect(backlog.pendingTotal).toBe(0)
    expect(backlog.openTotal).toBe(0)
    expect(backlog.neverDrained).toBe(false)
    expect(backlog.alerts).toHaveLength(0)
    expect(backlog.rows.map((row) => row.state)).toEqual(['drenada', 'drenada'])

    const relatorio = buildStatusReport({
      now: AGORA,
      startedAt: AGORA,
      schedules: [],
      alerts: [],
      quotas: [],
      backlog,
      workerId: 'teste',
    })
    // Se isto virasse `degraded`, o painel gritaria sempre — e alerta que grita
    // sempre e alerta que ninguem le.
    expect(relatorio.overall).toBe('ok')
  })

  it('(7) CONTROLE NEGATIVO: tipo sem job nenhum e "vazia", NUNCA "drenada"', () => {
    // "Nao ha o que fazer" e "fiz tudo" sao afirmacoes diferentes. Colapsa-las
    // pintaria de verde um tipo que nunca foi exercitado.
    const backlog = evaluateBacklog([conta({ jobType: 'sync_episodes' })], AGORA)
    expect(backlog.rows[0]?.state).toBe('vazia')
    expect(backlog.neverDrained).toBe(false)
    expect(backlog.alerts).toHaveLength(0)
    expect(renderStatusHtml(
      buildStatusReport({
        now: AGORA,
        startedAt: AGORA,
        schedules: [],
        alerts: [],
        quotas: [],
        backlog,
        workerId: 'teste',
      }),
    )).toContain('#999999')
  })

  it('(8) CONTROLE NEGATIVO: nove filas do agendador VERDES nao salvam o painel', () => {
    // Reproduz o estado exato de 2026-08-21 dos DOIS lados: agendador em dia
    // (ultimo sucesso ha 5 minutos em toda fila) e `catalog_jobs` intacta.
    const cincoMinutosAtras = new Date(AGORA.getTime() - 5 * 60 * 1000)
    const schedules = evaluateSchedule({
      now: AGORA,
      lastRuns: [],
    }).map((entry) => ({ ...entry, lastSuccessAt: cincoMinutosAtras, due: false, overdueRatio: 0 }))
    const alerts = detectStalledQueues(schedules, { now: AGORA, startedAt: AGORA })

    // Pre-condicao do controle: o lado do agendador esta MESMO limpo.
    expect(alerts).toHaveLength(0)

    const relatorio = buildStatusReport({
      now: AGORA,
      startedAt: AGORA,
      schedules,
      alerts,
      quotas: [],
      backlog: evaluateBacklog(FILA_DE_21_DE_AGOSTO, AGORA),
      workerId: 'teste',
    })

    expect(relatorio.overall).toBe('degraded')
    expect(renderStatusText(relatorio)).toContain('NENHUM job jamais foi processado')
  })
})
