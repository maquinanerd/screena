/**
 * trending-priority.test.ts — O TRENDING NÃO PODE NASCER NO FIM DA FILA.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUÇÃO EM 26/08/2026
 * ============================================================================
 * `discovery_snapshots` estava em ZERO. Não por falta de código, nem por falta
 * de execução: `api_sync_logs` registrava `scheduler/trending` com status
 * `success` VINTE E CINCO vezes, a última 4 h antes da medição.
 *
 * O log estava certo. `runTrending` não captura nada — ele ENFILEIRA quatro
 * `sync_lists`, e enfileirar deu certo todas as 25 vezes. O que nunca
 * aconteceu foi a captura, do outro lado da fila.
 *
 * Sem `priority` explícita o job nascia com o default do schema — 100
 * (`CatalogJob.priority`, "MENOR = mais prioritario"). Na frente dele, medidos
 * no mesmo instante:
 *
 *     7.782  sync_details  retry_wait  priority 50
 *       270  sync_seasons  pending     priority 65
 *     7.411  sync_media    pending     priority 70
 *     -----
 *    15.463  jobs que TODOS passavam antes
 *
 * E o snapshot de trending vale 6 h (`DISCOVERY_TTL_MS.trending`). Um job que
 * espera a fila de detalhe drenar entrega um snapshot já vencido — ou seja, a
 * fila `trending` estava correta, cara e inútil ao mesmo tempo.
 *
 * ============================================================================
 * POR QUE ISTO TESTA `trending-jobs.ts` E NÃO `runners.ts`
 * ============================================================================
 * Porque `runners.ts` não é importável por teste nenhum: ele puxa
 * `@screena/ingestion/runtime`, que não tem alias no `vitest.config.ts`. Foi
 * exatamente por isso que o campo faltando sobreviveu — não havia arquivo de
 * teste capaz de olhar para ele. O payload mudou de casa para um módulo puro
 * justamente para deixar de ser invisível.
 */

import { describe, expect, it } from 'vitest'

import {
  buildTrendingListJob,
  TRENDING_COMBOS,
  TRENDING_JOB_PRIORITY,
} from '../trending-jobs.js'

/** Prioridades REAIS medidas em produção, 26/08/2026. */
const FILA_REAL = {
  discover_ids: 10,
  sync_details_retry: 50,
  sync_seasons: 65,
  sync_media: 70,
  bootstrap_lists: 80,
  default_do_schema: 100,
} as const

function job(entityType: 'movie' | 'tv' = 'movie', window: 'day' | 'week' = 'week') {
  return buildTrendingListJob({
    entityType,
    window,
    locale: 'pt-BR',
    idempotencyKey: 'trending:2026-08-26T00:week:pt-BR',
    runId: 'scheduler:trending',
  })
}

describe('prioridade do trending na fila de catálogo', () => {
  it('(1) o job nasce com priority EXPLÍCITA', () => {
    expect(typeof job().priority).toBe('number')
  })

  it('(2) CONTROLE NEGATIVO: a priority NÃO é o default do schema (100)', () => {
    // Esta é a linha que faltava. Com 100, os 15.463 jobs medidos em produção
    // passam na frente e o snapshot nunca é capturado dentro do TTL de 6 h.
    expect(job().priority).not.toBe(FILA_REAL.default_do_schema)
  })

  it('(3) fura a fila de detalhe, de mídia e de temporada — as três medidas na frente', () => {
    expect(TRENDING_JOB_PRIORITY).toBeLessThan(FILA_REAL.sync_details_retry)
    expect(TRENDING_JOB_PRIORITY).toBeLessThan(FILA_REAL.sync_seasons)
    expect(TRENDING_JOB_PRIORITY).toBeLessThan(FILA_REAL.sync_media)
    expect(TRENDING_JOB_PRIORITY).toBeLessThan(FILA_REAL.bootstrap_lists)
  })

  it('(4) mas NÃO passa na frente da descoberta, que abre o funil', () => {
    // `discover_ids` é 10 porque sem entidade promovida o snapshot não tem o
    // que apontar — furar a fila DELE trocaria um trilho vazio por outro.
    expect(TRENDING_JOB_PRIORITY).toBeGreaterThan(FILA_REAL.discover_ids)
  })

  it('(5) CONTROLE POSITIVO: uma página por lista, para o custo seguir O(1)', () => {
    // Sem isto o (3) poderia ser satisfeito por um job CARO furando a fila —
    // que seria um defeito diferente, não um conserto.
    expect((job().payload as { maxPages: number }).maxPages).toBe(1)
  })

  it('(6) quatro combinações por ciclo: movie|tv × day|week', () => {
    // Quatro é o custo inteiro da fila. Se este número crescer, o argumento de
    // "furar a fila é barato" deixa de valer junto.
    expect(TRENDING_COMBOS).toHaveLength(4)
    expect(new Set(TRENDING_COMBOS.map((c) => `${c.entityType}:${c.window}`))).toEqual(
      new Set(['movie:day', 'movie:week', 'tv:day', 'tv:week']),
    )
  })

  it('(7) o payload carrega a lista, a janela e o locale que o render lê', () => {
    // `readTrendingSnapshot` filtra por (listType, entityType, window, locale).
    // Um payload que divirja disso captura um snapshot que ninguém lê.
    const payload = job('tv', 'day').payload as Record<string, unknown>

    expect(payload.listType).toBe('trending')
    expect(payload.entityType).toBe('tv')
    expect(payload.window).toBe('day')
    expect(payload.locale).toBe('pt-BR')
  })
})
