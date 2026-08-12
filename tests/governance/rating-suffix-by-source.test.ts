/**
 * rating-suffix-by-source.test.ts — "O SUFIXO E DA FONTE, NAO DO NUMERO."
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * O Rotten Tomatoes estava indo ao ar como `80/100`. Os dados no banco estavam
 * certos (a OMDb entrega `"85%"` e o parser guardou escala 100 corretamente); o
 * defeito era de APRESENTACAO — e era uma afirmacao falsa lida por quem visita
 * a pagina hoje.
 *
 * O Tomatometer e a FRACAO de criticas positivas. "84%" quer dizer "84 de cada
 * 100 criticos aprovaram". "84/100" quer dizer "84 pontos de 100 possiveis" —
 * uma nota. Sao afirmacoes diferentes sobre coisas diferentes, e a fonte so
 * disse a primeira.
 *
 * O caso mais afiado esta abaixo: Rotten Tomatoes e Metacritic tem a MESMA
 * escala (100) e se escrevem DIFERENTE. Nenhuma regra derivada do numero, do
 * denominador ou do `score_type` (ambos sao `critics`!) consegue separar os
 * dois. So a FONTE separa. E por isso que este teste exercita as duas com o
 * mesmo `best` — uma implementacao que derive o sufixo da escala passa em todos
 * os outros casos e morre aqui.
 */

import { describe, expect, it } from 'vitest'

import { buildRatingsView, ratingValueSuffix } from '../../apps/web/src/lib/ratings-presenter'

/**
 * CONTROLE POSITIVO da fixture.
 *
 * Nesta linha de trabalho ja se perderam suites inteiras por fixture malformada:
 * um campo obrigatorio ausente faz `buildRatingsView` devolver `null` em TODOS
 * os casos, e "esperava null, recebeu null" nao prova nada. Aqui o risco e
 * pior ainda, porque os testes esperam VALOR, nao null — uma fixture quebrada
 * derruba a suite com "cannot read property of null", que se parece com bug de
 * codigo.
 *
 * `assertRatingFixtureUsable` roda a fixture pelo presenter e exige que ela
 * PRODUZA um item. Ela e chamada em cada teste, antes da assercao real.
 */
function assertRatingFixtureUsable(rating: Record<string, unknown>): void {
  const view = buildRatingsView({ ratings: [rating] } as never)
  if (view === null || view.items.length !== 1) {
    throw new Error(
      `FIXTURE INUTILIZAVEL: a nota ${JSON.stringify(rating['sourceKey'])} nao produziu item no ` +
        'presenter. O teste abaixo passaria (ou morreria) pelo motivo errado. ' +
        'Confira attribution.text, best, scoreType e sourceKey da fixture.',
    )
  }
}

/** Uma nota completa e creditada. Cada teste troca so o que precisa. */
function rating(over: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceKey: 'imdb',
    sourceLabel: 'IMDb',
    scoreType: 'audience',
    label: 'IMDb Rating',
    value: 7.9,
    best: 10,
    count: null,
    updatedAt: '2026-08-10T00:00:00.000Z',
    attribution: { text: 'Nota fornecida por IMDb', url: null },
    ...over,
  }
}

const IMDB = rating({})

const ROTTEN_TOMATOES = rating({
  sourceKey: 'rotten_tomatoes',
  sourceLabel: 'Rotten Tomatoes',
  scoreType: 'critics',
  label: 'Tomatometer',
  value: 85,
  best: 100,
  attribution: { text: 'Nota fornecida por Rotten Tomatoes', url: null },
})

const METACRITIC = rating({
  sourceKey: 'metacritic',
  sourceLabel: 'Metacritic',
  scoreType: 'critics',
  label: 'Metascore',
  value: 67,
  best: 100,
  attribution: { text: 'Nota fornecida por Metacritic', url: null },
})

/** Item unico da view, ja com a fixture verificada. */
function onlyItem(input: Record<string, unknown>) {
  assertRatingFixtureUsable(input)
  return buildRatingsView({ ratings: [input] } as never)!.items[0]!
}

describe('sufixo da nota: um caso literal por fonte', () => {
  it('IMDb escreve "/10"', () => {
    const item = onlyItem(IMDB)
    expect(item.valueSuffix).toBe('/10')
    expect(item.scoreLabel).toBe('7,9/10')
  })

  it('Metacritic escreve "/100" — o Metascore E uma nota numa regua de 100', () => {
    const item = onlyItem(METACRITIC)
    expect(item.valueSuffix).toBe('/100')
    expect(item.scoreLabel).toBe('67/100')
  })

  it('Rotten Tomatoes escreve "%" — o Tomatometer e PROPORCAO, nao nota', () => {
    const item = onlyItem(ROTTEN_TOMATOES)
    expect(item.valueSuffix).toBe('%')
    expect(item.scoreLabel).toBe('85%')
    // O defeito exato que estava no ar. Fica nomeado para nunca voltar.
    expect(item.scoreLabel).not.toBe('85/100')
  })

  it('MESMA escala, medidas DIFERENTES: 100 nao decide o sufixo — a fonte decide', () => {
    const rt = onlyItem(ROTTEN_TOMATOES)
    const mc = onlyItem(METACRITIC)

    // Prova que a fixture nao esta enviesada: os dois declaram o mesmo `best`
    // e a mesma natureza (`critics`). Se este par ficar diferente, o teste
    // abaixo deixa de provar o que diz provar.
    expect(rt.best).toBe(100)
    expect(mc.best).toBe(100)
    expect(rt.scoreType).toBe('critics')
    expect(mc.scoreType).toBe('critics')

    expect(rt.valueSuffix).not.toBe(mc.valueSuffix)
  })

  it('escala DIVERGENTE da fonte nao vai ao ar (o sufixo descreveria outra regua)', () => {
    // `imdb` com best 100: o "8,4" foi medido numa regua de 10, e o sufixo da
    // fonte diria "/10" sobre um denominador que a linha afirma ser 100.
    expect(buildRatingsView({ ratings: [rating({ best: 100 })] } as never)).toBeNull()
  })

  it('fonte fora do vocabulario cai no denominador CRU, nunca em "%"', () => {
    // "%" seria afirmar proporcao sobre um dado que nao sabemos medir.
    expect(ratingValueSuffix('fonte_desconhecida', 20)).toBe('/20')
  })
})
