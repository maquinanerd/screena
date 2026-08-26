/**
 * resolve-items.test.ts — UM TITULO REPETIDO DERRUBAVA A CAPTURA INTEIRA.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUCAO EM 26/08/2026
 * ============================================================================
 * `catalog discovery --list=trending --entity=movie --max-pages=5 --apply`
 * abortou com:
 *
 *     PrismaClientKnownRequestError
 *     Invalid `prisma.discoverySnapshotItem.createMany()` invocation:
 *     Unique constraint failed on the fields: (`snapshot_id`,`entity_id`)
 *
 * A lista de descoberta do TMDB e paginada e REORDENA entre as requisicoes: o
 * mesmo titulo cai na pagina 2 e de novo na 3. `createMany` roda DENTRO da
 * transacao do snapshot — entao uma linha repetida nao perde um item, perde os
 * 100. O operador ve "snapshot nao criado" e nada que aponte para o duplicado.
 *
 * ============================================================================
 * POR QUE PASSOU DESPERCEBIDO ATE AGORA
 * ============================================================================
 * Com `maxPages: 1` nao ha segunda pagina, logo nao ha como repetir — e 1 e
 * exatamente o que a fila `trending` do agendador manda. O defeito so acorda no
 * caminho que ninguem exercitava: `bootstrap` (que NAO passa `maxPages`, caindo
 * no default 5) e qualquer captura manual mais larga. Ou seja: o unico caminho
 * capaz de encher o trilho era tambem o unico capaz de morrer.
 */

import { describe, expect, it } from 'vitest'

import { resolveSnapshotItems, type DiscoveryItemPlan } from '../index.js'

/** Atalho: constroi itens de plano na ordem dada. */
function plano(...tmdbIds: number[]): DiscoveryItemPlan[] {
  return tmdbIds.map((entityTmdbId, position) => ({
    entityTmdbId,
    position,
    providerScore: 100 - position,
  }))
}

const CATALOGO = new Map<number, bigint>([
  [603, 1n],
  [604, 2n],
  [605, 3n],
])

describe('resolveSnapshotItems', () => {
  it('(1) resolve tmdb_id -> id interno preservando a ordem', () => {
    expect(resolveSnapshotItems(plano(603, 604), CATALOGO)).toEqual([
      { entityId: 1n, position: 0, providerScore: 100 },
      { entityId: 2n, position: 1, providerScore: 99 },
    ])
  })

  it('(2) o CASO DE PRODUCAO: titulo repetido entre paginas nao duplica a linha', () => {
    // 603 aparece na posicao 0 e de novo na 2 — foi assim que a transacao caiu.
    const items = resolveSnapshotItems(plano(603, 604, 603), CATALOGO)

    expect(items).toHaveLength(2)
    expect(items.map((i) => i.entityId)).toEqual([1n, 2n])
  })

  it('(3) fica a PRIMEIRA ocorrencia: posicao menor e o sinal mais forte', () => {
    // Se ficasse a ultima, um titulo no topo do trending seria rebaixado para a
    // cauda so por ter reaparecido na pagina 5.
    const items = resolveSnapshotItems(plano(603, 604, 603), CATALOGO)

    expect(items[0]).toEqual({ entityId: 1n, position: 0, providerScore: 100 })
  })

  it('(4) dois tmdb_id distintos que resolvem para a MESMA entidade tambem colapsam', () => {
    // Duplicata mergeada no catalogo: dois ids externos, uma entidade. O unique
    // e sobre `entity_id`, nao sobre `tmdb_id` — deduplicar por tmdbId nao
    // salvaria este caso.
    const mergeado = new Map<number, bigint>([
      [603, 1n],
      [9999, 1n],
    ])

    expect(resolveSnapshotItems(plano(603, 9999), mergeado)).toEqual([
      { entityId: 1n, position: 0, providerScore: 100 },
    ])
  })

  it('(5) as posicoes ficam DENSAS depois do descarte', () => {
    // Ha um segundo unique, (snapshot_id, position). Buraco na sequencia nao
    // quebra o insert, mas quebra a leitura ordenada do render.
    const items = resolveSnapshotItems(plano(603, 777, 603, 604, 888, 605), CATALOGO)

    expect(items.map((i) => i.position)).toEqual([0, 1, 2])
  })

  it('(6) entidade NAO promovida continua sendo ignorada (snapshot nunca cria entidade)', () => {
    // 777 nao esta no catalogo. O snapshot nao pode apontar para ela: viraria
    // link morto no render.
    expect(resolveSnapshotItems(plano(777, 888), CATALOGO)).toEqual([])
  })

  it('(7) CONTROLE POSITIVO: sem repetidos, nada e descartado', () => {
    // Sem este caso, um `return []` passaria em (2), (4) e (6) — o zero seria
    // vacuo, e o conserto teria trocado um defeito por outro pior.
    expect(resolveSnapshotItems(plano(603, 604, 605), CATALOGO)).toHaveLength(3)
  })
})
