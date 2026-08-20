/**
 * formula-2026-08-v1.test.ts — A formula aprovada, com os numeros conferidos A MAO.
 *
 * Todo valor esperado aqui foi calculado fora do codigo e escrito por extenso no
 * comentario. Isso e o ponto: um teste que chamasse `composeScore` para produzir
 * o esperado provaria apenas que a funcao e deterministica — nunca que ela
 * calcula o que o proprietario decidiu.
 */

import { describe, expect, it } from 'vitest'

import {
  composeScore,
  MINIMUM_COUNTED_SOURCES,
  normalizeRating,
  selectCountedSources,
  shouldDisplayCinerieScore,
  TMDB_MINIMUM_VOTE_COUNT,
} from '../formula-2026-08-v1.js'
import type { CinerieScoreRatingInput } from '../types.js'

/** Uma nota de entrada. `licenseDecisionId` nunca vazio (o engine exige). */
function nota(
  source: string,
  value: number,
  best: number,
  over: Partial<CinerieScoreRatingInput> = {},
): CinerieScoreRatingInput {
  return {
    source,
    type: 'critics',
    value,
    best,
    count: null,
    licenseDecisionId: 'decision-1',
    ...over,
  }
}

const imdb = (v: number) => nota('imdb', v, 10, { type: 'audience' })
const tmdb = (v: number, count: number | null) => nota('tmdb', v, 10, { type: 'audience', count })
const rt = (v: number) => nota('rotten_tomatoes', v, 100)
const mc = (v: number) => nota('metacritic', v, 100)

describe('os quatro casos de cobertura, com o numero conferido a mao', () => {
  it('TRES fontes: IMDb 8,4 + Rotten 92 + Metacritic 78 => 84', () => {
    // CRITICA = (92 + 78) / 2                = 85
    // PUBLICO = 8,4 x 10 (peso 3, sozinho)   = 84
    // SCORE   = 0,5 x 85 + 0,5 x 84          = 84,5  -> arredonda 85
    //
    // Math.round(84.5) === 85 (arredonda para cima no meio exato).
    //
    // `toBeCloseTo` nos INTERMEDIARIOS, `toBe` no resultado: 8,4 nao tem
    // representacao binaria exata, e `8.4 / 10 * 100` da 84.00000000000001. O
    // erro morre no arredondamento final — que e o unico numero que vai a tela.
    const r = composeScore([imdb(8.4), rt(92), mc(78)])
    expect(r?.critics).toBe(85)
    expect(r?.audience).toBeCloseTo(84, 10)
    expect(r?.value).toBe(85)
    expect(r?.counted).toHaveLength(3)
  })

  it('QUATRO fontes: o peso 3 do IMDb sobre 1 do TMDB muda o numero', () => {
    // PUBLICO = (8,0x10 x 3 + 6,0x10 x 1) / 4 = (240 + 60) / 4 = 75
    //   (com pesos IGUAIS daria (80 + 60) / 2 = 70 — a diferenca e o teste)
    // CRITICA = (90 + 70) / 2                 = 80
    // SCORE   = 0,5 x 80 + 0,5 x 75           = 77,5 -> 78
    const r = composeScore([imdb(8.0), tmdb(6.0, 500), rt(90), mc(70)])
    expect(r?.audience).toBe(75)
    expect(r?.critics).toBe(80)
    expect(r?.value).toBe(78)
  })

  it('DUAS fontes, so CRITICA: Rotten 92 + Metacritic 78 => 85', () => {
    // So um grupo existe -> o SCORE e esse grupo, sem o 50/50.
    // CRITICA = (92 + 78) / 2 = 85
    const r = composeScore([rt(92), mc(78)])
    expect(r?.audience).toBeNull()
    expect(r?.value).toBe(85)
    expect(r?.counted).toHaveLength(2)
  })

  it('UMA fonte: IMDb 8,4 => calcula 84, mas nao pode exibir', () => {
    // O calculo acontece (e registravel no historico); a EXIBICAO e que cai.
    const r = composeScore([imdb(8.4)])
    expect(r?.value).toBe(84)
    expect(r?.counted).toHaveLength(1)
    expect(shouldDisplayCinerieScore(r!.counted)).toBe(false)
  })

  it('ZERO fontes: nao ha numero nenhum', () => {
    expect(composeScore([])).toBeNull()
    expect(composeScore([nota('letterboxd', 4.2, 5)])).toBeNull()
  })
})

describe('a regra de exibicao — nos DOIS sentidos', () => {
  it('POSITIVO: com 2 fontes, exibe', () => {
    const r = composeScore([imdb(8.4), rt(92)])
    expect(r?.counted).toHaveLength(2)
    expect(shouldDisplayCinerieScore(r!.counted)).toBe(true)
  })

  it('NEGATIVO: com 1 fonte, NAO exibe — nem com nota alta', () => {
    // "Com uma fonte so nao existe composicao — seria lavar o numero de um
    // terceiro e chamar de nosso." Vale para 9,8 tanto quanto para 2,0.
    for (const v of [2.0, 5.0, 9.8]) {
      const r = composeScore([imdb(v)])
      expect(r?.counted, `valor ${v}`).toHaveLength(1)
      expect(shouldDisplayCinerieScore(r!.counted), `valor ${v}`).toBe(false)
    }
  })

  it('NEGATIVO: a MESMA fonte duas vezes nao satisfaz o piso', () => {
    // Sem a deduplicacao por fonte, dois registros de IMDb passariam o piso com
    // UMA fonte — exatamente o que o piso existe para impedir.
    const r = composeScore([imdb(8.4), imdb(8.6)])
    expect(r?.counted).toHaveLength(1)
    expect(shouldDisplayCinerieScore(r!.counted)).toBe(false)
  })

  it('o piso e 2, declarado — nao um literal solto no meio do codigo', () => {
    expect(MINIMUM_COUNTED_SOURCES).toBe(2)
  })
})

describe('o piso de votos do TMDB', () => {
  /**
   * CONTAGENS LITERAIS, e a primeira versao deste bloco prova por que.
   *
   * Ela usava `TMDB_MINIMUM_VOTE_COUNT - 1` e `TMDB_MINIMUM_VOTE_COUNT`. O
   * controle negativo (baixar o piso de 50 para 0 no codigo de verdade) PASSOU:
   * com o piso em 0, o "abaixo" virou -1 voto, que continua sendo recusado por
   * ser negativo. O teste media a si mesmo — mudava junto com o que deveria
   * vigiar, e por isso nao vigiava nada.
   *
   * Agora o valor 50 e afirmado por extenso e os limites sao numeros literais.
   */
  it('o piso e 50, declarado — e afirmado aqui por extenso', () => {
    expect(TMDB_MINIMUM_VOTE_COUNT).toBe(50)
  })

  it('NEGATIVO: TMDB com 49 votos NAO entra na conta', () => {
    // Com o TMDB fora, sobra so o IMDb -> 1 fonte -> nao exibe.
    const r = composeScore([imdb(8.0), tmdb(2.0, 49)])
    expect(r?.counted.map((f) => f.source)).toEqual(['imdb'])
    expect(r?.value).toBe(80)
    expect(shouldDisplayCinerieScore(r!.counted)).toBe(false)
  })

  it('NEGATIVO: TMDB com 1 voto tambem nao — ruido nao vira nota', () => {
    const r = composeScore([imdb(8.0), tmdb(9.9, 1)])
    expect(r?.counted.map((f) => f.source)).toEqual(['imdb'])
  })

  it('POSITIVO: TMDB com 50 votos ENTRA (o limite e inclusivo)', () => {
    // PUBLICO = (8,0x10 x 3 + 2,0x10 x 1) / 4 = (240 + 20) / 4 = 65
    const r = composeScore([imdb(8.0), tmdb(2.0, 50)])
    expect(r?.counted.map((f) => f.source)).toEqual(['imdb', 'tmdb'])
    expect(r?.value).toBe(65)
  })

  it('NEGATIVO: TMDB sem contagem NAO entra — ali a contagem existe de verdade', () => {
    // `vote_count_tmdb` esta na propria linha do titulo. Ausencia e anomalia.
    expect(normalizeRating(tmdb(7.0, null))).toBeNull()
  })

  it('IMDb sem contagem CONTA — a OMDb nao publica contagem por fonte', () => {
    // Se `null` no IMDb fosse tratado como "sem volume", a fonte de MAIOR
    // cobertura (88%) sairia de todo titulo e o piso de duas fontes derrubaria
    // o Score de quase tudo. O teto nao foi inventado; a fonte conta.
    expect(normalizeRating(imdb(8.4))?.normalized).toBeCloseTo(84, 10)
  })
})

describe('o que NAO entra na conta', () => {
  it('NEGATIVO: `audience` do Rotten Tomatoes fica de fora', () => {
    // Vem do RapidAPI, que esta revogado. So a nota de CRITICA do Rotten entra.
    expect(normalizeRating(nota('rotten_tomatoes', 80, 100, { type: 'audience' }))).toBeNull()
    expect(normalizeRating(nota('rotten_tomatoes', 80, 100, { type: 'critics' }))).not.toBeNull()
  })

  it('NEGATIVO: escala errada e recusada — reescalar seria a transformacao proibida', () => {
    // IMDb declarado em escala 100 e o teste (3) da governanca de ratings.
    // Aceitar aqui seria converter entre escalas de fontes (invariante 1).
    expect(normalizeRating(nota('imdb', 84, 100, { type: 'audience' }))).toBeNull()
    expect(normalizeRating(nota('metacritic', 7.8, 10))).toBeNull()
  })

  it('NEGATIVO: fonte fora das quatro decididas nao entra', () => {
    for (const s of ['letterboxd', 'filmaffinity', 'cinerie', 'qualquer_coisa']) {
      expect(normalizeRating(nota(s, 5, 10)), s).toBeNull()
    }
  })

  it('NEGATIVO: valor invalido ou acima da escala e recusado', () => {
    expect(normalizeRating(nota('metacritic', 101, 100))).toBeNull()
    expect(normalizeRating(nota('metacritic', -1, 100))).toBeNull()
    expect(normalizeRating(nota('metacritic', Number.NaN, 100))).toBeNull()
    expect(normalizeRating(nota('metacritic', Number.POSITIVE_INFINITY, 100))).toBeNull()
  })
})

describe('a explicacao NOMEIA as fontes — o numero nunca e afirmacao sem lastro', () => {
  it('carrega fonte, valor normalizado e peso de cada uma', () => {
    const counted = selectCountedSources([imdb(8.0), tmdb(6.0, 500), rt(90)])
    expect(counted).toEqual([
      { source: 'imdb', normalized: 80, group: 'audience', weight: 3 },
      { source: 'tmdb', normalized: 60, group: 'audience', weight: 1 },
      { source: 'rotten_tomatoes', normalized: 90, group: 'critics', weight: 1 },
    ])
  })
})
