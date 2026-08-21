/**
 * image-license-gate.test.ts — O PÔSTER SOME quando a licença diz não.
 *
 * ============================================================================
 * O QUE ESTA SUITE EXISTE PARA REPROVAR
 * ============================================================================
 * Até 21/08/2026 o caminho de imagem era o ÚNICO dado de terceiro exibido sem
 * consultar `source_licenses`. Cinco módulos do render consultavam (premiação,
 * trailer, notas, onde-assistir, hero); imagem não era um deles. Consequência
 * medida: o valor de `display_allowed` para `tmdb`/`image` era DECORAÇÃO —
 * `true` ou `false`, o pôster renderizava igual.
 *
 * O caso (1) é o controle negativo REAL exigido: põe `display_allowed = false`
 * e prova que o pôster some. Se ele passar com o gate removido, o teste está
 * errado — não o gate.
 *
 * ============================================================================
 * POR QUE O CASO (2) NÃO É REDUNDANTE
 * ============================================================================
 * Um `authorizeImageDisplay` que devolvesse SEMPRE negado passaria em (1) e
 * apagaria o site inteiro. (2) prova a direção oposta: com licença válida, o
 * pôster APARECE. Um par assim é a única forma de um gate ter teste.
 */

import { describe, expect, it } from 'vitest'

import {
  authorizeImageDisplay,
  IMAGE_DISPLAY_DENIED,
  tmdbImageUrlIfAllowed,
  type ImageLicenseRow,
} from '@screena/public-contracts'
import { selectMovieMedia } from '../../apps/web/src/lib/movie-presenter'
import { selectSeriesMedia } from '../../apps/web/src/lib/series-presenter'

/** A linha de licença vigente de `tmdb`/`image`, no estado que o caso pedir. */
function licenca(over: Partial<ImageLicenseRow> = {}): ImageLicenseRow {
  return {
    sourceKey: 'tmdb',
    contentType: 'image',
    licenseStatus: 'official',
    displayAllowed: true,
    isCurrent: true,
    ...over,
  }
}

/** Um título com pôster e backdrop reais (file_path cru do TMDB). */
const TITULO = { posterPath: '/poster-real.jpg', backdropPath: '/backdrop-real.jpg' }

describe('gate de licença da imagem', () => {
  it('(1) CONTROLE NEGATIVO: display_allowed=false para tmdb/image => o PÔSTER SOME', () => {
    const negada = authorizeImageDisplay([licenca({ displayAllowed: false })])
    expect(negada.authorized).toBe(false)
    expect(negada.reason).toContain('display_allowed = false')

    const filme = selectMovieMedia(TITULO, negada)
    expect(filme.poster).toBeNull()
    expect(filme.backdrop).toBeNull()
    expect(filme.hasRealImage).toBe(false)

    // A série usa o mesmo gate. Se só o filme estivesse coberto, metade do
    // catálogo continuaria exibindo arte sem licença.
    const serie = selectSeriesMedia(TITULO, negada)
    expect(serie.poster).toBeNull()
    expect(serie.backdrop).toBeNull()
    expect(serie.hasRealImage).toBe(false)
  })

  it('(2) CONTROLE POSITIVO: licença vigente e permitida => o pôster APARECE', () => {
    const permitida = authorizeImageDisplay([licenca()])
    expect(permitida.authorized).toBe(true)

    const filme = selectMovieMedia(TITULO, permitida)
    expect(filme.poster?.src).toBe('https://image.tmdb.org/t/p/w500/poster-real.jpg')
    expect(filme.hasRealImage).toBe(true)

    const serie = selectSeriesMedia(TITULO, permitida)
    expect(serie.poster).not.toBeNull()
    expect(serie.hasRealImage).toBe(true)
  })

  it('(3) FAIL-CLOSED: sem linha de licença nenhuma, nega', () => {
    // Ausência é indistinguível de negativa do lado de fora, e a invariante 6
    // manda tratar as duas igual.
    const semLinha = authorizeImageDisplay([])
    expect(semLinha.authorized).toBe(false)
    expect(semLinha.reason).toContain('sem licenca vigente')
    expect(selectMovieMedia(TITULO, semLinha).poster).toBeNull()
  })

  it('(4) license_status unknown/blocked nega mesmo com display_allowed=true', () => {
    // A invariante 6 tem DUAS portas, e passar por uma não abre a outra.
    for (const status of ['unknown', 'blocked']) {
      const decisao = authorizeImageDisplay([licenca({ licenseStatus: status, displayAllowed: true })])
      expect(decisao.authorized).toBe(false)
      expect(decisao.reason).toContain(status)
      expect(selectMovieMedia(TITULO, decisao).poster).toBeNull()
    }
  })

  it('(5) licença NÃO vigente não autoriza — histórico não vale como permissão', () => {
    const soHistorico = authorizeImageDisplay([
      licenca({ isCurrent: false, displayAllowed: true }),
    ])
    expect(soHistorico.authorized).toBe(false)
  })

  it('(6) licença de OUTRO content_type não vale para imagem', () => {
    // O vídeo do TMDB tem `display_allowed = true` desde 13/08/2026. Se o gate
    // casasse só por `source_key`, a licença de trailer liberaria o pôster.
    const soVideo = authorizeImageDisplay([
      licenca({ contentType: 'video', displayAllowed: true }),
    ])
    expect(soVideo.authorized).toBe(false)
    expect(soVideo.reason).toContain('sem licenca vigente')
  })

  it('(7) asset LOCAL não passa pelo gate — não é arte do TMDB', () => {
    // Arte própria commitada no repositório não pede licença a terceiro.
    const local = selectMovieMedia(
      { posterPath: '/media/demo/poster.jpg', backdropPath: null },
      IMAGE_DISPLAY_DENIED,
    )
    expect(local.poster?.src).toBe('/media/demo/poster.jpg')
    expect(local.hasRealImage).toBe(true)
  })

  it('(8) a marca é opaca: não dá para autorizar com um booleano', () => {
    // Se `tmdbImageUrlIfAllowed` aceitasse `true`, o gate viraria comentário.
    // O compilador é quem reprova; aqui provamos o comportamento em runtime.
    expect(tmdbImageUrlIfAllowed('/x.jpg', 'w500', IMAGE_DISPLAY_DENIED)).toBeNull()
    expect(
      tmdbImageUrlIfAllowed('/x.jpg', 'w500', authorizeImageDisplay([licenca()])),
    ).toBe('https://image.tmdb.org/t/p/w500/x.jpg')
  })
})
