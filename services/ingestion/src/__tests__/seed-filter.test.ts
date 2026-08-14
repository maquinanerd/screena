/**
 * seed-filter.test.ts — O filtro de emissao diaria, e o seu ESCOPO.
 *
 * O teste que mais importa nao e "exclui telejornal" — e o de escopo: a serie
 * excluida da SEMENTE continua alcancavel SOB DEMANDA. Se o mesmo filtro
 * estivesse nos dois caminhos, buscar "Malhacao" no site nao acharia nada, e
 * isso e defeito, nao politica.
 */

import { describe, expect, it } from 'vitest'

import {
  DAILY_EMISSION_TV_GENRES,
  evaluateSeedSeries,
  summarizeSeedFilter,
  type SeedSeriesCandidate,
} from '../discovery/seed-filter.js'
import { matchOnDemand } from '../on-demand/match.js'
import { checkEligibility } from '../on-demand/eligibility.js'

/** Malhacao: novela (Soap 10766), 6.198 episodios. Numeros reais do TMDB. */
const malhacao: SeedSeriesCandidate = { tmdbId: 14424, genreIds: [10766, 18], episodes: 6198 }
/** Tagesschau: telejornal (News 10763), 21.352 episodios. */
const tagesschau: SeedSeriesCandidate = { tmdbId: 94722, genreIds: [10763], episodes: 21352 }
/** Breaking Bad: drama, 62 episodios. */
const breakingBad: SeedSeriesCandidate = { tmdbId: 1396, genreIds: [18, 80], episodes: 62 }

describe('os ids de genero vem da TMDB, nao de suposicao', () => {
  it('sao exatamente News, Reality, Soap e Talk', () => {
    // Conferidos em GET /genre/tv/list em 2026-08-14.
    expect([...DAILY_EMISSION_TV_GENRES].sort((a, b) => a - b)).toEqual([
      10763, 10764, 10766, 10767,
    ])
  })
})

describe('exclusao da semente', () => {
  it('novela fica de fora, e o motivo nomeia o genero', () => {
    const v = evaluateSeedSeries(malhacao)
    expect(v.included).toBe(false)
    if (v.included) return
    expect(v.reason).toBe('daily_emission_genre')
    expect(v.matchedGenres).toContain(10766)
    expect(v.detail).toContain('14424')
  })

  it('telejornal fica de fora', () => {
    expect(evaluateSeedSeries(tagesschau).included).toBe(false)
  })

  it('drama entra', () => {
    expect(evaluateSeedSeries(breakingBad).included).toBe(true)
  })

  it('genero de emissao diaria vence mesmo acompanhado de drama', () => {
    // Malhacao e [Soap, Drama]. Ter um genero "bom" junto nao a salva.
    expect(evaluateSeedSeries({ ...malhacao, genreIds: [18, 10766] }).included).toBe(false)
  })

  it('teto de episodios e o corte COMPLEMENTAR, e so age depois do genero', () => {
    // Barátok közt sobreviveu ao filtro de genero com 10.456 episodios — foi
    // este caso real que motivou o teto existir.
    const baratok: SeedSeriesCandidate = { tmdbId: 50821, genreIds: [18], episodes: 10456 }
    expect(evaluateSeedSeries(baratok).included).toBe(true) // sem teto: passa
    const comTeto = evaluateSeedSeries(baratok, 1000)
    expect(comTeto.included).toBe(false)
    if (comTeto.included) return
    expect(comTeto.reason).toBe('episode_ceiling')
  })

  it('sem teto declarado, nenhuma serie e excluida por volume', () => {
    const v = evaluateSeedSeries({ tmdbId: 1, genreIds: [18], episodes: 99_999 }, null)
    expect(v.included).toBe(true)
  })
})

describe('resumo do lote', () => {
  it('conta episodios evitados — o numero que justifica o filtro', () => {
    const s = summarizeSeedFilter([malhacao, tagesschau, breakingBad])
    expect(s.considered).toBe(3)
    expect(s.included).toBe(1)
    expect(s.excludedByGenre).toBe(2)
    expect(s.episodesAvoided).toBe(6198 + 21352)
    expect(s.episodesIncluded).toBe(62)
  })

  it('todo descarte e notificado — nenhum e anonimo', () => {
    const vistos: number[] = []
    summarizeSeedFilter([malhacao, tagesschau, breakingBad], null, (c) => vistos.push(c.tmdbId))
    expect(vistos).toEqual([14424, 94722])
  })
})

describe('ESCOPO: a exclusao e da semente, nao do site', () => {
  it('Malhacao fica fora da semente E e alcancavel sob demanda', () => {
    // Sentido 1: a semente nao a copia.
    expect(evaluateSeedSeries(malhacao).included).toBe(false)

    // Sentido 2: o leitor que busca por ela, acha. O caminho sob demanda nao
    // conhece genero de emissao diaria — ele so pergunta "casou com confianca?"
    // e "tem material para virar pagina?".
    const match = matchOnDemand('Malhacao', [
      { kind: 'tv', tmdbId: 14424, title: 'Malhação', year: 1995 },
    ])
    expect(match.matched).toBe(true)
    if (!match.matched) return
    expect(match.tmdbId).toBe(14424)

    const elegivel = checkEligibility({
      kind: 'tv',
      tmdbId: 14424,
      posterPath: '/malhacao.jpg',
      title: 'Malhação',
      overview: 'Serie teen brasileira.',
    }, 'on_demand')
    expect(elegivel.eligible).toBe(true)
  })

  it('o mesmo vale para telejornal: fora da semente, achavel sob demanda', () => {
    expect(evaluateSeedSeries(tagesschau).included).toBe(false)
    const match = matchOnDemand('Tagesschau', [
      { kind: 'tv', tmdbId: 94722, title: 'Tagesschau', year: 1952 },
    ])
    expect(match.matched).toBe(true)
  })
})
