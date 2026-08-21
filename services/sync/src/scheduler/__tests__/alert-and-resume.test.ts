/**
 * alert-and-resume.test.ts — O ALERTA SAI, e o LOTE RETOMA sem duplicar.
 *
 * Os dois requisitos do dono que nao cabem em `detectStalledQueues` sozinho:
 *
 *  - "Uma fila parada dispara o alerta — teste que REPROVA se o alerta nao
 *     sair." Detectar nao e emitir. Este arquivo mede a EMISSAO.
 *  - "Container derrubado no meio do lote retoma sem duplicar e sem perder."
 *     A parte que se prova sem banco: o ESCOPO. A parte que precisa de processo
 *     de verdade esta em `scripts/prove-scheduler-lock.ts` (SIGKILL solta a
 *     trava); a parte que precisa de fila esta na propria `catalog_jobs`
 *     (`reclaimOrphans`, ja provada em `prove-catalog-worker-service.ts`).
 */

import { describe, expect, it } from 'vitest'

import { evaluateSchedule } from '../due.js'
import type { Rhythm } from '../rhythms.js'
import { dailyScope, hourlySlot } from '../scope.js'
import { detectStalledQueues, emitStallAlerts, STALL_ALERT_EVENT } from '../stalled.js'

const H = 60 * 60 * 1000
const BASE = new Date('2026-05-10T12:00:00.000Z')

const DIARIA: Rhythm = {
  queue: 'watch_offers',
  cadence: 'fixed',
  intervalHours: 24,
  seasonalIntervalHours: null,
  providerApi: 'tmdb',
  label: 'diaria',
  rationale: 'x',
}

interface Linha {
  level: string
  event: string
  fields: Record<string, unknown>
}

function sink(): { readonly linhas: Linha[]; log(level: 'error', event: string, fields: Record<string, unknown>): void } {
  const linhas: Linha[] = []
  return {
    linhas,
    log(level, event, fields) {
      linhas.push({ level, event, fields })
    },
  }
}

function alertasDe(lastSuccessAt: Date | null, uptimeHours = 48) {
  const schedules = evaluateSchedule({
    now: BASE,
    lastRuns: [{ queue: 'watch_offers', lastSuccessAt, lastAttemptAt: lastSuccessAt }],
    rhythms: [DIARIA],
  })
  return detectStalledQueues(schedules, {
    now: BASE,
    startedAt: new Date(BASE.getTime() - uptimeHours * H),
  })
}

describe('o alerta SAI', () => {
  it('uma fila parada produz UMA linha de log, no nivel error', () => {
    const destino = sink()
    const emitidos = emitStallAlerts(alertasDe(new Date(BASE.getTime() - 72 * H)), destino)

    expect(emitidos).toBe(1)
    expect(destino.linhas).toHaveLength(1)
    expect(destino.linhas[0]!.level).toBe('error')
    expect(destino.linhas[0]!.event).toBe(STALL_ALERT_EVENT)
    expect(destino.linhas[0]!.fields.queue).toBe('watch_offers')
    expect(destino.linhas[0]!.fields.kind).toBe('stalled')
  })

  it('a linha carrega o FATO, nao so o rotulo', () => {
    const destino = sink()
    const ultimo = new Date(BASE.getTime() - 72 * H)
    emitStallAlerts(alertasDe(ultimo), destino)
    const campos = destino.linhas[0]!.fields
    expect(campos.lastSuccessAt).toBe(ultimo.toISOString())
    expect(campos.intervalHours).toBe(24)
    expect(String(campos.message)).toContain(ultimo.toISOString())
  })

  it('`Infinity` vira `null` EXPLICITO — nunca um campo que some no JSON', () => {
    const destino = sink()
    emitStallAlerts(alertasDe(null, 48), destino)
    const campos = destino.linhas[0]!.fields
    expect(campos.kind).toBe('never_ran')
    expect(campos.overdueRatio).toBeNull()
    // E a linha sobrevive a serializacao sem perder o campo.
    expect(JSON.parse(JSON.stringify(campos))).toHaveProperty('overdueRatio', null)
  })

  it('fila EM DIA nao emite nada — o alerta nao pode virar ruido constante', () => {
    const destino = sink()
    expect(emitStallAlerts(alertasDe(BASE), destino)).toBe(0)
    expect(destino.linhas).toEqual([])
  })

  it('CONTROLE NEGATIVO: com a lista vazia, um emissor que sempre logasse seria pego aqui', () => {
    const destino = sink()
    expect(emitStallAlerts([], destino)).toBe(0)
    expect(destino.linhas).toEqual([])
  })
})

describe('retomar sem duplicar e sem perder', () => {
  it('duas execucoes no MESMO dia produzem o MESMO escopo — nao duplica', () => {
    const manha = new Date('2026-05-10T06:00:00.000Z')
    const noite = new Date('2026-05-10T23:59:59.000Z')
    expect(dailyScope('watch_offers', manha)).toBe(dailyScope('watch_offers', noite))
  })

  it('o dia SEGUINTE e trabalho novo — nao perde', () => {
    const hoje = new Date('2026-05-10T23:59:59.000Z')
    const amanha = new Date('2026-05-11T00:00:01.000Z')
    expect(dailyScope('watch_offers', hoje)).not.toBe(dailyScope('watch_offers', amanha))
  })

  it('filas diferentes no mesmo dia nao colidem entre si', () => {
    expect(dailyScope('watch_offers', BASE)).not.toBe(dailyScope('title_detail_ended', BASE))
  })

  it('o dia e UTC — duas replicas em fusos diferentes veem o MESMO escopo', () => {
    // Mesmo instante, dois `Date` construidos de formas diferentes.
    const a = new Date('2026-05-10T23:30:00.000Z')
    const b = new Date(Date.UTC(2026, 4, 10, 23, 30, 0))
    expect(dailyScope('people', a)).toBe(dailyScope('people', b))
    expect(dailyScope('people', a)).toContain('2026-05-10')
  })

  it('o `/changes` usa a HORA: dois ciclos no mesmo dia sao trabalhos diferentes', () => {
    const h14 = new Date('2026-05-10T14:10:00.000Z')
    const h20 = new Date('2026-05-10T20:10:00.000Z')
    expect(hourlySlot(h14)).not.toBe(hourlySlot(h20))
    // E dentro da MESMA hora, o mesmo trabalho.
    expect(hourlySlot(h14)).toBe(hourlySlot(new Date('2026-05-10T14:59:59.000Z')))
  })

  it('CONTROLE NEGATIVO: um escopo sem a janela colapsaria TODOS os ciclos num so', () => {
    // Se o escopo fosse so o nome da fila, a fila congelaria no primeiro lote —
    // em silencio, para sempre. O assert mede a diferenca que a janela cria.
    const semJanela = (queue: string): string => queue
    expect(semJanela('watch_offers')).toBe(semJanela('watch_offers'))
    expect(dailyScope('watch_offers', new Date('2026-05-10T00:00:00Z'))).not.toBe(
      dailyScope('watch_offers', new Date('2026-05-11T00:00:00Z')),
    )
  })
})
