/**
 * omdb-rotation.test.ts — A reparticao do orcamento diario da OMDb.
 *
 * O que estes testes medem NAO e "a funcao devolve numeros": e que a divisao
 * honra as tres restricoes que a motivaram — o envelope nunca e estourado, a
 * cobertura recebe a maior parte enquanto ela e o trabalho grande, e a fatia de
 * atualizacao ainda fecha a janela de 168h para o conjunto ja coberto.
 */

import { describe, expect, it } from 'vitest'

import {
  coverageLapDays,
  OMDB_BACKGROUND_DAILY_ENVELOPE,
  OMDB_COVERAGE_RATIO,
  OMDB_DAILY_LIMIT,
  OMDB_MOVIE_SHARE,
  ON_DEMAND_RESERVE,
  planOmdbRotation,
  TITLES_WITHOUT_IMDB_ID,
} from '../index.js'

describe('planOmdbRotation reparte sem inventar nem perder requisicao', () => {
  it('a soma das fatias e EXATAMENTE o envelope — nunca uma a mais', () => {
    // Uma requisicao a mais por ciclo e o tipo de erro que ninguem nota e que
    // estoura a cota num dia de borda. Varremos uma faixa de envelopes em vez de
    // testar um numero redondo, porque o arredondamento so quebra nos restos.
    for (let envelope = 0; envelope <= 1000; envelope += 7) {
      const plan = planOmdbRotation(envelope)
      const soma = plan.slices.reduce((acc, slice) => acc + slice.slots, 0)
      expect(soma, `envelope ${String(envelope)}`).toBe(envelope)
      expect(plan.coverageSlots + plan.refreshSlots, `envelope ${String(envelope)}`).toBe(envelope)
      // Nenhuma fatia negativa: um `slots` negativo viraria `--limit -3` no filho.
      for (const slice of plan.slices) expect(slice.slots).toBeGreaterThanOrEqual(0)
    }
  })

  it('envelope zero ou negativo devolve plano de zeros, sem lancar', () => {
    // Um dia sem cota e um resultado legitimo. Lancar faria o agendador tratar
    // "nao ha o que gastar" como falha do ciclo.
    for (const envelope of [0, -1, -700]) {
      const plan = planOmdbRotation(envelope)
      expect(plan.total).toBe(0)
      expect(plan.slices.every((slice) => slice.slots === 0)).toBe(true)
    }
  })

  it('cobertura leva a maior parte, e os quatro lotes existem', () => {
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    expect(plan.coverageSlots).toBeGreaterThan(plan.refreshSlots)
    expect(plan.slices).toHaveLength(4)
    expect(plan.slices.map((s) => `${s.mode}:${s.entityType}`)).toEqual([
      'coverage:movie',
      'coverage:tv',
      'refresh:movie',
      'refresh:tv',
    ])
  })

  it('filme e serie NAO recebem metade cada — a divisao e proporcional', () => {
    // O CONTROLE NEGATIVO do rateio: se alguem voltar a `slots / 2`, a fatia de
    // filme e a de serie ficam iguais e este teste reprova. Sem ele, "a divisao
    // e proporcional" seria uma afirmacao que so o comentario sustenta.
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    const movie = plan.slices.find((s) => s.mode === 'coverage' && s.entityType === 'movie')!
    const tv = plan.slices.find((s) => s.mode === 'coverage' && s.entityType === 'tv')!
    expect(movie.slots).not.toBe(tv.slots)
    expect(movie.slots).toBeGreaterThan(tv.slots)
  })

  it('a fatia de filme segue a populacao CONSULTAVEL, nao a populacao total', () => {
    // O rateio existe para que os dois tipos terminem a volta no MESMO dia.
    // Consultavel = tem imdb_id; sem ele a OMDb nao alcanca o titulo.
    const filmes = 48_611 - TITLES_WITHOUT_IMDB_ID.movie
    const series = 34_700 - TITLES_WITHOUT_IMDB_ID.tv
    const esperado = filmes / (filmes + series)
    expect(OMDB_MOVIE_SHARE).toBeCloseTo(esperado, 2)

    // A consequencia que importa: as duas voltas fecham em prazos parecidos.
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    const voltaFilme = coverageLapDays(
      filmes,
      plan.slices.find((s) => s.mode === 'coverage' && s.entityType === 'movie')!.slots,
    )
    const voltaSerie = coverageLapDays(
      series,
      plan.slices.find((s) => s.mode === 'coverage' && s.entityType === 'tv')!.slots,
    )
    expect(Math.abs(voltaFilme - voltaSerie)).toBeLessThanOrEqual(2)
  })
})

describe('a fatia de atualizacao fecha a janela de 168h', () => {
  it('cobre o conjunto medido em producao (424 titulos) com folga', () => {
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE, { coveredTitles: 424 })
    expect(plan.refreshWindowFits).toBe(true)
    expect(plan.refreshCapacityPerWindow).toBeGreaterThanOrEqual(424)
  })

  it('CONTROLE NEGATIVO: um conjunto coberto grande demais NAO fecha', () => {
    // Sem este caso, `refreshWindowFits` poderia ser `true` constante e o teste
    // acima passaria pelo motivo errado. Este e o gatilho de revisao da divisao
    // 85/15 declarado no cabecalho do modulo.
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE, {
      coveredTitles: 50_000,
    })
    expect(plan.refreshWindowFits).toBe(false)
  })

  it('sem medicao, `refreshWindowFits` e null — nunca um "sim" por omissao', () => {
    expect(planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE).refreshWindowFits).toBeNull()
  })
})

describe('o envelope respeita a cota e deixa folga', () => {
  it('cabe abaixo da cota menos a reserva do leitor', () => {
    const tetoDaCota = OMDB_DAILY_LIMIT - ON_DEMAND_RESERVE
    expect(OMDB_BACKGROUND_DAILY_ENVELOPE).toBeLessThan(tetoDaCota)
    // A folga vale ao menos uma reserva inteira do leitor: e o que compra um
    // ciclo de retry sem cruzar o teto de um fornecedor que nao publica cota.
    expect(tetoDaCota - OMDB_BACKGROUND_DAILY_ENVELOPE).toBeGreaterThanOrEqual(ON_DEMAND_RESERVE)
  })

  it('a divisao e configuravel — o default nao e a unica forma possivel', () => {
    // O enunciado pediu explicitamente que a divisao nao fosse literal enterrado.
    const plan = planOmdbRotation(1000, { coverageRatio: 0.5, movieShare: 0.5 })
    expect(plan.coverageSlots).toBe(500)
    expect(plan.refreshSlots).toBe(500)
    expect(plan.slices.every((slice) => slice.slots === 250)).toBe(true)
    expect(OMDB_COVERAGE_RATIO).not.toBe(0.5)
  })

  it('razao fora de [0,1] ou NaN cai no default, nunca em lixo', () => {
    for (const bad of [Number.NaN, -1, 2]) {
      const plan = planOmdbRotation(100, { coverageRatio: bad })
      expect(plan.coverageSlots + plan.refreshSlots).toBe(100)
      expect(plan.coverageSlots).toBeGreaterThanOrEqual(0)
      expect(plan.coverageSlots).toBeLessThanOrEqual(100)
    }
  })
})

describe('coverageLapDays nao mente sobre uma volta impossivel', () => {
  it('sem slots de cobertura a volta e infinita, nao zero', () => {
    expect(coverageLapDays(1000, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(coverageLapDays(0, 0)).toBe(0)
  })

  it('a volta pelo catalogo consultavel cabe em menos de um ano', () => {
    // A conta que o dono pediu: com a cadencia nova, quantos dias para cobrir
    // tudo o que a OMDb ALCANCA (catalogo menos os sem imdb_id).
    const consultaveis =
      48_611 - TITLES_WITHOUT_IMDB_ID.movie + (34_700 - TITLES_WITHOUT_IMDB_ID.tv)
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    const dias = coverageLapDays(consultaveis, plan.coverageSlots)
    expect(dias).toBeLessThan(365)
    // E MUITO abaixo dos 2.355 dias (6,5 anos) da cadencia semanal de 200.
    expect(dias).toBeLessThan(2355 / 10)
  })
})
