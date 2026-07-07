/**
 * Testes puros da resolucao do path de imagem do backfill de catalogo publico.
 * Trava a decisao de arquitetura: por PADRAO grava o `file_path` CRU do TMDB
 * (nunca `/media/...`); `--download-images` (legado) grava o path local baixado.
 */

import { describe, expect, it } from 'vitest'

import {
  normalizeRawTmdbPath,
  resolveCatalogImagePath,
} from '../public-catalog-image.js'

describe('normalizeRawTmdbPath', () => {
  it('mantem file_path cru valido do TMDB', () => {
    expect(normalizeRawTmdbPath('/abc.jpg')).toBe('/abc.jpg')
    expect(normalizeRawTmdbPath('  /xyz.png  ')).toBe('/xyz.png')
  })

  it('rejeita ausente/vazio/sem barra inicial', () => {
    expect(normalizeRawTmdbPath(null)).toBeNull()
    expect(normalizeRawTmdbPath(undefined)).toBeNull()
    expect(normalizeRawTmdbPath('')).toBeNull()
    expect(normalizeRawTmdbPath('abc.jpg')).toBeNull()
  })
})

describe('resolveCatalogImagePath', () => {
  it('padrao (sem baixar): grava o file_path CRU do TMDB', () => {
    expect(
      resolveCatalogImagePath({ rawPath: '/abc.jpg', downloadImages: false }),
    ).toBe('/abc.jpg')
    // Nunca grava path local no modo padrao.
    expect(
      resolveCatalogImagePath({
        rawPath: '/abc.jpg',
        downloadedLocalPath: '/media/tmdb/movie/x-poster.jpg',
        downloadImages: false,
      }),
    ).toBe('/abc.jpg')
    expect(
      resolveCatalogImagePath({ rawPath: null, downloadImages: false }),
    ).toBeNull()
  })

  it('--download-images (legado): grava o path LOCAL baixado', () => {
    expect(
      resolveCatalogImagePath({
        rawPath: '/abc.jpg',
        downloadedLocalPath: '/media/tmdb/movie/x-poster.jpg',
        downloadImages: true,
      }),
    ).toBe('/media/tmdb/movie/x-poster.jpg')
    // Download falhou -> null (nunca cai no cru nesse modo).
    expect(
      resolveCatalogImagePath({
        rawPath: '/abc.jpg',
        downloadedLocalPath: null,
        downloadImages: true,
      }),
    ).toBeNull()
  })
})
