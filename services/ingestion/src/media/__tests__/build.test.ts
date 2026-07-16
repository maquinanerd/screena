/**
 * Testes dos construtores PUROS do bloco de midia (Backend A, secao 8).
 *
 * Cobre a invariante 6 (display_allowed=false nunca vaza) e a invariante 8
 * (embed so para site conhecido; nunca adivinhado).
 */

import { describe, expect, it } from 'vitest'
import {
  buildEmbedUrl,
  buildImageUrl,
  buildMediaPayload,
  buildThumbnailUrl,
  coverageRatio,
  mapVideoType,
  type MediaImageRow,
  type MediaVideoRow,
} from '../build.js'

function image(overrides: Partial<MediaImageRow> = {}): MediaImageRow {
  return {
    id: '1',
    imageType: 'poster',
    filePath: '/poster.jpg',
    languageCode: 'pt',
    width: 500,
    height: 750,
    aspectRatio: 0.667,
    voteAverage: 5,
    displayAllowed: true,
    ...overrides,
  }
}

function video(overrides: Partial<MediaVideoRow> = {}): MediaVideoRow {
  return {
    id: '1',
    tmdbVideoId: 'abc',
    site: 'YouTube',
    videoKey: 'KEY1',
    name: 'Trailer oficial',
    videoType: 'Trailer',
    official: true,
    languageCode: 'pt',
    publishedAt: null,
    displayAllowed: true,
    ...overrides,
  }
}

describe('buildImageUrl', () => {
  it('concatena base + size + filePath', () => {
    expect(buildImageUrl('/abc.jpg', 'w780')).toBe('https://image.tmdb.org/t/p/w780/abc.jpg')
  })

  it('usa w500 quando o size e omitido', () => {
    expect(buildImageUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg')
  })
})

describe('mapVideoType', () => {
  it('mapeia os tipos conhecidos sem depender de caixa', () => {
    expect(mapVideoType('Trailer')).toBe('trailer')
    expect(mapVideoType('TEASER')).toBe('teaser')
    expect(mapVideoType('clip')).toBe('clip')
    expect(mapVideoType(' Featurette ')).toBe('featurette')
  })

  it('desconhecido e null viram "other" (nunca chuta)', () => {
    expect(mapVideoType('Behind the Scenes')).toBe('other')
    expect(mapVideoType('Bloopers')).toBe('other')
    expect(mapVideoType(null)).toBe('other')
  })
})

describe('buildEmbedUrl / buildThumbnailUrl', () => {
  it('monta embed de YouTube e Vimeo', () => {
    expect(buildEmbedUrl('YouTube', 'KEY1')).toBe('https://www.youtube.com/embed/KEY1')
    expect(buildEmbedUrl('vimeo', '12345')).toBe('https://player.vimeo.com/video/12345')
  })

  it('site desconhecido NUNCA vira embed (invariante 8)', () => {
    expect(buildEmbedUrl('SomeRandomHost', 'KEY1')).toBeNull()
    expect(buildEmbedUrl('torrentsite', 'KEY1')).toBeNull()
    expect(buildEmbedUrl('', 'KEY1')).toBeNull()
  })

  it('thumbnail so para YouTube', () => {
    expect(buildThumbnailUrl('YouTube', 'KEY1')).toBe(
      'https://img.youtube.com/vi/KEY1/hqdefault.jpg',
    )
    expect(buildThumbnailUrl('Vimeo', '12345')).toBeNull()
  })
})

describe('buildMediaPayload — invariante 6', () => {
  it('descarta imagens com displayAllowed=false', () => {
    const payload = buildMediaPayload({
      images: [
        image({ id: '1', filePath: '/liberada.jpg', displayAllowed: true }),
        image({ id: '2', filePath: '/bloqueada.jpg', displayAllowed: false, voteAverage: 10 }),
      ],
      videos: [],
      alt: 'Matrix',
    })
    expect(payload.images).toHaveLength(1)
    expect(payload.images[0]?.id).toBe('1')
    // A bloqueada tinha o MAIOR voteAverage e mesmo assim nao pode virar poster.
    expect(payload.poster?.id).toBe('1')
    expect(JSON.stringify(payload)).not.toContain('bloqueada')
  })

  it('descarta videos com displayAllowed=false', () => {
    const payload = buildMediaPayload({
      images: [],
      videos: [
        video({ id: '1', videoKey: 'OK', displayAllowed: true }),
        video({ id: '2', videoKey: 'BLOCKED', displayAllowed: false }),
      ],
      alt: 'Matrix',
    })
    expect(payload.videos).toHaveLength(1)
    expect(payload.videos[0]?.key).toBe('OK')
    expect(JSON.stringify(payload)).not.toContain('BLOCKED')
  })

  it('todo asset exposto carrega displayAllowed=true', () => {
    const payload = buildMediaPayload({
      images: [image({ id: '1' }), image({ id: '2', imageType: 'backdrop' })],
      videos: [],
      alt: 'Matrix',
    })
    expect(payload.images.every((a) => a.displayAllowed)).toBe(true)
  })
})

describe('buildMediaPayload — poster/backdrop', () => {
  it('escolhe o poster de maior voteAverage', () => {
    const payload = buildMediaPayload({
      images: [
        image({ id: '1', voteAverage: 3 }),
        image({ id: '2', voteAverage: 9 }),
        image({ id: '3', voteAverage: 7 }),
      ],
      videos: [],
      alt: 'Matrix',
    })
    expect(payload.poster?.id).toBe('2')
  })

  it('escolhe o backdrop de maior voteAverage, independente dos posters', () => {
    const payload = buildMediaPayload({
      images: [
        image({ id: '1', imageType: 'poster', voteAverage: 9 }),
        image({ id: '2', imageType: 'backdrop', voteAverage: 4 }),
        image({ id: '3', imageType: 'backdrop', voteAverage: 8 }),
      ],
      videos: [],
      alt: 'Matrix',
    })
    expect(payload.poster?.id).toBe('1')
    expect(payload.backdrop?.id).toBe('3')
  })

  it('voteAverage null fica por ultimo', () => {
    const payload = buildMediaPayload({
      images: [
        image({ id: '1', voteAverage: null }),
        image({ id: '2', voteAverage: 0.5 }),
        image({ id: '3', voteAverage: null }),
      ],
      videos: [],
      alt: 'Matrix',
    })
    expect(payload.poster?.id).toBe('2')
  })

  it('sem candidatos do tipo => null', () => {
    const payload = buildMediaPayload({
      images: [image({ id: '1', imageType: 'logo' })],
      videos: [],
      alt: 'Matrix',
    })
    expect(payload.poster).toBeNull()
    expect(payload.backdrop).toBeNull()
    expect(payload.images).toHaveLength(1)
  })

  it('aplica os tamanhos por tipo (poster w500 / backdrop w1280 default)', () => {
    const payload = buildMediaPayload({
      images: [
        image({ id: '1', imageType: 'poster', filePath: '/p.jpg' }),
        image({ id: '2', imageType: 'backdrop', filePath: '/b.jpg' }),
      ],
      videos: [],
      alt: 'Matrix',
    })
    expect(payload.poster?.url).toBe('https://image.tmdb.org/t/p/w500/p.jpg')
    expect(payload.backdrop?.url).toBe('https://image.tmdb.org/t/p/w1280/b.jpg')
  })

  it('respeita posterSize/backdropSize custom', () => {
    const payload = buildMediaPayload({
      images: [
        image({ id: '1', imageType: 'poster', filePath: '/p.jpg' }),
        image({ id: '2', imageType: 'backdrop', filePath: '/b.jpg' }),
      ],
      videos: [],
      alt: 'Matrix',
      posterSize: 'original',
      backdropSize: 'w300',
    })
    expect(payload.poster?.url).toBe('https://image.tmdb.org/t/p/original/p.jpg')
    expect(payload.backdrop?.url).toBe('https://image.tmdb.org/t/p/w300/b.jpg')
  })

  it('propaga o alt para todas as imagens', () => {
    const payload = buildMediaPayload({
      images: [image({ id: '1' }), image({ id: '2', imageType: 'still' })],
      videos: [],
      alt: 'Poster de Matrix',
    })
    expect(payload.images.every((a) => a.alt === 'Poster de Matrix')).toBe(true)
  })
})

describe('buildMediaPayload — videos', () => {
  it('ordena trailer primeiro e, no mesmo tipo, oficial primeiro', () => {
    const payload = buildMediaPayload({
      images: [],
      videos: [
        video({ id: '1', videoKey: 'K1', videoType: 'Featurette', official: true }),
        video({ id: '2', videoKey: 'K2', videoType: 'Trailer', official: false }),
        video({ id: '3', videoKey: 'K3', videoType: 'Clip', official: true }),
        video({ id: '4', videoKey: 'K4', videoType: 'Trailer', official: true }),
        video({ id: '5', videoKey: 'K5', videoType: 'Bloopers', official: true }),
        video({ id: '6', videoKey: 'K6', videoType: 'Teaser', official: false }),
      ],
      alt: 'Matrix',
    })
    expect(payload.videos.map((v) => v.id)).toEqual(['4', '2', '6', '3', '1', '5'])
    expect(payload.videos.map((v) => v.type)).toEqual([
      'trailer',
      'trailer',
      'teaser',
      'clip',
      'featurette',
      'other',
    ])
  })

  it('dedupe por (site, key) mantendo o primeiro', () => {
    const payload = buildMediaPayload({
      images: [],
      videos: [
        video({ id: '1', site: 'YouTube', videoKey: 'DUP' }),
        video({ id: '2', site: 'YouTube', videoKey: 'DUP' }),
        video({ id: '3', site: 'Vimeo', videoKey: 'DUP' }),
      ],
      alt: 'Matrix',
    })
    expect(payload.videos).toHaveLength(2)
    expect(payload.videos.map((v) => v.id)).toEqual(['1', '3'])
  })

  it('official null vira false', () => {
    const payload = buildMediaPayload({
      images: [],
      videos: [video({ official: null })],
      alt: 'Matrix',
    })
    expect(payload.videos[0]?.official).toBe(false)
  })

  it('publishedAt vira ISO string ou null', () => {
    const payload = buildMediaPayload({
      images: [],
      videos: [
        video({ id: '1', videoKey: 'K1', publishedAt: new Date('2024-03-01T10:00:00.000Z') }),
        video({ id: '2', videoKey: 'K2', publishedAt: null }),
      ],
      alt: 'Matrix',
    })
    expect(payload.videos[0]?.publishedAt).toBe('2024-03-01T10:00:00.000Z')
    expect(payload.videos[1]?.publishedAt).toBeNull()
  })

  it('site desconhecido entra sem embed nem thumbnail', () => {
    const payload = buildMediaPayload({
      images: [],
      videos: [video({ site: 'UnknownHost', videoKey: 'K1' })],
      alt: 'Matrix',
    })
    expect(payload.videos[0]?.embedUrl).toBeNull()
    expect(payload.videos[0]?.thumbnailUrl).toBeNull()
    expect(payload.videos[0]?.site).toBe('UnknownHost')
  })

  it('payload vazio quando nao ha nada', () => {
    const payload = buildMediaPayload({ images: [], videos: [], alt: 'Matrix' })
    expect(payload).toEqual({ poster: null, backdrop: null, images: [], videos: [] })
  })
})

describe('coverageRatio', () => {
  it('total 0 => 0 (nunca divide por zero)', () => {
    expect(coverageRatio(0, 0)).toBe(0)
    expect(coverageRatio(5, 0)).toBe(0)
    expect(coverageRatio(5, -1)).toBe(0)
  })

  it('arredonda a 4 casas', () => {
    expect(coverageRatio(1, 3)).toBe(0.3333)
    expect(coverageRatio(2, 3)).toBe(0.6667)
    expect(coverageRatio(1, 2)).toBe(0.5)
    expect(coverageRatio(10, 10)).toBe(1)
  })
})
