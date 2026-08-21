/**
 * cinerie-score-group.test.ts — O GRUPO da fonte e DERIVADO, nunca inventado.
 *
 * ============================================================================
 * A ARMADILHA QUE ESTA SUITE FECHA
 * ============================================================================
 * `CinerieScoreExplanationEntry` — a forma persistida em
 * `cinerie_score_calculations.explanation` — nao carrega `group`. Quem lesse a
 * explicacao para remontar `CountedSource[]` ficava sem o campo, e o consumidor
 * era obrigado a inventar um.
 *
 * Foi o que `apps/web/src/server/entity-hero.ts` fez, com o comentario
 * admitindo: "`audience` e um valor valido do tipo para satisfazer a forma".
 * Ficou anotado como "registrado, nao resolvido".
 *
 * Era inofensivo enquanto ninguem lia o campo. Seria erro de FATO no dia em que
 * alguem exibisse "criticos x publico": Rotten Tomatoes e Metacritic — as duas
 * fontes de CRITICA da formula — apareceriam como publico.
 *
 * ============================================================================
 * POR QUE A CURA E DERIVAR, E NAO PERSISTIR
 * ============================================================================
 * `group` nunca foi propriedade do CALCULO: e propriedade da FONTE, e o mapa
 * (`CRITICS_SOURCES` / `AUDIENCE_SOURCES`) sempre existiu no pacote da formula.
 * Persistir o campo criaria uma segunda copia da verdade, que divergiria no dia
 * em que uma fonte trocasse de grupo. Derivar mantem UMA fonte de verdade.
 */

import { describe, expect, it } from 'vitest'

import { rebuildCountedSources, resolveSourceGroup } from '@screena/cinerie-score'

describe('grupo da fonte do Cinerie Score', () => {
  it('(1) as fontes de CRITICA sao criticas — nunca publico', () => {
    // Este e o caso que a invencao quebrava. Com `group: "audience" as const`,
    // as duas linhas abaixo devolviam "audience" e o teste reprovaria.
    expect(resolveSourceGroup('rotten_tomatoes')).toBe('critics')
    expect(resolveSourceGroup('metacritic')).toBe('critics')
  })

  it('(2) as fontes de PUBLICO sao publico', () => {
    expect(resolveSourceGroup('imdb')).toBe('audience')
    expect(resolveSourceGroup('tmdb')).toBe('audience')
  })

  it('(3) CONTROLE NEGATIVO: fonte fora da formula nao ganha grupo por omissao', () => {
    // `null`, e nao "audience". Chutar um grupo para fonte desconhecida seria
    // repetir o defeito num lugar novo — que e como ele chegou ate aqui.
    expect(resolveSourceGroup('letterboxd')).toBeNull()
    expect(resolveSourceGroup('filmaffinity')).toBeNull()
    expect(resolveSourceGroup('')).toBeNull()
    expect(resolveSourceGroup('fonte-que-nao-existe')).toBeNull()
  })

  it('(4) CONTROLE NEGATIVO: a funcao nao devolve o MESMO grupo para tudo', () => {
    // Sem este caso, um `resolveSourceGroup` que devolvesse sempre "critics"
    // passaria em (1) e falharia so em (2) — e um que devolvesse sempre
    // "audience" (a invencao original) passaria em (2). Medir a DIVERSIDADE do
    // resultado e o que reprova as duas degeneracoes de uma vez.
    const grupos = new Set(
      ['imdb', 'tmdb', 'rotten_tomatoes', 'metacritic'].map(resolveSourceGroup),
    )
    expect(grupos).toEqual(new Set(['critics', 'audience']))
  })

  it('(5) a REMONTAGEM da explicacao persistida deriva o grupo de cada fonte', () => {
    // ESTE e o caso que substituiu um guard textual que nao guardava nada.
    //
    // A primeira versao lia `entity-hero.ts` e procurava a linha exata do
    // defeito. Verificado por mutacao, o guard PASSOU com o defeito de volta: a
    // mutacao escreveu `const group = "audience"` e o guard procurava
    // `group: "audience"`. Mesma falha, outra grafia, guard cego.
    //
    // Guard de FORMA so pega a grafia que ja se conhece. Este chama a funcao
    // que `entity-hero.ts` chama, com a forma EXATA que
    // `CinerieScoreExplanationEntry` persiste — sem `group`, que e o ponto.
    const persistido = [
      { source: 'rotten_tomatoes', normalized: 92, weight: 1 },
      { source: 'metacritic', normalized: 78, weight: 1 },
      { source: 'imdb', normalized: 84, weight: 3 },
    ]

    const remontado = rebuildCountedSources(persistido)

    expect(remontado).toHaveLength(3)
    expect(remontado.map((f) => [f.source, f.group])).toEqual([
      ['rotten_tomatoes', 'critics'],
      ['metacritic', 'critics'],
      ['imdb', 'audience'],
    ])
    // Peso e valor atravessam intactos: a remontagem deriva o grupo, nao
    // reinterpreta o calculo.
    expect(remontado.map((f) => f.weight)).toEqual([1, 1, 3])
    expect(remontado.map((f) => f.normalized)).toEqual([92, 78, 84])
  })

  it('(6) CONTROLE NEGATIVO: a remontagem DESCARTA fonte sem grupo conhecido', () => {
    // "Vira publico" seria a invencao de volta, so que mais fundo.
    const remontado = rebuildCountedSources([
      { source: 'imdb', normalized: 84, weight: 3 },
      { source: 'letterboxd', normalized: 80, weight: 1 },
    ])
    expect(remontado.map((f) => f.source)).toEqual(['imdb'])
  })
})
