/**
 * Testes do modelo de custo do bootstrap.
 *
 * O caso central e o (1): uma serie longa custa ordens de grandeza mais que um
 * filme, e e exatamente isso que `--limit` esconde. Se este teste cair, o
 * planejador voltou a medir titulo em vez de episodio.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSUMPTIONS,
  estimateBootstrapCost,
  estimateScenarios,
  evaluateBudget,
  largestAffordablePrefix,
  type DiscoveryCost,
  type PlannedTitle,
} from '../cost-model.js'

const discovery: DiscoveryCost = { listCount: 10, listPagesFetched: 10, entityKinds: 2 }

const movie = (id: number): PlannedTitle => ({
  kind: 'movie',
  tmdbId: id,
  title: `Filme ${id}`,
  seasons: 0,
  episodes: 0,
})
const series = (id: number, seasons: number, episodes: number): PlannedTitle => ({
  kind: 'tv',
  tmdbId: id,
  title: `Serie ${id}`,
  seasons,
  episodes,
})

describe('estimateBootstrapCost', () => {
  it('(1) uma novela custa ordens de grandeza mais que um filme — o ponto do modelo', () => {
    const oneMovie = estimateBootstrapCost([movie(1)], discovery)
    // Numeros reais observados numa novela da lista `popular`.
    const oneSoap = estimateBootstrapCost([series(2, 213, 11_000)], discovery)

    expect(oneSoap.episodes).toBe(11_000)
    expect(oneMovie.episodes).toBe(0)
    // O custo em JOBS da novela e dominado por sync_episodes (1 por temporada).
    expect(oneSoap.jobsTotal).toBeGreaterThan(oneMovie.jobsTotal * 10)
    expect(oneSoap.apiCalls).toBeGreaterThan(oneMovie.apiCalls * 10)
  })

  it('(2) o modelo de jobs espelha a cascata real', () => {
    const e = estimateBootstrapCost([movie(1), series(2, 4, 40)], discovery)
    expect(e.jobsByType.sync_details).toBe(2) // 1 por titulo
    expect(e.jobsByType.sync_media).toBe(2) // 1 por titulo
    expect(e.jobsByType.sync_seasons).toBe(1) // so serie
    expect(e.jobsByType.sync_episodes).toBe(4) // 1 por temporada
    expect(e.jobsByType.discover_ids).toBe(2) // 1 por tipo
    expect(e.jobsByType.sync_lists).toBe(10)
  })

  it('(3) usa os contadores REAIS do provider, nao o fallback', () => {
    const e = estimateBootstrapCost([series(1, 7, 73)], discovery)
    expect(e.seasons).toBe(7)
    expect(e.episodes).toBe(73)
    expect(e.titlesWithMissingFacts).toBe(0)
  })

  it('(4) sem contadores, cai no fallback E REPORTA a incerteza', () => {
    const unknown: PlannedTitle = {
      kind: 'tv',
      tmdbId: 9,
      title: 'Serie sem contadores',
      seasons: 0,
      episodes: 0,
      factsMissing: true,
    }
    const e = estimateBootstrapCost([unknown], discovery)
    expect(e.seasons).toBe(DEFAULT_ASSUMPTIONS.fallbackSeasons)
    expect(e.episodes).toBe(
      DEFAULT_ASSUMPTIONS.fallbackSeasons * DEFAULT_ASSUMPTIONS.fallbackEpisodesPerSeason,
    )
    // Estimativa que esconde a propria incerteza e pior que nenhuma.
    expect(e.titlesWithMissingFacts).toBe(1)
  })

  it('(5) filme nunca gera temporada/episodio', () => {
    const e = estimateBootstrapCost([movie(1), movie(2), movie(3)], discovery)
    expect(e.seasons).toBe(0)
    expect(e.episodes).toBe(0)
    expect(e.jobsByType.sync_seasons).toBe(0)
    expect(e.jobsByType.sync_episodes).toBe(0)
  })
})

describe('evaluateBudget', () => {
  const big = estimateBootstrapCost([series(1, 213, 11_000), series(2, 100, 5_000)], discovery)

  it('(6) ESTOURO de episodios e detectado, com o quanto excedeu', () => {
    const d = evaluateBudget(big, { maxEpisodes: 5_000 })
    expect(d.withinBudget).toBe(false)
    const v = d.violations.find((x) => x.dimension === 'episodes')
    expect(v?.estimated).toBe(16_000)
    expect(v?.limit).toBe(5_000)
    expect(v?.overBy).toBe(11_000)
  })

  it('(7) dimensao sem teto declarado NUNCA viola', () => {
    // Sem nenhum teto: nada pode violar, por maior que seja.
    expect(evaluateBudget(big, {}).withinBudget).toBe(true)
  })

  it('(8) um orcamento generoso passa', () => {
    const d = evaluateBudget(big, { maxEpisodes: 50_000, maxJobs: 10_000 })
    expect(d.withinBudget).toBe(true)
    expect(d.violations).toHaveLength(0)
  })

  it('(9) o resumo nomeia as dimensoes estouradas (vai para log e alerta)', () => {
    const d = evaluateBudget(big, { maxEpisodes: 10, maxJobs: 5 })
    expect(d.summary).toContain('episodes')
    expect(d.summary).toContain('jobs')
  })

  it('(10) o veredito usa o cenario ESPERADO, nao o otimista', () => {
    const titles = [series(1, 50, 2_000)]
    const s = estimateScenarios(titles, discovery)
    // O otimista NAO pode ser usado para aprovar um orcamento que o esperado estoura.
    expect(s.conservative.durationMinutes).toBeGreaterThan(s.expected.durationMinutes)
    expect(s.optimistic.durationMinutes).toBeLessThan(s.expected.durationMinutes)
  })
})

describe('largestAffordablePrefix', () => {
  it('(11) responde QUANTOS titulos cabem, em vez de exigir tentativa e erro', () => {
    const titles = [movie(1), movie(2), series(3, 2, 20), series(4, 200, 10_000)]
    const { titles: chosen, estimate } = largestAffordablePrefix(titles, discovery, {
      maxEpisodes: 1_000,
    })
    // A novela gigante (indice 3) nao cabe; os tres primeiros cabem.
    expect(chosen).toHaveLength(3)
    expect(estimate.episodes).toBe(20)
  })

  it('(12) quando nem o primeiro cabe, devolve conjunto VAZIO (nao "pelo menos um")', () => {
    const titles = [series(1, 500, 30_000)]
    const { titles: chosen } = largestAffordablePrefix(titles, discovery, { maxEpisodes: 10 })
    expect(chosen).toHaveLength(0)
  })

  it('(13) sem orcamento, cabe tudo', () => {
    const titles = [movie(1), series(2, 9, 90)]
    const { titles: chosen } = largestAffordablePrefix(titles, discovery, {})
    expect(chosen).toHaveLength(2)
  })

  it('(14) o prefixo escolhido REALMENTE cabe no orcamento', () => {
    const titles = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0 ? movie(i) : series(i, (i % 7) + 1, ((i % 7) + 1) * 12),
    )
    const budget = { maxEpisodes: 500, maxJobs: 200 }
    const { titles: chosen, estimate } = largestAffordablePrefix(titles, discovery, budget)
    expect(evaluateBudget(estimate, budget).withinBudget).toBe(true)
    // E adicionar o proximo titulo estouraria (senao o prefixo nao seria o maior).
    if (chosen.length < titles.length) {
      const oneMore = estimateBootstrapCost(titles.slice(0, chosen.length + 1), discovery)
      expect(evaluateBudget(oneMore, budget).withinBudget).toBe(false)
    }
  })
})
