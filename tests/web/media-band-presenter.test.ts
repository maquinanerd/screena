/**
 * media-band-presenter.test.ts — A banda de mídia, decidida sem banco.
 *
 * Os três cartões do canônico voltaram porque as rotas de galeria passaram a
 * existir. O que esta suíte trava é o CRITÉRIO: cartão só entra com destino E
 * com conteúdo, e a contagem exibida é a real ou não existe.
 */

import { describe, expect, it } from 'vitest'

import { buildMediaBand, type MediaBandInput } from '../../apps/web/src/lib/media-band-presenter'

function entrada(over: Partial<MediaBandInput> = {}): MediaBandInput {
  return {
    imagesPath: '/pt/filmes/x/imagens/',
    videosPath: '/pt/filmes/x/videos/',
    newsAnchor: '#movie-news-title',
    newsCount: 3,
    imageCount: 184,
    videoCount: 9,
    backdropUrl: 'https://image.tmdb.org/t/p/w780/b.jpg',
    hasTrailer: true,
    ...over,
  }
}

describe('banda de mídia', () => {
  it('(1) com tudo, os TRÊS cartões do canônico, na ordem dele', () => {
    const banda = buildMediaBand(entrada())
    expect(banda.cards.map((c) => [c.key, c.label, c.href])).toEqual([
      ['imagens', 'Imagens e Pôsteres', '/pt/filmes/x/imagens/'],
      ['noticias', 'Notícias e Eventos', '#movie-news-title'],
      ['videos', 'Trailers e Teasers', '/pt/filmes/x/videos/'],
    ])
  })

  it('(2) a contagem é REAL, e no formato do canônico', () => {
    expect(buildMediaBand(entrada()).countsLabel).toBe('9 vídeos · 184 fotos')
  })

  it('(3) CONTROLE NEGATIVO: galeria VAZIA não ganha cartão', () => {
    // Um cartão de galeria vazia gastaria um clique para dizer "ainda não há
    // imagens" — pior que a ausência dele.
    const semImagem = buildMediaBand(entrada({ imageCount: 0 }))
    expect(semImagem.cards.map((c) => c.key)).toEqual(['noticias', 'videos'])

    const semNada = buildMediaBand(entrada({ imageCount: 0, videoCount: 0, newsCount: 0 }))
    expect(semNada.cards).toEqual([])
  })

  it('(4) rota inválida (slug que não produz caminho) também não vira cartão', () => {
    const semRota = buildMediaBand(entrada({ imagesPath: null, videosPath: null }))
    expect(semRota.cards.map((c) => c.key)).toEqual(['noticias'])
  })

  it('(5) a contagem some quando NÃO há o que contar, e nunca vira "0"', () => {
    // "0 vídeos · 184 fotos" anunciaria uma ausência que ninguém perguntou.
    expect(buildMediaBand(entrada({ videoCount: 0 })).countsLabel).toBe('184 fotos')
    expect(buildMediaBand(entrada({ imageCount: 0 })).countsLabel).toBe('9 vídeos')
    expect(buildMediaBand(entrada({ imageCount: 0, videoCount: 0 })).countsLabel).toBeNull()
  })

  it('(6) singular e plural, sem "1 fotos"', () => {
    expect(buildMediaBand(entrada({ imageCount: 1, videoCount: 1 })).countsLabel).toBe(
      '1 vídeo · 1 foto',
    )
  })

  it('(7) a legenda do trailer NUNCA carrega duração', () => {
    // O canônico pede `02:14 · Trailer`. O TMDB NÃO entrega duração — o campo
    // `size` de `/videos` é a RESOLUÇÃO. Inventar o número a partir dela faria
    // um vídeo em 1080p aparecer como "18:00". A legenda sai só como `Trailer`.
    const banda = buildMediaBand(entrada())
    expect(banda.trailerCaption).toBe('Trailer')
    expect(banda.trailerCaption).not.toMatch(/\d{2}:\d{2}/)
    expect(buildMediaBand(entrada({ hasTrailer: false })).trailerCaption).toBeNull()
  })

  it('(8) CONTROLE NEGATIVO: a contagem NÃO é inventada a partir dos cartões', () => {
    // Se `countsLabel` derivasse de `cards.length` em vez das contagens reais,
    // este caso — 0 notícias, mas 184 fotos e 9 vídeos — daria outro número.
    const banda = buildMediaBand(entrada({ newsCount: 0 }))
    expect(banda.cards).toHaveLength(2)
    expect(banda.countsLabel).toBe('9 vídeos · 184 fotos')
  })
})
