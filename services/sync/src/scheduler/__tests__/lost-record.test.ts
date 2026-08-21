/**
 * Registro perdido != sucesso.
 *
 * A fila `discovery` reportava `success` no MESMO tick em que o INSERT de
 * `api_sync_logs` morria na FK de `api_providers`. Estes testes travam a regra:
 * execucao cujo registro nao foi gravado tem desfecho `failure`, com motivo
 * nomeado, sem mexer nas contagens.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyRun,
  describeRun,
  RUN_RECORD_LOST_CODE,
  withLostRecord,
} from '../run-outcome.js'

const t0 = new Date('2026-08-21T10:00:00.000Z')
const t1 = new Date('2026-08-21T10:00:02.000Z')

/** Um ciclo que deu certo em tudo: 5 de 5, zero falhas. */
function cicloPerfeito() {
  return classifyRun({
    queue: 'discovery',
    startedAt: t0,
    finishedAt: t1,
    planned: 5,
    processed: 5,
    failed: 0,
    skipped: 0,
    spend: [{ providerApi: 'tmdb-exports', requests: 7 }],
  })
}

describe('withLostRecord: o registro perdido vira o desfecho', () => {
  it('o ciclo de referencia e `success` ANTES da contaminacao', () => {
    // Sem esta linha o teste abaixo poderia estar medindo um desfecho que ja
    // era failure por outro motivo — e provaria nada.
    const antes = cicloPerfeito()
    expect(antes.status).toBe('success')
    expect(antes.advancesLastSuccess).toBe(true)
  })

  it('registro perdido rebaixa `success` para `failure` e nao avanca o ultimo sucesso', () => {
    const depois = withLostRecord(cicloPerfeito(), 'FK api_sync_logs_provider_api_fkey')
    expect(depois.status).toBe('failure')
    expect(depois.advancesLastSuccess).toBe(false)
  })

  it('o motivo e nomeado e carrega o detalhe do erro do banco', () => {
    const depois = withLostRecord(
      cicloPerfeito(),
      'o registro em api_sync_logs NAO foi gravado para provider_api=tmdb-exports: FK violada',
    )
    const motivo = depois.reasons.find((reason) => reason.code === RUN_RECORD_LOST_CODE)
    expect(motivo).toBeDefined()
    expect(motivo?.detail).toContain('tmdb-exports')
  })

  it('as CONTAGENS nao sao mexidas: fingir zero esconderia a cota queimada', () => {
    const depois = withLostRecord(cicloPerfeito(), 'qualquer')
    expect(depois.processed).toBe(5)
    expect(depois.planned).toBe(5)
    expect(depois.spend).toEqual([{ providerApi: 'tmdb-exports', requests: 7 }])
  })

  it('a linha do painel NAO diz "0 de 5" quando 5 foram processados', () => {
    // `describeRun` cravava o literal 0 para todo `failure`. Com o registro
    // perdido isso viraria uma segunda mentira em cima da primeira.
    const linha = describeRun(withLostRecord(cicloPerfeito(), 'FK violada'))
    expect(linha).toContain('5 de 5')
    expect(linha).not.toContain('0 de 5')
    expect(linha).toContain(RUN_RECORD_LOST_CODE)
  })

  it('falha classica (0 processados) continua descrita como 0 de N', () => {
    // Controle da mudanca em describeRun: o texto antigo tem de sobreviver no
    // caso que ele descrevia corretamente.
    const quebrou = classifyRun({
      queue: 'discovery',
      startedAt: t0,
      finishedAt: t1,
      planned: 5,
      processed: 0,
      failed: 5,
      skipped: 0,
      reasons: [{ code: 'runner_threw', detail: 'boom', count: 1 }],
    })
    expect(quebrou.status).toBe('failure')
    expect(describeRun(quebrou)).toContain('0 de 5')
  })
})
