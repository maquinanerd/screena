/**
 * O bloco `list`, do contrato ate o que o site desenha.
 *
 * A REGRA INEGOCIAVEL desta entrega e "bloco no contrato ⟺ editor no CMS ⟺
 * renderer no apps/web". Este arquivo cobre a ponta que costuma faltar — e que
 * ja falhou quatro vezes neste repositorio, sempre do mesmo jeito: o valor e
 * legal no contrato, o CMS deixa escolher, e ele SOME da pagina publicada sem
 * erro nenhum (`entityCard` fora de movie/tv, `video` com provider `internal`,
 * `schemaTypeRecommendation` fora de NewsArticle/Article).
 *
 * Por isso o teste nao para no contrato: ele exige que o presenter devolva um
 * bloco desenhavel, com `ordered` preservado e itens na ordem.
 */

import { describe, expect, it } from 'vitest'

import { buildArticleBodyBlocks } from '../../apps/web/src/lib/article-body-presenter.js'
import { listBlock, publishedEditorialBlock } from '../../packages/editorial-contracts/src/blocks.js'

const hydration = { entityCards: new Map(), articles: new Map(), media: new Map(), sources: new Map() }

function render(raw: unknown): ReturnType<typeof buildArticleBodyBlocks> {
  return buildArticleBodyBlocks([raw], hydration as never)
}

describe('bloco list: contrato', () => {
  it('aceita lista com marcador e lista numerada', () => {
    for (const ordered of [false, true]) {
      const parsed = listBlock.safeParse({
        id: 'b1',
        type: 'list',
        ordered,
        items: ['primeiro', 'segundo'],
      })
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    }
  })

  it('recusa lista sem item — `<ul>` vazia nao e conteudo', () => {
    expect(listBlock.safeParse({ id: 'b1', type: 'list', ordered: false, items: [] }).success).toBe(
      false,
    )
  })

  it('entra na uniao do corpo PUBLICADO', () => {
    const parsed = publishedEditorialBlock.safeParse({
      id: 'b1',
      type: 'list',
      ordered: true,
      items: ['um'],
    })
    expect(parsed.success).toBe(true)
  })
})

describe('bloco list: o renderer DESENHA', () => {
  it('devolve um bloco desenhavel, com ordered e itens na ordem', () => {
    const drawn = render({ id: 'b1', type: 'list', ordered: true, items: ['um', 'dois', 'tres'] })
    expect(drawn).toHaveLength(1)
    const block = drawn[0]
    expect(block?.kind).toBe('list')
    if (block?.kind !== 'list') return
    expect(block.ordered).toBe(true)
    expect(block.items).toEqual(['um', 'dois', 'tres'])
  })

  it('lista com marcador chega como ordered=false, nao como ausencia', () => {
    const drawn = render({ id: 'b1', type: 'list', ordered: false, items: ['um'] })
    const block = drawn[0]
    if (block?.kind !== 'list') throw new Error('bloco nao foi desenhado')
    expect(block.ordered).toBe(false)
  })

  it('FALLBACK por item: um item vazio nao derruba a lista inteira', () => {
    const drawn = render({ id: 'b1', type: 'list', ordered: false, items: ['um', '   ', 'tres'] })
    const block = drawn[0]
    if (block?.kind !== 'list') throw new Error('bloco nao foi desenhado')
    expect(block.items).toEqual(['um', 'tres'])
  })

  it('aceita o formato do CMS (`{ text }` por linha), nao so string', () => {
    // A projecao entrega string; um caminho que leia o array do Payload direto
    // entregaria objetos. Aceitar os dois evita que a lista suma por causa da
    // forma do dado.
    const drawn = render({
      id: 'b1',
      type: 'list',
      ordered: false,
      items: [{ text: 'um' }, { text: 'dois' }],
    })
    const block = drawn[0]
    if (block?.kind !== 'list') throw new Error('bloco nao foi desenhado')
    expect(block.items).toEqual(['um', 'dois'])
  })

  it('CONTROLE NEGATIVO: lista sem item algum SOME, em vez de virar lista vazia', () => {
    // Sem este caso, um presenter que devolvesse `{ items: [] }` passaria nos
    // testes acima e o site desenharia uma `<ul>` vazia.
    expect(render({ id: 'b1', type: 'list', ordered: false, items: ['  ', ''] })).toEqual([])
  })

  it('CONTROLE NEGATIVO: o detector reconhece um tipo que NAO existe', () => {
    // Prova que `render` realmente descarta desconhecido — sem isso, os casos
    // acima poderiam estar passando por acidente.
    expect(render({ id: 'b1', type: 'tipo_inexistente', items: ['um'] })).toEqual([])
  })
})
