/**
 * O produtor decide TODOS os tipos que a politica sabe decidir.
 *
 * O DEFEITO QUE ESTE TESTE FECHA
 * ------------------------------
 * `decideCatalogIndexability` sempre soube decidir `season` e `episode`, e
 * `page_indexability_decisions` sempre aceitou os dois no enum. Mas
 * `DECIDABLE_ENTITY_TYPES` listava so `movie | tv | person`, e o produtor nunca
 * emitia uma linha para temporada nem para episodio.
 *
 * O efeito era silencioso e do pior tipo: a clausula do sitemap e
 * `NOT EXISTS (... decision <> 'index')`. AUSENCIA de linha NAO exclui — ela
 * INCLUI. Os ~30.400 episodios e ~840 temporadas (de 53.054 URLs medidas em
 * producao) entravam no sitemap justamente por nao terem decisao nenhuma, e
 * nada no codigo dizia isso. Uma cobertura parcial num gate fail-open nao gera
 * erro; gera indice inflado.
 *
 * O `Record` abaixo e a metade que o compilador guarda: acrescentar um tipo em
 * `CatalogDecisionEntityType` sem cobri-lo aqui nao compila. A assercao e a
 * metade que o teste guarda: cobrir no `Record` e esquecer da lista do produtor
 * falha em vermelho.
 */

import { describe, expect, it } from 'vitest'
import type { CatalogDecisionEntityType } from '@screena/seo'

import { DECIDABLE_ENTITY_TYPES } from './indexability-writer.js'

/**
 * Todo tipo que a politica decide. `Record` (e nao array) DE PROPOSITO: o
 * compilador exige a chave nova quando a uniao cresce.
 */
const EVERY_DECIDABLE_TYPE: Record<CatalogDecisionEntityType, true> = {
  movie: true,
  tv: true,
  season: true,
  episode: true,
  person: true,
}

describe('DECIDABLE_ENTITY_TYPES — cobertura do produtor', () => {
  it('(1) cobre TODO tipo que a politica sabe decidir', () => {
    const cobertos = new Set<string>(DECIDABLE_ENTITY_TYPES)
    const faltando = Object.keys(EVERY_DECIDABLE_TYPE).filter((t) => !cobertos.has(t))
    expect(
      faltando,
      'tipo sem decisao entra no sitemap por AUSENCIA de linha (NOT EXISTS e fail-open)',
    ).toEqual([])
  })

  it('(2) temporada e episodio estao na lista (as ~30.400 URLs)', () => {
    expect(DECIDABLE_ENTITY_TYPES).toContain('season')
    expect(DECIDABLE_ENTITY_TYPES).toContain('episode')
  })

  it('(3) sem tipo repetido: a contagem do censo dobraria', () => {
    expect(new Set(DECIDABLE_ENTITY_TYPES).size).toBe(DECIDABLE_ENTITY_TYPES.length)
  })
})
