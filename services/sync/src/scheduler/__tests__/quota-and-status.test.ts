/**
 * quota-and-status.test.ts — O teto da fila de fundo, a conta da volta completa,
 * e o painel que o dono le.
 */

import { describe, expect, it } from 'vitest'

import {
  OMDB_DAILY_LIMIT,
  ON_DEMAND_RESERVE,
  planRotationLap,
  resolveProviderQuota,
  PROVIDER_QUOTAS,
} from '@screena/config'

import { evaluateSchedule } from '../due.js'
import { backgroundOmdbSlots } from '../quota.js'
import type { Rhythm } from '../rhythms.js'
import { detectStalledQueues } from '../stalled.js'
import { evaluateBacklog } from '../backlog.js'
import { buildStatusReport, renderStatusHtml, renderStatusText } from '../status.js'

describe('o teto da fila de fundo', () => {
  it('NUNCA alcanca 100% do teto: a reserva do leitor sai sempre', () => {
    const semGasto = backgroundOmdbSlots(0, 100_000)
    expect(semGasto).toBe(OMDB_DAILY_LIMIT - ON_DEMAND_RESERVE)
    expect(semGasto).toBeLessThan(OMDB_DAILY_LIMIT)
  })

  it('respeita o teto do lote quando ele e menor que a cota', () => {
    expect(backgroundOmdbSlots(0, 50)).toBe(50)
  })

  it('devolve 0 quando o saldo ja entrou na reserva do leitor', () => {
    const gasto = OMDB_DAILY_LIMIT - Math.floor(ON_DEMAND_RESERVE / 2)
    expect(backgroundOmdbSlots(gasto, 200)).toBe(0)
  })

  it('devolve 0 com a cota esgotada, e nunca um numero negativo', () => {
    expect(backgroundOmdbSlots(OMDB_DAILY_LIMIT, 200)).toBe(0)
    expect(backgroundOmdbSlots(OMDB_DAILY_LIMIT + 500, 200)).toBe(0)
  })

  it('um plano pago injetado muda o teto sem tocar no codigo', () => {
    expect(backgroundOmdbSlots(0, 100_000, { dailyLimit: 100_000, reserve: 1_000 })).toBe(99_000)
  })

  it('CONTROLE NEGATIVO: sem descontar a reserva, a fila de fundo alcancaria o teto inteiro', () => {
    const semReserva = backgroundOmdbSlots(0, 100_000, { reserve: 0 })
    expect(semReserva).toBe(OMDB_DAILY_LIMIT)
    // E e exatamente por isso que o default NAO e esse.
    expect(backgroundOmdbSlots(0, 100_000)).toBeLessThan(semReserva)
  })
})

describe('a conta da volta completa', () => {
  const porDia = OMDB_DAILY_LIMIT - ON_DEMAND_RESERVE

  it('239 titulos fecham a volta em menos de um dia', () => {
    expect(planRotationLap({ items: 239, requestsPerItem: 1, requestsPerDay: porDia }).days).toBe(1)
  })

  it('10 mil titulos levam 12 dias — acima da janela de frescor de 7', () => {
    expect(planRotationLap({ items: 10_000, requestsPerItem: 1, requestsPerDay: porDia }).days).toBe(12)
  })

  it('arredonda para CIMA: meia volta nao existe', () => {
    expect(planRotationLap({ items: 10, requestsPerItem: 1, requestsPerDay: 9 }).days).toBe(2)
  })

  it('sem cota nenhuma, a volta NUNCA fecha — `null`, nao Infinity disfarcado', () => {
    const lap = planRotationLap({ items: 100, requestsPerItem: 1, requestsPerDay: 0 })
    expect(lap.days).toBeNull()
  })
})

describe('os tetos declarados', () => {
  it('cada teto carrega a BASE do numero — publicado, medido, ou piso assumido', () => {
    for (const quota of Object.values(PROVIDER_QUOTAS)) {
      expect(['published', 'measured', 'assumed_floor'], quota.providerApi).toContain(quota.basis)
      expect(quota.source.length, quota.providerApi).toBeGreaterThan(40)
    }
  })

  it('o TMDB declara AUSENCIA de teto diario — nao uma lacuna', () => {
    const tmdb = resolveProviderQuota('tmdb')!
    expect(tmdb.perDay).toBeNull()
    expect(tmdb.perSecond).not.toBeNull()
  })

  it('fornecedor desconhecido devolve null — o chamador decide, nao herda "sem limite"', () => {
    expect(resolveProviderQuota('fornecedor_que_nao_existe')).toBeNull()
  })
})

describe('o painel', () => {
  const BASE = new Date('2026-05-10T12:00:00.000Z')
  const H = 60 * 60 * 1000
  const DIARIA: Rhythm = {
    queue: 'watch_offers',
    cadence: 'fixed',
    intervalHours: 24,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Ofertas de streaming',
    rationale: 'x',
  }

  function painel(lastSuccessAt: Date | null) {
    const schedules = evaluateSchedule({
      now: BASE,
      lastRuns: [{ queue: 'watch_offers', lastSuccessAt, lastAttemptAt: lastSuccessAt }],
      rhythms: [DIARIA],
    })
    const alerts = detectStalledQueues(schedules, {
      now: BASE,
      startedAt: new Date(BASE.getTime() - 48 * H),
    })
    return buildStatusReport({
      now: BASE,
      startedAt: new Date(BASE.getTime() - 48 * H),
      schedules,
      alerts,
      quotas: [
        {
          providerApi: 'omdb',
          dailyLimit: OMDB_DAILY_LIMIT,
          spentToday: 200,
          reservedForReader: ON_DEMAND_RESERVE,
          basis: 'published',
        },
        {
          providerApi: 'tmdb',
          dailyLimit: null,
          spentToday: 4_000,
          reservedForReader: 0,
          basis: 'assumed_floor',
        },
      ],
      // Fila de trabalho VAZIA de proposito: esta suite mede o painel de COTA e
      // de fila do agendador. Passar uma fila represada aqui deixaria o semaforo
      // degradado por outro motivo e os casos "tudo em dia" mediriam a si
      // mesmos. A fila represada tem suite propria (`backlog.test.ts`).
      backlog: evaluateBacklog([], BASE),
      workerId: 'teste',
    })
  }

  it('responde as tres perguntas: quando rodou, o que atrasou, quanto de cota sobrou', () => {
    const report = painel(new Date(BASE.getTime() - 72 * H))
    expect(report.overall).toBe('degraded')
    expect(report.rows[0]!.state).toBe('PARADA')
    expect(report.rows[0]!.lastSuccessAt).toBe(new Date(BASE.getTime() - 72 * H).toISOString())
    expect(report.alerts).toHaveLength(1)

    const omdb = report.quotas.find((q) => q.providerApi === 'omdb')!
    expect(omdb.remaining).toBe(OMDB_DAILY_LIMIT - 200)
    // O saldo da FILA DE FUNDO e menor que o total: a reserva do leitor sai.
    expect(omdb.remainingForBackground).toBe(OMDB_DAILY_LIMIT - 200 - ON_DEMAND_RESERVE)
    expect(omdb.remainingForBackground!).toBeLessThan(omdb.remaining!)
  })

  it('fornecedor sem teto diario mostra `null`, nao zero', () => {
    const tmdb = painel(BASE).quotas.find((q) => q.providerApi === 'tmdb')!
    expect(tmdb.remaining).toBeNull()
    expect(tmdb.remainingForBackground).toBeNull()
  })

  it('tudo em dia => semaforo OK e nenhum alerta', () => {
    const report = painel(BASE)
    expect(report.overall).toBe('ok')
    expect(report.alerts).toEqual([])
    expect(report.rows[0]!.state).toBe('em dia')
  })

  it('o HTML e AUTOCONTIDO: sem script, sem fonte remota, sem requisicao externa', () => {
    const html = renderStatusHtml(painel(BASE))
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).toMatch(/^<!doctype html>/i)
    // E nao e indexavel: um painel operacional no indice do Google seria vazamento.
    expect(html).toContain('name="robots" content="noindex,nofollow"')
  })

  it('o HTML escapa o que vem do dado — nada vai cru para a pagina', () => {
    const report = painel(BASE)
    const comInjecao = {
      ...report,
      rows: [{ ...report.rows[0]!, label: '<img src=x onerror=alert(1)>' }],
    }
    const html = renderStatusHtml(comInjecao)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('o texto da CLI diz o mesmo que o HTML, sem markup', () => {
    const texto = renderStatusText(painel(new Date(BASE.getTime() - 72 * H)))
    expect(texto).toContain('PARADA')
    expect(texto).toContain('watch_offers')
    expect(texto).not.toContain('<')
  })
})
