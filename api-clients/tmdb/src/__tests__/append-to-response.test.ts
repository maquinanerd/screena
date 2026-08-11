/**
 * Testes das constantes de `append_to_response` e do particionador.
 *
 * Travam invariantes derivadas da doc oficial do TMDB:
 *  - `translations` obrigatorio em todo tipo suportado (captura todos os idiomas
 *    num unico request);
 *  - somente os 5 tipos que a doc oficial declara suportarem append;
 *  - nenhum sub-recurso que exija sessao de usuario (`account_states`) ou de
 *    curadoria (`lists`) — nao sao metadado de entidade;
 *  - cada conjunto <= teto de sub-requests, sem duplicatas;
 *  - `partitionAppend` particiona/dedup/limpa corretamente.
 */

import { describe, expect, it } from 'vitest'
import {
  MOVIE_APPEND,
  PERSON_APPEND,
  TMDB_APPEND_BY_TYPE,
  TMDB_APPEND_LIMIT,
  TV_APPEND,
  TV_EPISODE_APPEND,
  TV_SEASON_APPEND,
  appendChunksForType,
  partitionAppend,
} from '../append-to-response.js'

const ALL_TYPES = ['movie', 'tv', 'tv_season', 'tv_episode', 'person'] as const

describe('constantes de append_to_response', () => {
  it('cobre exatamente os 5 tipos que a doc oficial suporta', () => {
    expect(Object.keys(TMDB_APPEND_BY_TYPE).sort()).toEqual([...ALL_TYPES].sort())
  })

  it('translations e obrigatorio em todo tipo suportado', () => {
    for (const type of ALL_TYPES) {
      expect(TMDB_APPEND_BY_TYPE[type]).toContain('translations')
    }
  })

  it('nenhum conjunto inclui sub-recursos de sessao/curadoria (account_states/lists)', () => {
    for (const type of ALL_TYPES) {
      expect(TMDB_APPEND_BY_TYPE[type]).not.toContain('account_states')
      expect(TMDB_APPEND_BY_TYPE[type]).not.toContain('lists')
    }
  })

  it('cada conjunto respeita o teto de sub-requests e nao tem duplicatas', () => {
    for (const type of ALL_TYPES) {
      const values = TMDB_APPEND_BY_TYPE[type]
      expect(values.length).toBeLessThanOrEqual(TMDB_APPEND_LIMIT)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('watch/providers so nas superficies que a doc confirma (movie/tv/season)', () => {
    expect(MOVIE_APPEND).toContain('watch/providers')
    expect(TV_APPEND).toContain('watch/providers')
    expect(TV_SEASON_APPEND).toContain('watch/providers')
    expect(TV_EPISODE_APPEND).not.toContain('watch/providers')
    expect(PERSON_APPEND).not.toContain('watch/providers')
  })

  it('creditos por tipo: aggregate_credits em serie/temporada; person usa combined_credits', () => {
    expect(TV_APPEND).toContain('aggregate_credits')
    expect(TV_SEASON_APPEND).toContain('aggregate_credits')
    expect(PERSON_APPEND).toContain('combined_credits')
  })

  it('person NAO pede movie_credits/tv_credits: combined_credits ja e a uniao', () => {
    // Corte de desperdicio: os tres juntos arquivavam cada credito 2x em
    // `tmdb_raw`. `media_type` dentro de combined_credits separa filme de serie.
    expect(PERSON_APPEND).not.toContain('movie_credits')
    expect(PERSON_APPEND).not.toContain('tv_credits')
  })
})

describe('partitionAppend', () => {
  it('devolve [] para entrada vazia', () => {
    expect(partitionAppend([])).toEqual([])
  })

  it('junta em um unico bloco quando cabe no teto', () => {
    expect(partitionAppend(['a', 'b', 'c'])).toEqual(['a,b,c'])
  })

  it('particiona em blocos de ate `limit` valores', () => {
    expect(partitionAppend(['a', 'b', 'c', 'd', 'e'], 2)).toEqual(['a,b', 'c,d', 'e'])
  })

  it('remove duplicatas preservando a primeira ocorrencia', () => {
    expect(partitionAppend(['a', 'b', 'a', 'c'])).toEqual(['a,b,c'])
  })

  it('ignora valores vazios/espacos e faz trim', () => {
    expect(partitionAppend([' a ', '', '  ', 'b'])).toEqual(['a,b'])
  })

  it('limit invalido (<=0 ou nao-inteiro) cai no default', () => {
    const many = Array.from({ length: TMDB_APPEND_LIMIT + 3 }, (_, i) => `v${i}`)
    expect(partitionAppend(many, 0)).toHaveLength(2)
    expect(partitionAppend(many, -5)).toHaveLength(2)
    expect(partitionAppend(many, 1.5)).toHaveLength(2)
  })

  it('appendChunksForType usa o conjunto do tipo (1 bloco, pois todos <= teto)', () => {
    for (const type of ALL_TYPES) {
      expect(appendChunksForType(type)).toEqual([TMDB_APPEND_BY_TYPE[type].join(',')])
    }
  })
})
