/**
 * worker-loop-health.test.ts — O estado de saude do LOOP de projecao (PURO).
 *
 * O DEFEITO QUE ORIGINOU ESTE MODULO: em `bin/project-editorial.ts`, o `claim()`
 * ficava fora de qualquer `try`. Um 500 do CMS, um ECONNREFUSED durante o deploy
 * do CMS, um ECONNRESET ou um timeout escapavam do `while`, chegavam ao
 * `main().catch` e matavam o processo com exit 1 — crash-loop com o painel
 * verde, porque o health server subia de novo em cada encarnacao.
 *
 * A METADE PERIGOSA DA CORRECAO e a que este arquivo cobre. Fazer o loop
 * sobreviver e facil; o risco e trocar "morre e reinicia" por "vive e nao
 * trabalha, em silencio". Por isso o loop carrega saude propria, e ela distingue
 * DOIS estados que antes eram um so:
 *
 *   falhando (executa e da erro)  -> READINESS. Reiniciar nao levanta o CMS.
 *   travado  (parou de bater)     -> LIVENESS. So reinicio resolve.
 *
 * A prova de ponta a ponta (o processo REALMENTE nao morre) esta em
 * `projection-loop-resilience.test.ts`, que sobe o worker de verdade.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyCycleError,
  evaluateLoopHealth,
  initialLoopHealth,
  isLoopStalled,
  recordCycleFailure,
  recordCycleSuccess,
  recordLoopProgress,
  resolveLoopHealthThresholds,
  type LoopHealthState,
} from '../worker-loop-health.js'
import { evaluateWorkerReadiness } from '../media/worker-readiness-types.js'

const T0 = '2026-08-05T12:00:00.000Z'
const at = (secondsAfterT0: number): string =>
  new Date(Date.parse(T0) + secondsAfterT0 * 1000).toISOString()

const THRESHOLDS = { maxConsecutiveFailures: 3, stallAfterMs: 180_000 }

/* ------------------------------------------------------------------ */
/* Transicoes                                                          */
/* ------------------------------------------------------------------ */

describe('estado do loop', () => {
  it('comeca sem ciclo concluido e sem falha', () => {
    const state = initialLoopHealth(T0)
    expect(state.cyclesCompleted).toBe(0)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.lastSuccessAtIso).toBeNull()
    expect(state.lastErrorCode).toBeNull()
  })

  it('sucesso ZERA a contagem de falhas seguidas', () => {
    // Um CMS que oscila (falha, volta, falha) nao pode acumular ate bloquear:
    // "3 seguidas" precisa significar seguidas de verdade.
    let state = initialLoopHealth(T0)
    state = recordCycleFailure(state, at(1), 'outbox_http_500')
    state = recordCycleFailure(state, at(2), 'outbox_http_500')
    expect(state.consecutiveFailures).toBe(2)

    state = recordCycleSuccess(state, at(3))
    expect(state.consecutiveFailures).toBe(0)
    expect(state.lastErrorCode).toBeNull()
    expect(state.cyclesCompleted).toBe(1)
  })

  it('CICLO DE FILA VAZIA conta como sucesso', () => {
    // Isto e o coracao do diagnostico. Fila vazia NAO e falha: o CMS responde
    // 200 com `events: []`, na hora. Se contasse como falha, o `/readyz`
    // bloquearia todo worker ocioso — que e o estado normal na maior parte do
    // tempo.
    const state = recordCycleSuccess(initialLoopHealth(T0), at(15))
    expect(evaluateLoopHealth(state, at(15), THRESHOLDS).status).toBe('ok')
  })

  it('falha registra o CODIGO, nunca a excecao crua', () => {
    const state = recordCycleFailure(initialLoopHealth(T0), at(1), 'cms_timeout')
    expect(state.lastErrorCode).toBe('cms_timeout')
    expect(state.consecutiveFailures).toBe(1)
  })

  it('batida de progresso nao inventa ciclo concluido', () => {
    // `recordLoopProgress` existe para o lote longo: ela prova vida sem afirmar
    // desfecho. Confundir as duas faria um lote travado no meio parecer ciclo
    // concluido com sucesso.
    const state = recordLoopProgress(initialLoopHealth(T0), at(5))
    expect(state.cyclesCompleted).toBe(0)
    expect(state.lastSuccessAtIso).toBeNull()
    expect(state.lastProgressAtIso).toBe(at(5))
  })
})

/* ------------------------------------------------------------------ */
/* Veredito                                                            */
/* ------------------------------------------------------------------ */

describe('veredito do loop para o /readyz', () => {
  it('uma falha isolada AVISA, nao bloqueia', () => {
    // O CMS reinicia a cada deploy. Bloquear na primeira falha marcaria o
    // worker como nao-pronto em toda publicacao de CMS.
    const state = recordCycleFailure(initialLoopHealth(T0), at(1), 'cms_unreachable_econnrefused')
    const verdict = evaluateLoopHealth(state, at(1), THRESHOLDS)
    expect(verdict.status).toBe('warning')
    expect(verdict.detail).toContain('econnrefused')
  })

  it('falha PERSISTENTE bloqueia — e e assim que o painel para de mentir', () => {
    let state = initialLoopHealth(T0)
    for (let i = 1; i <= 3; i += 1) state = recordCycleFailure(state, at(i), 'outbox_http_500')

    const verdict = evaluateLoopHealth(state, at(3), THRESHOLDS)
    expect(verdict.status).toBe('blocked')
    expect(verdict.detail).toContain('outbox_http_500')
  })

  it('loop TRAVADO bloqueia mesmo sem nenhuma falha registrada', () => {
    // O caso invisivel: nenhum erro, nenhum sucesso, nenhuma batida. Antes
    // deste check o `/healthz` respondia 200 sobre um loop parado ha horas,
    // porque so olhava `shutdown.phase`.
    const state = recordCycleSuccess(initialLoopHealth(T0), at(0))
    const verdict = evaluateLoopHealth(state, at(400), THRESHOLDS)
    expect(verdict.status).toBe('blocked')
    expect(verdict.detail).toContain('travado')
  })

  it('travado tem PRECEDENCIA sobre falhando', () => {
    // Os dois pedem acoes diferentes (reiniciar vs olhar o CMS). Reportar o
    // menos grave mandaria o operador investigar a rede enquanto o processo
    // esta preso.
    let state = initialLoopHealth(T0)
    for (let i = 1; i <= 5; i += 1) state = recordCycleFailure(state, at(i), 'outbox_http_500')
    expect(evaluateLoopHealth(state, at(500), THRESHOLDS).detail).toContain('travado')
  })

  it('antes do primeiro ciclo o veredito e "subindo", nao "ok"', () => {
    const verdict = evaluateLoopHealth(initialLoopHealth(T0), at(1), THRESHOLDS)
    expect(verdict.status).toBe('warning')
    expect(verdict.status).not.toBe('ok')
  })
})

/* ------------------------------------------------------------------ */
/* Watchdog de liveness                                                */
/* ------------------------------------------------------------------ */

describe('watchdog de loop travado (liveness)', () => {
  it('um lote longo que segue batendo NAO e travado', () => {
    // O erro que este teste impede: matar um worker que esta trabalhando. Um
    // lote de 25 eventos com download de midia passa de qualquer janela curta;
    // a batida por evento e o que sustenta a liveness durante o trabalho.
    let state = initialLoopHealth(T0)
    for (let i = 1; i <= 30; i += 1) state = recordLoopProgress(state, at(i * 20))
    expect(isLoopStalled(state, at(30 * 20), 180_000)).toBe(false)
  })

  it('sem batida por mais que a janela, e travado', () => {
    const state = recordLoopProgress(initialLoopHealth(T0), at(0))
    expect(isLoopStalled(state, at(179), 180_000)).toBe(false)
    expect(isLoopStalled(state, at(181), 180_000)).toBe(true)
  })

  it('relogio ilegivel e FAIL-OPEN aqui — de proposito', () => {
    // Este predicado alimenta liveness: um `true` por engano REINICIA o
    // processo. Onde um engano causaria projecao dupla (`hasLeaseBudget`) a
    // escolha e a oposta, fail-closed. As duas assimetrias sao deliberadas.
    const state = { ...initialLoopHealth(T0), lastProgressAtIso: 'nao-e-data' }
    expect(isLoopStalled(state, T0, 180_000)).toBe(false)
  })

  it('a janela derivada e generosa o bastante para nao matar worker lento', () => {
    const thresholds = resolveLoopHealthThresholds({
      pollIntervalMs: 15_000,
      requestTimeoutMs: 20_000,
      leaseMs: 60_000,
    })
    // Precisa superar com folga o pior intervalo LEGITIMO entre duas batidas:
    // uma espera de fila vazia somada a uma chamada que vai ate o timeout.
    expect(thresholds.stallAfterMs).toBeGreaterThan(15_000 + 20_000)
    expect(thresholds.stallAfterMs).toBeGreaterThanOrEqual(120_000)
  })
})

/* ------------------------------------------------------------------ */
/* Classificacao de erro                                               */
/* ------------------------------------------------------------------ */

describe('classificacao de erro de ciclo', () => {
  it('TimeoutError e CMS LENTO, nao fila vazia', () => {
    // A hipotese que este teste fecha: "o TimeoutError e o caminho de fila
    // vazia". Nao e. Fila vazia e um 200 com `events: []`, imediato — o
    // endpoint `claim` do CMS nao faz long-poll. Timeout significa que o CMS
    // nao respondeu dentro de PROJECTION_REQUEST_TIMEOUT_MS.
    const classified = classifyCycleError(new DOMException('timed out', 'TimeoutError'))
    expect(classified.code).toBe('cms_timeout')
    expect(classified.retryable).toBe(true)
  })

  it('separa ECONNREFUSED de ECONNRESET de DNS — todos eram "TypeError"', () => {
    // O log antigo imprimia `error.name`. Para as tres causas abaixo o `fetch`
    // do Node rejeita com `TypeError: fetch failed`, entao as tres apareciam no
    // journal como a mesma palavra: `[projecao] erro fatal: TypeError`.
    const cases = [
      ['ECONNREFUSED', 'cms_unreachable_econnrefused'],
      ['ECONNRESET', 'cms_unreachable_econnreset'],
      ['ENOTFOUND', 'cms_unreachable_enotfound'],
      ['UND_ERR_SOCKET', 'cms_unreachable_und_err_socket'],
    ] as const

    for (const [errno, expected] of cases) {
      const cause = Object.assign(new Error('connect falhou'), { code: errno })
      const error = Object.assign(new TypeError('fetch failed'), { cause })
      expect(classifyCycleError(error).code, `errno ${errno}`).toBe(expected)
    }
  })

  it('erro ja classificado na origem passa com o proprio codigo', () => {
    const safe = Object.assign(new Error('outbox respondeu 500 em /claim'), {
      code: 'outbox_http_500',
      retryable: true,
    })
    const classified = classifyCycleError(safe)
    expect(classified.code).toBe('outbox_http_500')
    expect(classified.message).toContain('500')
  })

  it('erro NAO classificado nunca vaza a mensagem crua', () => {
    // A regra que ja existia no arquivo e que precisa sobreviver a mudanca: um
    // erro de banco carrega a connection string e um de HTTP carrega o header
    // de autorizacao. O `/readyz` e o journal sao lidos por humanos.
    const leaky = new Error(
      'connect ECONNREFUSED postgresql://app:senha-secreta@db:5432/rss_prime_screen-db',
    )
    leaky.name = 'PrismaClientInitializationError'
    const classified = classifyCycleError(leaky)

    expect(classified.message).not.toContain('senha-secreta')
    expect(classified.message).not.toContain('postgresql://')
    expect(classified.code).toBe('cycle_unclassified')
    // Controle positivo: continua util — o NOME do erro sobrevive.
    expect(classified.message).toContain('PrismaClientInitializationError')
  })
})

/* ------------------------------------------------------------------ */
/* Integracao com o relatorio de readiness                             */
/* ------------------------------------------------------------------ */

describe('o loop entra no relatorio do /readyz', () => {
  const healthyDeps = {
    configValid: true,
    configErrors: [],
    screenDatabaseReachable: true,
    missingSchemaObjects: [],
    payloadReachable: true,
    payloadAuthAccepted: true,
    storageReady: true,
    storageDriver: 'local',
  }

  it('dependencias saudaveis + loop bloqueado = NAO PRONTO', () => {
    // Este e literalmente o sintoma relatado: config, banco, CMS e storage
    // saudaveis, e nenhum evento sendo projetado. Antes deste check, `ready`
    // era `true`.
    const report = evaluateWorkerReadiness({
      ...healthyDeps,
      loop: { status: 'blocked', detail: '3 ciclos seguidos falharam (outbox_http_500)' },
    })
    expect(report.ready).toBe(false)
    const loop = report.checks.find((check) => check.name === 'projection_loop')
    expect(loop?.status).toBe('blocked')
  })

  it('sem o check de loop, o mesmo cenario respondia PRONTO', () => {
    // Controle negativo. Sem ele, o teste acima poderia ficar verde por
    // qualquer outra dependencia estar falhando.
    expect(evaluateWorkerReadiness(healthyDeps).ready).toBe(true)
  })

  it('loop apenas com AVISO nao tira o worker do ar', () => {
    const report = evaluateWorkerReadiness({
      ...healthyDeps,
      loop: { status: 'warning', detail: '1 ciclo(s) falhando (cms_timeout)' },
    })
    expect(report.ready).toBe(true)
    expect(report.checks.find((check) => check.name === 'projection_loop')?.status).toBe('warning')
  })

  it('sem loop (preflight, --once) o check nao aparece', () => {
    // Afirmar `ok` para um loop que ninguem mediu seria pior do que omitir.
    const report = evaluateWorkerReadiness(healthyDeps)
    expect(report.checks.some((check) => check.name === 'projection_loop')).toBe(false)
  })

  it('o detalhe do loop nao carrega credencial nem URL', () => {
    let state: LoopHealthState = initialLoopHealth(T0)
    state = recordCycleFailure(state, at(1), 'cms_unreachable_econnrefused')
    const verdict = evaluateLoopHealth(state, at(1), THRESHOLDS)
    const text = JSON.stringify(evaluateWorkerReadiness({ ...healthyDeps, loop: verdict }))

    for (const secret of ['postgresql://', 'API-Key', 'senha']) {
      expect(text).not.toContain(secret)
    }
  })
})
