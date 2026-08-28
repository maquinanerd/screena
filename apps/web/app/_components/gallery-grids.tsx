/**
 * gallery-grids.tsx — A grade de imagens e a lista de vídeos.
 *
 * ============================================================================
 * NADA CARREGA ANTES DO CLIQUE — E ISSO VALE PARA AS DUAS
 * ============================================================================
 * VÍDEO: o player é o `TrailerModal` da PR #174, reusado. Não existe um segundo
 * player nesta leva; o `<iframe>` do YouTube só entra no DOM depois do clique.
 *
 * IMAGEM: `loading="lazy"` em toda a grade. Uma galeria de 200 pôsteres com
 * carga ansiosa são 200 requisições ao CDN do TMDB na primeira pintura — e o
 * leitor vê 12. O `alt` descreve o PAPEL da arte ("Pôster de X"), nunca a arte:
 * descrevê-la exigiria olhar para ela, e nada aqui olha.
 *
 * `width`/`height` saem quando o TMDB os informou. Sem eles o navegador não
 * reserva o espaço e a grade pula durante a carga (CLS) — por isso o CSS
 * também impõe `aspect-ratio` por tipo, e não só a dimensão do dado.
 */

import { TrailerModal } from './trailer-modal'
import type {
  GalleryImageView,
  GalleryVideoView,
  PersonPhotoView,
} from '../../src/lib/gallery-presenter'

/** A grade de imagens. Clique abre o tamanho grande. */
export function GalleryImageGrid({ images }: { images: readonly GalleryImageView[] }) {
  return (
    <ul className="gallery-grid poster-grid poster-grid--4">
      {images.map((image) => (
        <li className="gallery-tile" data-kind={image.kind} key={image.fullUrl}>
          {/*
            `<a>` simples para o tamanho grande, e não um lightbox: um lightbox
            exigiria `use client` e estado, e o ganho sobre "abrir a imagem"
            não paga o segundo caminho. O `target` fica de fora de propósito —
            abrir aba nova é decisão do leitor (ctrl+clique), não da página.
          */}
          <a className="gallery-tile__link" href={image.fullUrl}>
            <img
              alt={image.alt}
              className="gallery-tile__img"
              height={image.height ?? undefined}
              loading="lazy"
              src={image.thumbUrl}
              width={image.width ?? undefined}
            />
          </a>
          <p className="gallery-tile__meta">
            <span className="gallery-tile__kind">{image.kindLabel}</span>
            <span className="gallery-tile__lang">{image.languageLabel}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

/**
 * A grade de FOTOS de uma pessoa. Mesmo casco da grade de título.
 *
 * `data-kind="profile"` e não um tipo por foto: `tmdb_images` guarda retrato de
 * pessoa com um `image_type` só, e a proporção 2/3 do CSS vale para todas. Não
 * há rótulo de tipo no rodapé de cada quadro pelo mesmo motivo — "Perfil" em
 * todos os quadros seria uma coluna de uma constante, que não informa nada.
 * O idioma FICA: uma arte com texto em português e outra sem texto são coisas
 * diferentes, e é a única faceta real deste conjunto.
 */
export function PersonPhotoGrid({ photos }: { photos: readonly PersonPhotoView[] }) {
  return (
    <ul className="gallery-grid poster-grid poster-grid--4">
      {photos.map((photo) => (
        <li className="gallery-tile" data-kind="profile" key={photo.fullUrl}>
          <a className="gallery-tile__link" href={photo.fullUrl}>
            <img
              alt={photo.alt}
              className="gallery-tile__img"
              height={photo.height ?? undefined}
              loading="lazy"
              src={photo.thumbUrl}
              width={photo.width ?? undefined}
            />
          </a>
          <p className="gallery-tile__meta">
            <span className="gallery-tile__lang">{photo.languageLabel}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

/** A lista de vídeos. O player entra só depois do clique. */
export function GalleryVideoList({
  videos,
  entityTitle,
}: {
  videos: readonly GalleryVideoView[]
  entityTitle: string
}) {
  return (
    <ul className="gallery-videos">
      {videos.map((video) => (
        <li className="gallery-video" key={`${video.site}:${video.videoKey}`}>
          <div
            className="gallery-video__art"
            // O fundo é o backdrop do TÍTULO (não uma miniatura do YouTube —
            // ver `gallery-presenter.ts`). Sem backdrop exibível, a arte fica
            // com o fundo neutro do CSS, nunca com uma imagem quebrada.
            style={
              video.backdropUrl === null
                ? undefined
                : { backgroundImage: `url(${video.backdropUrl})` }
            }
          >
            {video.player === null ? (
              // Sem player: o video existe (e conta na contagem) mas nao e
              // reproduzivel por nos. Um botao que nao abre nada seria pior que
              // a ausencia dele.
              <span className="gallery-video__noplay">Indisponível para reprodução</span>
            ) : (
              <TrailerModal
                title={video.title}
                trailer={video.player}
                triggerClassName="gallery-video__play"
              />
            )}
          </div>
          <div className="gallery-video__body">
            <p className="gallery-video__title">{video.title}</p>
            <p className="gallery-video__meta">
              <span className="gallery-video__type">{video.typeLabel}</span>
              {/* RESOLUCAO, nao duracao: `size` do TMDB e 360/480/720/1080.
                  Ver `gallery-presenter.ts`. */}
              {video.resolutionLabel !== null ? (
                <span className="gallery-video__resolution">{video.resolutionLabel}</span>
              ) : null}
              <span className="gallery-video__lang">{video.languageLabel}</span>
              {video.official ? (
                <span className="gallery-video__official">Oficial</span>
              ) : null}
            </p>
          </div>
        </li>
      ))}
      <li className="gallery-videos__note" key="__nota">
        {/*
          A frase é para o LEITOR, e ela é verdade verificável: nada de terceiro
          é carregado até o clique. É a mesma promessa que a política de
          privacidade faz no item 6.1.
        */}
        <p>
          Os vídeos são reproduzidos pelo YouTube e só carregam depois que você
          clica. Conteúdo de {entityTitle} fornecido pelo TMDB.
        </p>
      </li>
    </ul>
  )
}
