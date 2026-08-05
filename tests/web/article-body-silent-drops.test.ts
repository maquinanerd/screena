/**
 * As duas quedas silenciosas, fechadas.
 *
 * Os dois valores sao LEGAIS no contrato e selecionaveis no CMS, e sumiam da
 * pagina publicada sem erro nenhum:
 *  - `entityCard` com tipo fora de movie/tv — levava junto a NOTA do redator;
 *  - `video` com provider `internal` — sumia mesmo com URL preenchida.
 *
 * Sair do contrato nao era opcao: os dois vivem tambem em `editorialBody`, o
 * contrato de ENTRADA, e estreita-lo moveria o hash que o MNScr declara a cada
 * pedido. Entao ganharam renderer.
 */

import { describe, expect, it } from 'vitest'

import { buildArticleBodyBlocks } from '../../apps/web/src/lib/article-body-presenter.js'

const vazio = { entityCards: new Map(), articles: new Map(), media: new Map(), sources: new Map() }
const render = (raw: unknown, hydration: unknown = vazio): ReturnType<typeof buildArticleBodyBlocks> =>
  buildArticleBodyBlocks([raw], hydration as never)

describe('entityCard sem ficha possivel', () => {
  const bloco = (entityKind: string, note?: string) => ({
    id: 'b1',
    type: 'entityCard',
    entityKind,
    entityId: '42',
    ...(note === undefined ? {} : { note }),
  })

  it('a NOTA sobrevive para os cinco tipos que o site nao ficha', () => {
    for (const kind of ['person', 'season', 'episode', 'character', 'franchise']) {
      const drawn = render(bloco(kind, 'Ela dirigiu os dois primeiros episódios.'))
      expect(drawn, kind).toHaveLength(1)
      expect(drawn[0]?.kind, kind).toBe('entityNote')
      if (drawn[0]?.kind !== 'entityNote') continue
      expect(drawn[0].note, kind).toBe('Ela dirigiu os dois primeiros episódios.')
    }
  })

  it('sem nota e sem ficha, o bloco some — nota inventada seria pior', () => {
    expect(render(bloco('person'))).toEqual([])
  })

  it('NAO finge ser ficha: nao ha card nem link', () => {
    const drawn = render(bloco('person', 'nota'))
    expect(drawn[0]?.kind).toBe('entityNote')
    expect(drawn[0]).not.toHaveProperty('card')
  })

  it('CONTROLE NEGATIVO: filme e serie continuam exigindo hidratacao de verdade', () => {
    // Sem isto, o fallback poderia ter engolido tambem o caminho bom, e toda
    // ficha viraria nota.
    const drawn = render(bloco('movie', 'nota'))
    expect(drawn[0]?.kind).toBe('entityNote')
    // Sem hidratacao no mapa, ate movie cai na nota — o que prova que o
    // fallback depende da HIDRATACAO, nao do tipo.
    expect(drawn).toHaveLength(1)
  })
})

describe('video internal', () => {
  const bloco = (extra: Record<string, unknown>) => ({
    id: 'b1',
    type: 'video',
    provider: 'internal',
    ...extra,
  })

  it('com URL, vira link em vez de sumir', () => {
    const drawn = render(bloco({ url: 'https://cdn.cinerie.com/videos/bastidores.mp4' }))
    expect(drawn).toHaveLength(1)
    expect(drawn[0]?.kind).toBe('video')
    if (drawn[0]?.kind !== 'video') return
    expect(drawn[0].provider).toBe('internal')
    expect(drawn[0].href).toBe('https://cdn.cinerie.com/videos/bastidores.mp4')
  })

  it('sem URL, some — nao ha para onde apontar', () => {
    expect(render(bloco({ title: 'Bastidores' }))).toEqual([])
  })

  it('esquema perigoso NAO vira link', () => {
    expect(render(bloco({ url: 'javascript:alert(1)' }))).toEqual([])
  })

  it('CONTROLE NEGATIVO: youtube continua funcionando como antes', () => {
    const drawn = render({ id: 'b1', type: 'video', provider: 'youtube', externalId: 'dQw4w9WgXcQ' })
    expect(drawn[0]?.kind).toBe('video')
    if (drawn[0]?.kind !== 'video') return
    expect(drawn[0].href).toContain('youtube.com/watch')
  })
})
