/**
 * producer-jobs.test.ts — OS PRODUTORES NAO PODEM NASCER NO FIM DA FILA.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUCAO EM 16/09/2026
 * ============================================================================
 * 58 `sync_changes` e 42 `discover_ids` pendentes desde 02/09 e 03/09, todos na
 * prioridade 100 — o default do schema. O claim e global
 * (`ORDER BY priority ASC, available_at ASC`) e havia trabalho abaixo de 100
 * o tempo todo: 107.266 `sync_media` de episodio por dia, na 80. Por 14 dias
 * nao nasceu titulo descoberto nem titulo atualizado pelo `/changes`, sem erro
 * em lugar nenhum.
 *
 * O mesmo defeito ja tinha acontecido com o trending (26/08,
 * `services/sync/src/scheduler/__tests__/trending-priority.test.ts`): job que
 * ALIMENTA o funil montado sem `priority`, num arquivo que nenhum teste importa.
 */

import { describe, expect, it } from 'vitest'

import { readSourceWithoutComments } from '../../../../../tests/support/source-text.js'

import { COVERAGE_PRIORITY, popularityPriorityOffset } from '../../entity-coverage/entry.js'
import { validateJobPayload } from '../handlers/schemas.js'
import {
  buildDailyDiscoveryJob,
  buildIncrementalChangesJob,
  PRODUCER_JOB_PRIORITY,
} from '../producer-jobs.js'

/** Prioridades MEDIDAS em producao em 16/09/2026 (as que estavam na frente). */
const FILA_REAL = {
  sync_seasons: 65,
  sync_episodes: 70,
  title_media: 70,
  season_media: 75,
  episode_media: 80,
  default_do_schema: 100,
} as const

const descoberta = (limit: number | null = 20_000) =>
  buildDailyDiscoveryJob({
    kind: 'movie',
    day: '2026-09-16',
    locale: 'pt-BR',
    limit,
    runId: 'scheduler:discovery',
  })

const mudancas = () =>
  buildIncrementalChangesJob({
    slot: '2026-09-16T14',
    kinds: ['movie', 'tv', 'person'],
    runId: 'scheduler:changes',
  })

describe('prioridade dos produtores', () => {
  it('(1) os dois nascem com priority EXPLICITA', () => {
    expect(descoberta().priority).toBe(PRODUCER_JOB_PRIORITY)
    expect(mudancas().priority).toBe(PRODUCER_JOB_PRIORITY)
  })

  it('(2) CONTROLE NEGATIVO: nao e o default do schema (100)', () => {
    // A linha que faltava. Com 100, os 107 mil jobs/dia medidos passam na frente.
    expect(descoberta().priority).not.toBe(FILA_REAL.default_do_schema)
    expect(mudancas().priority).not.toBe(FILA_REAL.default_do_schema)
  })

  it('(3) fura TODO trabalho por titulo — cascata e detalhe de qualquer motivo', () => {
    for (const [nome, prioridade] of Object.entries(FILA_REAL)) {
      expect(PRODUCER_JOB_PRIORITY, nome).toBeLessThan(prioridade)
    }
    // O detalhe mais urgente que um produtor pode gerar e o do `/changes` no
    // topo da popularidade. O produtor tem de vir antes dele.
    expect(PRODUCER_JOB_PRIORITY).toBeLessThan(
      COVERAGE_PRIORITY.changes + popularityPriorityOffset(1),
    )
    expect(PRODUCER_JOB_PRIORITY).toBeLessThan(COVERAGE_PRIORITY.scheduled)
    expect(PRODUCER_JOB_PRIORITY).toBeLessThan(COVERAGE_PRIORITY.discovery)
  })

  it('(4) mas NAO fura quem tem um leitor bloqueado (on_demand)', () => {
    expect(PRODUCER_JOB_PRIORITY).toBeGreaterThan(COVERAGE_PRIORITY.on_demand)
  })
})

describe('a chave nao mudou — os jobs que ja estao no banco continuam sendo o mesmo trabalho', () => {
  // Formato `<jobType>:<entityType>:<externalId>:<discriminador>`, com `-` para
  // segmento vazio. Se esta chave mudar, o primeiro ciclo depois do deploy
  // enfileira DE NOVO a descoberta do dia e a hora do `/changes` que os dois
  // produtores ja tinham enfileirado.
  it('discover_ids: um por tipo, por dia', () => {
    expect(descoberta().idempotencyKey).toBe('discover_ids:movie:daily-exports:2026-09-16:-')
  })

  it('sync_changes: um por hora', () => {
    expect(mudancas().idempotencyKey).toBe('sync_changes:-:incremental:2026-09-16T14:-')
  })
})

describe('o payload e o que o worker aceita', () => {
  it('discover_ids passa no validador do worker, com a cascata ligada', () => {
    const job = descoberta()
    expect(() => validateJobPayload('discover_ids', job.payload)).not.toThrow()
    expect(job.payload).toMatchObject({
      strategy: 'daily-exports',
      enqueueDetails: true,
      limit: 20_000,
    })
  })

  it('o teto chega como veio — `null` so quando quem chama passou `null`', () => {
    expect(descoberta(2000).payload?.limit).toBe(2000)
    expect(descoberta(null).payload?.limit).toBeNull()
  })

  it('sync_changes passa no validador do worker, retomando do checkpoint', () => {
    const job = mudancas()
    expect(() => validateJobPayload('sync_changes', job.payload)).not.toThrow()
    expect(job.payload).toMatchObject({ from: null, to: null, resume: true })
  })
})

describe('os DOIS produtores usam o builder — nenhum monta o job a mao', () => {
  // Guarda TEXTUAL, com o limite de todo guarda textual: pega a grafia
  // `jobType: 'discover_ids'`, nao uma montagem criativa. E o bastante para o
  // defeito que aconteceu: o objeto literal copiado sem `priority`.
  const PRODUTORES = [
    'services/sync/src/scheduler/runtime/runners.ts',
    'services/ingestion/bin/catalog-worker-service.ts',
  ] as const

  for (const caminho of PRODUTORES) {
    const fonte = readSourceWithoutComments(caminho)

    it(`${caminho.split('/').pop()} nao monta discover_ids/sync_changes a mao`, () => {
      expect(fonte).not.toMatch(/jobType\s*:\s*['"`](discover_ids|sync_changes)['"`]/)
    })

    it(`${caminho.split('/').pop()} chama os dois builders`, () => {
      expect(fonte).toMatch(/buildDailyDiscoveryJob\(/)
      expect(fonte).toMatch(/buildIncrementalChangesJob\(/)
    })
  }
})
