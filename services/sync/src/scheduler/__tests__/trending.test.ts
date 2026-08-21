/**
 * trending.test.ts — O sinal de AGORA na prioridade da fila.
 *
 * O que este arquivo protege, em ordem de importancia:
 *  1. a conversao 0-based -> 1-based (errar aqui manda o titulo MAIS trending do
 *     dia para a faixa de cauda, silenciosamente);
 *  2. o trending SUBSTITUI o rank de popularidade, e o efeito e mensuravel em
 *     pontos de prioridade;
 *  3. o teto continua valendo: trending nunca fura a faixa de outro motivo;
 *  4. ausencia de trending devolve o comportamento ANTERIOR, nao um erro.
 */

import { describe, expect, it } from 'vitest'

import { buildCoverageJob, COVERAGE_PRIORITY } from '@screena/ingestion/runtime'

import { findRhythm } from '../rhythms.js'
import { windowSlot } from '../scope.js'
import { effectiveRank, NO_TRENDING, rankFromPosition } from '../trending.js'

describe('a conversao de posicao para rank', () => {
  it('position 0 (o MAIS trending) vira rank 1, nao 0', () => {
    // `rank <= 0` significa "sem posicao medida" e cai na faixa de CAUDA. Passar
    // a posicao crua mandaria o primeiro colocado para o fundo da fila.
    expect(rankFromPosition(0)).toBe(1)
  })

  it('a conversao e monotonica e preserva a ordem do snapshot', () => {
    expect([0, 1, 2, 19].map(rankFromPosition)).toEqual([1, 2, 3, 20])
  })

  it('posicao negativa (dado torto) nao vira rank invalido', () => {
    expect(rankFromPosition(-3)).toBe(1)
  })

  it('CONTROLE NEGATIVO: sem a conversao, o 1o colocado cairia na CAUDA', () => {
    const comConversao = buildCoverageJob({
      kind: 'movie', tmdbId: 1, locale: 'pt-BR', reason: 'scheduled',
      rank: rankFromPosition(0),
    }).priority as number
    const semConversao = buildCoverageJob({
      kind: 'movie', tmdbId: 1, locale: 'pt-BR', reason: 'scheduled',
      // 0 cru, o defeito.
      rank: 0,
    }).priority as number
    expect(comConversao).toBeLessThan(semConversao)
    expect(semConversao - comConversao).toBe(16)
  })
})

describe('o trending SUBSTITUI o rank de popularidade', () => {
  const trending = new Map([[42, 3]])

  it('titulo no trending usa a posicao dele, e o sinal e nomeado', () => {
    expect(effectiveRank(42, 40_000, trending)).toEqual({ rank: 3, signal: 'trending' })
  })

  it('titulo fora do trending mantem o rank de popularidade', () => {
    expect(effectiveRank(99, 40_000, trending)).toEqual({ rank: 40_000, signal: 'popularity' })
  })

  it('sem NENHUM dos dois, o rank e null e o sinal diz isso', () => {
    expect(effectiveRank(99, null, NO_TRENDING)).toEqual({ rank: null, signal: 'none' })
  })

  it('trending vale mesmo sem rank de popularidade — e ai ele e a UNICA medida', () => {
    expect(effectiveRank(42, null, trending)).toEqual({ rank: 3, signal: 'trending' })
  })

  it('o EFEITO sao 16 pontos: da cauda para o topo da faixa `scheduled`', () => {
    const cauda = buildCoverageJob({
      kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'scheduled',
      rank: effectiveRank(42, 40_000, NO_TRENDING).rank,
    }).priority as number
    const emAlta = buildCoverageJob({
      kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'scheduled',
      rank: effectiveRank(42, 40_000, trending).rank,
    }).priority as number

    expect(cauda - emAlta).toBe(16)
    expect(emAlta).toBe(COVERAGE_PRIORITY.scheduled)
  })
})

describe('o teto continua valendo', () => {
  it('trending NAO fura a faixa de outro motivo: `changes` continua na frente', () => {
    const trending = new Map([[42, 1]])
    const agendadoEmAlta = buildCoverageJob({
      kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'scheduled',
      rank: effectiveRank(42, 40_000, trending).rank,
    }).priority as number
    const piorMudanca = buildCoverageJob({
      kind: 'movie', tmdbId: 7, locale: 'pt-BR', reason: 'changes', rank: null,
    }).priority as number
    expect(piorMudanca).toBeLessThan(agendadoEmAlta)
  })

  it('e o leitor esperando continua na frente de tudo', () => {
    const trending = new Map([[42, 1]])
    const leitor = buildCoverageJob({
      kind: 'movie', tmdbId: 7, locale: 'pt-BR', reason: 'on_demand',
    }).priority as number
    const agendadoEmAlta = buildCoverageJob({
      kind: 'movie', tmdbId: 42, locale: 'pt-BR', reason: 'scheduled',
      rank: effectiveRank(42, 40_000, trending).rank,
    }).priority as number
    expect(leitor).toBeLessThan(agendadoEmAlta)
  })
})

describe('degradacao segura', () => {
  it('mapa vazio devolve o comportamento ANTERIOR, nao um erro', () => {
    expect(effectiveRank(42, 40_000, NO_TRENDING)).toEqual({ rank: 40_000, signal: 'popularity' })
  })
})

describe('a fila trending', () => {
  it('roda a 6 h — o mesmo numero que discovery-snapshots ja declarava', () => {
    const rhythm = findRhythm('trending')!
    expect(rhythm.intervalHours).toBe(6)
    expect(rhythm.providerApi).toBe('tmdb')
  })

  it('o balde de 6 h e ancorado na meia-noite UTC, nao no "agora"', () => {
    // Duas replicas que subiram em minutos diferentes tem de ver o MESMO balde.
    const a = new Date('2026-05-10T06:01:00.000Z')
    const b = new Date('2026-05-10T11:59:00.000Z')
    expect(windowSlot('trending', a, 6)).toBe(windowSlot('trending', b, 6))
    expect(windowSlot('trending', a, 6)).toBe('trending:2026-05-10T06')
  })

  it('o ciclo SEGUINTE e trabalho novo — a lista nao congela no primeiro do dia', () => {
    const ciclo1 = new Date('2026-05-10T11:59:00.000Z')
    const ciclo2 = new Date('2026-05-10T12:00:00.000Z')
    expect(windowSlot('trending', ciclo1, 6)).not.toBe(windowSlot('trending', ciclo2, 6))
  })

  it('sao QUATRO baldes por dia, nao seis nem um', () => {
    const dia = '2026-05-10'
    const baldes = new Set(
      Array.from({ length: 24 }, (_, h) =>
        windowSlot('trending', new Date(`${dia}T${String(h).padStart(2, '0')}:30:00.000Z`), 6),
      ),
    )
    expect(baldes.size).toBe(4)
  })

  it('CONTROLE NEGATIVO: o escopo DIARIO colapsaria os quatro ciclos num so', () => {
    const manha = new Date('2026-05-10T01:00:00.000Z')
    const noite = new Date('2026-05-10T22:00:00.000Z')
    // Com balde de 24 h os dois seriam o mesmo trabalho — a lista congelaria no
    // primeiro ciclo do dia.
    expect(windowSlot('trending', manha, 24)).toBe(windowSlot('trending', noite, 24))
    // Com 6 h, nao.
    expect(windowSlot('trending', manha, 6)).not.toBe(windowSlot('trending', noite, 6))
  })
})
