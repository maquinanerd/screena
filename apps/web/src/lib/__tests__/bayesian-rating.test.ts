/**
 * bayesian-rating.test.ts — NOTA ALTA COM POUCOS VOTOS NÃO PODE VENCER.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUÇÃO EM 26/08/2026
 * ============================================================================
 * `/pt/series/` → "Popular essa semana" → aba "No ar" abria com:
 *
 *     1. The Challenge          2. Coronation Street     3. Anh Trai Vượt...
 *     4. 税金で買った本          5. UFC                    6. 幽山降妖传
 *
 * A consulta ordenava por `airDate desc` — recência pura. Novela diária e
 * esporte semanal exibem episódio TODO DIA, então ganhavam o topo por
 * frequência de exibição, não por serem o que alguém quer ver. Não havia
 * nenhum sinal de qualidade no recorte: o único portão do produto vivia em
 * "Clássicos".
 *
 * Este módulo é o sinal que faltava. Os casos abaixo são as três armadilhas
 * que uma "nota" ingênua cria — e (7) é o controle positivo, sem o qual um
 * `return 0` constante passaria em quase todos os outros.
 */

import { describe, expect, it } from 'vitest'

import {
  BAYESIAN_PRIOR_VOTES,
  bayesianRating,
  poolMeanRating,
  sortByBayesianRating,
} from '../bayesian-rating'

/** O caso que dá nome ao módulo, escrito com os números do enunciado. */
const OBSCURO = { voteAverage: 8.9, voteCount: 40 }
const CONSAGRADO = { voteAverage: 7.2, voteCount: 12_000 }

/** Recorte realista: é sobre ele que C tem sentido. */
const RECORTE = [
  OBSCURO,
  CONSAGRADO,
  { voteAverage: 6.4, voteCount: 120 },
  { voteAverage: 5.4, voteCount: 90 },
  { voteAverage: 6.8, voteCount: 3_000 },
]

describe('poolMeanRating', () => {
  it('(1) é a média SIMPLES das notas, não ponderada por votos', () => {
    // (8.9 + 7.2 + 6.4 + 5.4 + 6.8) / 5 = 6.94.
    expect(poolMeanRating(RECORTE) as number).toBeCloseTo(6.94, 5)
  })

  it('(1b) A ARMADILHA: ponderar por votos deixaria o mais votado DEFINIR C', () => {
    // Ponderada, a média deste recorte seria ~7.11 — praticamente a nota do
    // próprio CONSAGRADO, que tem 12 mil dos 15,25 mil votos. Encolher em
    // direção a um C que É o consagrado não encolhe em direção a nada, e foi
    // assim que a primeira versão deste módulo deixou o obscuro vencer.
    // Este caso trava a diferença: C simples fica MAIS BAIXO que o ponderado.
    const simples = poolMeanRating(RECORTE) as number
    const ponderada =
      RECORTE.reduce((acc, i) => acc + (i.voteAverage as number) * (i.voteCount as number), 0) /
      RECORTE.reduce((acc, i) => acc + (i.voteCount as number), 0)

    expect(simples).toBeLessThan(ponderada)
    expect(ponderada).toBeGreaterThan(CONSAGRADO.voteAverage - 0.2)
  })

  it('(2) conjunto sem nota/voto devolve null — nunca um "6,5 razoável"', () => {
    // Sem C não há fórmula. Inventar C aqui seria fabricar o número mais
    // importante dela e nunca mais conseguir auditar de onde veio.
    expect(poolMeanRating([])).toBeNull()
    expect(poolMeanRating([{ voteAverage: null, voteCount: null }])).toBeNull()
    expect(poolMeanRating([{ voteAverage: 9, voteCount: 0 }])).toBeNull()
  })
})

describe('bayesianRating', () => {
  it('(3) O CASO DE PRODUÇÃO: 8,9 com 40 votos NÃO vence 7,2 com 12 mil', () => {
    // C do recorte = 6.94 → 7.085 contra 7.190. A ordem se inverte, que é o
    // requisito. Com C ponderado (7.11) o resultado seria 7.24 contra 7.20 e
    // o obscuro venceria — ver (1b).
    const mean = poolMeanRating(RECORTE)

    expect(bayesianRating(OBSCURO, mean)).toBeLessThan(bayesianRating(CONSAGRADO, mean))
  })

  it('(4) CONTROLE NEGATIVO: com nota CRUA a ordem se inverte', () => {
    // Sem este caso o (3) não prova nada — poderia estar passando porque 8,9 é
    // menor que 7,2 em algum universo. Aqui fica explícito QUAL comparação a
    // ponderação desfaz.
    expect(OBSCURO.voteAverage).toBeGreaterThan(CONSAGRADO.voteAverage)
  })

  it('(5) muitos votos convergem para a nota real; poucos colam na média', () => {
    const mean = 7
    const muitos = bayesianRating({ voteAverage: 9, voteCount: 500_000 }, mean)
    const poucos = bayesianRating({ voteAverage: 9, voteCount: 1 }, mean)

    expect(muitos).toBeGreaterThan(8.9)
    expect(poucos).toBeLessThan(7.1)
    expect(poucos).toBeGreaterThan(mean)
  })

  it('(6) registro incompleto vale ZERO — fim da fila, nunca o começo', () => {
    // Um `null` que virasse "a média" premiaria o cadastro pela metade, que é
    // exatamente a classe de lixo que o portão do hero existe para conter.
    expect(bayesianRating({ voteAverage: null, voteCount: 9000 }, 7)).toBe(0)
    expect(bayesianRating({ voteAverage: 8, voteCount: null }, 7)).toBe(0)
    expect(bayesianRating({ voteAverage: 8, voteCount: 9000 }, null)).toBe(0)
  })

  it('(7) CONTROLE POSITIVO: um título bem avaliado E bem votado sobe de verdade', () => {
    // Sem isto, `return 0` constante passaria em (3) e (6) e o módulo inteiro
    // seria um zero vazio.
    expect(bayesianRating(CONSAGRADO, 6)).toBeGreaterThan(6)
    expect(bayesianRating(CONSAGRADO, 6)).toBeGreaterThan(bayesianRating({ voteAverage: 5, voteCount: 12_000 }, 6))
  })

  it('(8) o prior é o mesmo 500 do piso de "Clássicos"', () => {
    // Dois números diferentes para o mesmo conceito ("quantos votos bastam para
    // acreditar na nota") seria divergência esperando acontecer.
    expect(BAYESIAN_PRIOR_VOTES).toBe(500)
  })
})

describe('sortByBayesianRating', () => {
  const NO_AR = [
    { nome: 'UFC', voteAverage: 6.4, voteCount: 120 },
    { nome: 'Coronation Street', voteAverage: 5.4, voteCount: 90 },
    { nome: 'Breaking Bad', voteAverage: 8.9, voteCount: 14_000 },
    { nome: 'Estreia de ontem', voteAverage: 9.6, voteCount: 12 },
  ]

  it('(9) o topo vira a série consagrada, não a de exibição diária', () => {
    const ordem = sortByBayesianRating(
      NO_AR,
      (s) => ({ voteAverage: s.voteAverage, voteCount: s.voteCount }),
      (s) => s.nome,
    ).map((s) => s.nome)

    expect(ordem[0]).toBe('Breaking Bad')
    expect(ordem.indexOf('Estreia de ontem')).toBeGreaterThan(0)
  })

  it('(10) a estreia com 12 votos continua NA LISTA — pondera, não corta', () => {
    // A diferença deliberada em relação a "Clássicos": lá 500 votos é piso e
    // corta; aqui é prior e só impede o atalho para o topo. Cortar apagaria a
    // estreia legítima que ainda não juntou votos.
    const ordem = sortByBayesianRating(
      NO_AR,
      (s) => ({ voteAverage: s.voteAverage, voteCount: s.voteCount }),
      (s) => s.nome,
    )

    expect(ordem).toHaveLength(NO_AR.length)
    expect(ordem.map((s) => s.nome)).toContain('Estreia de ontem')
  })

  it('(11) empate é determinístico — a lista não treme entre requisições', () => {
    const empatados = [
      { nome: 'Zebra', voteAverage: 7, voteCount: 100 },
      { nome: 'Alfa', voteAverage: 7, voteCount: 100 },
    ]
    const read = (s: (typeof empatados)[number]) => ({
      voteAverage: s.voteAverage,
      voteCount: s.voteCount,
    })

    expect(sortByBayesianRating(empatados, read, (s) => s.nome).map((s) => s.nome)).toEqual([
      'Alfa',
      'Zebra',
    ])
    expect(sortByBayesianRating([...empatados].reverse(), read, (s) => s.nome).map((s) => s.nome)).toEqual([
      'Alfa',
      'Zebra',
    ])
  })
})
