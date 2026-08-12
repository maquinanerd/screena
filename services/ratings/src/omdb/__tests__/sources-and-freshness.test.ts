/**
 * sources-and-freshness.test.ts — A tabela de fontes e a janela de re-consulta.
 *
 * As duas coisas moram juntas aqui porque tem a MESMA falha de modo: sao listas
 * que precisam espelhar outra lista. Uma divergencia silenciosa entre
 * `sources.ts` e `freshness.ts` produziria nota ingerida cuja janela de frescor
 * ninguem considerou — ou o contrario.
 */

import { RATING_SCALES, RATING_SOURCES, RATING_STALE_POLICY } from '@screena/config'
import { describe, expect, it } from 'vitest'

import { omdbRefreshCutoff, omdbRefreshWindowHours, OMDB_RATING_SOURCES } from '../freshness.js'
import {
  normalizeOmdbSourceName,
  recognizeOmdbSource,
  RECOGNIZED_OMDB_SOURCE_NAMES,
} from '../sources.js'

describe('tabela de fontes da OMDb', () => {
  it('reconhece exatamente os tres literais que a OMDb publica', () => {
    expect(recognizeOmdbSource('Internet Movie Database')?.ratingSource).toBe('imdb')
    expect(recognizeOmdbSource('Rotten Tomatoes')?.ratingSource).toBe('rotten_tomatoes')
    expect(recognizeOmdbSource('Metacritic')?.ratingSource).toBe('metacritic')
  })

  it('cada fonte reconhecida pertence a RATING_SOURCES (vocabulario canonico)', () => {
    for (const name of RECOGNIZED_OMDB_SOURCE_NAMES) {
      const recognized = recognizeOmdbSource(name)
      expect(recognized, name).not.toBeNull()
      expect(RATING_SOURCES as readonly string[]).toContain(recognized!.ratingSource)
    }
  })

  it('nenhuma fonte reconhecida e o fornecedor tecnico', () => {
    for (const name of RECOGNIZED_OMDB_SOURCE_NAMES) {
      expect(recognizeOmdbSource(name)!.ratingSource).not.toBe('omdb')
    }
  })

  it('a natureza declarada e coerente: IMDb publico, RT e Metacritic critica', () => {
    expect(recognizeOmdbSource('Internet Movie Database')?.expectedScoreType).toBe('audience')
    expect(recognizeOmdbSource('Rotten Tomatoes')?.expectedScoreType).toBe('critics')
    expect(recognizeOmdbSource('Metacritic')?.expectedScoreType).toBe('critics')
  })

  it('a metrica e coerente com a natureza (o unique da tabela depende dela)', () => {
    for (const name of RECOGNIZED_OMDB_SOURCE_NAMES) {
      const recognized = recognizeOmdbSource(name)!
      expect(recognized.metric, name).toBe(recognized.expectedScoreType)
    }
  })

  it('toda fonte reconhecida tem escala canonica declarada', () => {
    for (const name of RECOGNIZED_OMDB_SOURCE_NAMES) {
      const source = recognizeOmdbSource(name)!.ratingSource
      expect(RATING_SCALES[source], source).toBeGreaterThan(0)
    }
  })

  it('recusa o que nao esta na tabela — sem chute por semelhanca', () => {
    for (const bogus of ['TMDB', 'IMDb', 'Rotten', 'Metacritic User Score', '', 'omdb']) {
      expect(recognizeOmdbSource(bogus), bogus).toBeNull()
    }
  })

  it('recusa entrada nao textual sem lancar', () => {
    for (const bogus of [null, undefined, 42, {}, []]) {
      expect(() => recognizeOmdbSource(bogus)).not.toThrow()
      expect(recognizeOmdbSource(bogus)).toBeNull()
    }
  })

  it('normaliza caixa e espaco, e nada alem disso', () => {
    expect(normalizeOmdbSourceName('  Rotten   Tomatoes ')).toBe('rotten tomatoes')
    // Nao remove pontuacao nem faz stemming: "Rotten-Tomatoes" NAO e a mesma coisa.
    expect(normalizeOmdbSourceName('Rotten-Tomatoes')).not.toBe('rotten tomatoes')
  })
})

describe('janela de re-consulta', () => {
  it('espelha exatamente as fontes da tabela de reconhecimento', () => {
    const fromTable = RECOGNIZED_OMDB_SOURCE_NAMES.map(
      (name) => recognizeOmdbSource(name)!.ratingSource,
    ).sort()
    expect([...OMDB_RATING_SOURCES].sort()).toEqual(fromTable)
  })

  it('usa o MENOR refreshAfterHours entre as fontes servidas', () => {
    const declared = OMDB_RATING_SOURCES.map(
      (source) => RATING_STALE_POLICY[source as keyof typeof RATING_STALE_POLICY].refreshAfterHours,
    )
    expect(omdbRefreshWindowHours()).toBe(Math.min(...declared))
  })

  it('hoje isso da 168h (7 dias), de IMDb e Rotten Tomatoes', () => {
    // Ancorado no valor concreto de proposito: se a politica mudar, este teste
    // avisa para que a mudanca seja consciente, nao um efeito colateral.
    expect(omdbRefreshWindowHours()).toBe(168)
  })

  it('NAO usa o maior: 336h (Metacritic) deixaria IMDb e RT parados 14 dias', () => {
    expect(omdbRefreshWindowHours()).not.toBe(336)
  })

  it('o corte e "agora menos a janela", em UTC', () => {
    const now = new Date('2026-08-12T00:00:00.000Z')
    const cutoff = omdbRefreshCutoff(now)
    expect(cutoff).not.toBeNull()
    expect(cutoff!.toISOString()).toBe('2026-08-05T00:00:00.000Z')
  })

  it('o corte anda com o relogio injetado (nunca usa Date.now interno)', () => {
    const a = omdbRefreshCutoff(new Date('2026-08-12T00:00:00.000Z'))!
    const b = omdbRefreshCutoff(new Date('2026-08-13T00:00:00.000Z'))!
    expect(b.getTime() - a.getTime()).toBe(24 * 60 * 60 * 1000)
  })
})
