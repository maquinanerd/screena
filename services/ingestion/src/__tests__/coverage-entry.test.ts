/**
 * coverage-entry.test.ts — A PORTA UNICA de cobertura (T0).
 *
 * CONTROLE POSITIVO: cada teste aqui falha se a porta parar de produzir um job
 * bem formado. O controle NEGATIVO — provar que o teste reprova quando o
 * caminho unico e quebrado de verdade — esta em `coverage-single-path.test.ts`,
 * que varre o repositorio atras de um segundo caminho.
 */

import { describe, expect, it } from 'vitest'

import {
  buildCoverageJob,
  buildCoverageJobs,
  COVERAGE_PRIORITY,
  COVERAGE_REASONS,
  InvalidCoverageRequestError,
} from '../entity-coverage/entry.js'

describe('buildCoverageJob', () => {
  it('produz um sync_details com o payload que o handler valida', () => {
    const job = buildCoverageJob({
      kind: 'movie',
      tmdbId: 1061474,
      locale: 'pt-BR',
      reason: 'on_demand',
    })

    expect(job.jobType).toBe('sync_details')
    expect(job.entityType).toBe('movie')
    expect(job.externalId).toBe('1061474')
    // Estes dois campos SAO a cicatriz: sem eles no PAYLOAD, o handler reprova
    // e o job vira dead-letter. Ver o cabecalho de entity-coverage/entry.ts.
    expect(job.payload).toMatchObject({ entityType: 'movie', tmdbId: 1061474 })
  })

  it('contrata a CASCATA, nao so o detalhe', () => {
    const job = buildCoverageJob({
      kind: 'tv',
      tmdbId: 1396,
      locale: 'pt-BR',
      reason: 'discovery',
    })
    // Sem isto o titulo entraria sem midia e sem temporadas: "parece completo
    // mas nao e", que e exatamente o que o T0 proibe.
    expect(job.payload?.enqueueDependencies).toBe(true)
  })

  it('prioriza quem tem leitor esperando: on_demand < changes < discovery', () => {
    const priorityOf = (reason: 'discovery' | 'changes' | 'on_demand'): number =>
      buildCoverageJob({ kind: 'movie', tmdbId: 1, locale: 'pt-BR', reason }).priority as number

    expect(priorityOf('on_demand')).toBeLessThan(priorityOf('changes'))
    expect(priorityOf('changes')).toBeLessThan(priorityOf('discovery'))
    expect(priorityOf('on_demand')).toBe(COVERAGE_PRIORITY.on_demand)
  })

  it('o mesmo alvo sem escopo colapsa numa chave (noop idempotente)', () => {
    const once = buildCoverageJob({ kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'discovery' })
    const again = buildCoverageJob({ kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'discovery' })
    expect(once.idempotencyKey).toBe(again.idempotencyKey)
  })

  it('escopos diferentes sao trabalhos diferentes (mudanca em janela nova)', () => {
    const base = { kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'changes' } as const
    const janela1 = buildCoverageJob({ ...base, scope: '2026-08-01:2026-08-07' })
    const janela2 = buildCoverageJob({ ...base, scope: '2026-08-08:2026-08-14' })
    // Se colidissem, a segunda mudanca do mesmo titulo seria descartada como
    // duplicata e o titulo congelaria na primeira versao.
    expect(janela1.idempotencyKey).not.toBe(janela2.idempotencyKey)
  })

  it('locales diferentes nao colidem', () => {
    const pt = buildCoverageJob({ kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'discovery' })
    const en = buildCoverageJob({ kind: 'movie', tmdbId: 42, locale: 'en-US', reason: 'discovery' })
    expect(pt.idempotencyKey).not.toBe(en.idempotencyKey)
  })

  it('recusa pedido malformado nomeando o campo culpado', () => {
    const bad = [
      { input: { kind: 'season', tmdbId: 1, locale: 'pt-BR', reason: 'discovery' }, field: 'kind' },
      { input: { kind: 'movie', tmdbId: 0, locale: 'pt-BR', reason: 'discovery' }, field: 'tmdbId' },
      { input: { kind: 'movie', tmdbId: 1.5, locale: 'pt-BR', reason: 'discovery' }, field: 'tmdbId' },
      { input: { kind: 'movie', tmdbId: 1, locale: '  ', reason: 'discovery' }, field: 'locale' },
      { input: { kind: 'movie', tmdbId: 1, locale: 'pt-BR', reason: 'palpite' }, field: 'reason' },
    ] as const

    for (const { input, field } of bad) {
      let caught: unknown = null
      try {
        buildCoverageJob(input as never)
      } catch (error) {
        caught = error
      }
      expect(caught, `esperava recusa para ${field}`).toBeInstanceOf(InvalidCoverageRequestError)
      expect((caught as InvalidCoverageRequestError).field).toBe(field)
    }
  })

  it('todo motivo declarado tem prioridade', () => {
    for (const reason of COVERAGE_REASONS) {
      expect(COVERAGE_PRIORITY[reason]).toBeTypeOf('number')
    }
  })

  it('buildCoverageJobs preserva a ordem recebida', () => {
    const jobs = buildCoverageJobs([
      { kind: 'movie', tmdbId: 3, locale: 'pt-BR', reason: 'discovery' },
      { kind: 'movie', tmdbId: 1, locale: 'pt-BR', reason: 'discovery' },
    ])
    expect(jobs.map((j) => j.externalId)).toEqual(['3', '1'])
  })
})
