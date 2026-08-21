/**
 * coverage-priority-by-popularity.test.ts — O ajuste fino da fila, e o contrato
 * que o impede de virar fura-fila.
 *
 * O que este arquivo protege: popularidade ordena DENTRO de um motivo e NUNCA
 * promove um pedido para a faixa de outro. Sem essa garantia, um titulo popular
 * de backfill passaria na frente de um leitor esperando na tela — o exato
 * inverso da politica.
 */

import { describe, expect, it } from 'vitest'

import {
  buildCoverageJob,
  COVERAGE_PRIORITY,
  COVERAGE_REASONS,
  popularityPriorityOffset,
  POPULARITY_PRIORITY_OFFSETS,
} from '../entity-coverage/entry.js'

describe('o motivo domina; a popularidade so desempata', () => {
  it('o MAIOR deslocamento e menor que o MENOR intervalo entre motivos', () => {
    const maiorOffset = Math.max(...POPULARITY_PRIORITY_OFFSETS.map((b) => b.offset))
    const prioridades = COVERAGE_REASONS.map((reason) => COVERAGE_PRIORITY[reason]).sort(
      (a, b) => a - b,
    )
    const menorIntervalo = Math.min(
      ...prioridades.slice(1).map((value, index) => value - prioridades[index]!),
    )
    expect(maiorOffset).toBeLessThan(menorIntervalo)
  })

  it('o titulo MAIS popular de um motivo ainda perde para o PIOR do motivo anterior', () => {
    const melhorAgendado = buildCoverageJob({
      kind: 'movie',
      tmdbId: 1,
      locale: 'pt-BR',
      reason: 'scheduled',
      rank: 1,
    }).priority as number
    const piorMudanca = buildCoverageJob({
      kind: 'movie',
      tmdbId: 2,
      locale: 'pt-BR',
      reason: 'changes',
      rank: null,
    }).priority as number
    expect(piorMudanca).toBeLessThan(melhorAgendado)
  })

  it('o leitor esperando continua na frente de TODO agendado', () => {
    const leitor = buildCoverageJob({
      kind: 'movie',
      tmdbId: 1,
      locale: 'pt-BR',
      reason: 'on_demand',
    }).priority as number
    for (const rank of [1, 10, 100, 1_000, 10_000, null]) {
      const agendado = buildCoverageJob({
        kind: 'movie',
        tmdbId: 2,
        locale: 'pt-BR',
        reason: 'scheduled',
        rank,
      }).priority as number
      expect(leitor, `rank ${String(rank)}`).toBeLessThan(agendado)
    }
  })
})

describe('undefined e null NAO colapsam', () => {
  it('OMITIDO = o chamador nao ranqueia: deslocamento zero', () => {
    expect(popularityPriorityOffset(undefined)).toBe(0)
    const job = buildCoverageJob({ kind: 'movie', tmdbId: 1, locale: 'pt-BR', reason: 'discovery' })
    expect(job.priority).toBe(COVERAGE_PRIORITY.discovery)
  })

  it('null = ranqueia, sem posicao medida: faixa mais baixa, nunca a mais alta', () => {
    const ultimo = POPULARITY_PRIORITY_OFFSETS[POPULARITY_PRIORITY_OFFSETS.length - 1]!.offset
    expect(popularityPriorityOffset(null)).toBe(ultimo)
    expect(popularityPriorityOffset(1)).toBeLessThan(popularityPriorityOffset(null))
  })

  it('rank invalido (0, negativo, NaN) cai na faixa mais baixa — nao no topo', () => {
    const ultimo = POPULARITY_PRIORITY_OFFSETS[POPULARITY_PRIORITY_OFFSETS.length - 1]!.offset
    for (const rank of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(popularityPriorityOffset(rank), String(rank)).toBe(ultimo)
    }
  })
})

describe('as faixas', () => {
  it('sao monotonicas: rank pior nunca ganha prioridade melhor', () => {
    const ranks = [1, 5, 10, 50, 100, 500, 1_000, 5_000, 10_000, 100_000]
    for (let i = 1; i < ranks.length; i += 1) {
      expect(popularityPriorityOffset(ranks[i]!)).toBeGreaterThanOrEqual(
        popularityPriorityOffset(ranks[i - 1]!),
      )
    }
  })

  it('CONTROLE NEGATIVO: o valor obvio (20) JA quebraria o contrato — foi por isso que virou 16', () => {
    // Este teste passou por uma reprovacao real: com o teto em 20, um
    // `scheduled` de cauda (80+20) EMPATAVA com um `discovery` sem rank
    // (100+0), e empate no claim cai em ordem de insercao — o criterio que este
    // ajuste existe para substituir. O assert mede a distancia, nao o numero.
    const prioridades = COVERAGE_REASONS.map((reason) => COVERAGE_PRIORITY[reason]).sort(
      (a, b) => a - b,
    )
    const menorIntervalo = Math.min(
      ...prioridades.slice(1).map((value, index) => value - prioridades[index]!),
    )
    expect(20).toBeGreaterThanOrEqual(menorIntervalo)
  })
})
