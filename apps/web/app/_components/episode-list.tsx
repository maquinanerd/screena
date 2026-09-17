'use client'

import type { ReactNode } from 'react'

import type { SeriesEpisodeView } from '../../src/lib/series-presenter'

/**
 * A lista de episodios da temporada selecionada na ficha de serie
 * (`/pt/series/{slug}/`), com o MESMO HTML que o servidor sempre entregou.
 *
 * POR QUE E CLIENT COMPONENT, SE NAO TEM ESTADO NEM EVENTO. O documento de uma
 * pagina do App Router leva a arvore duas vezes: o HTML renderizado e, nos
 * scripts `self.__next_f.push`, o payload RSC. Renderizada no servidor, cada
 * linha ia para o payload como ARVORE de elementos — `div`, `span`, `img`, `h4`,
 * dois `p` e o `svg` do chevron, cada um com classes e atributos. Medido em
 * producao em 15/09/2026, numa ficha com 45 episodios na temporada: 887 bytes de
 * HTML e 1.345 bytes de payload POR LINHA, dos quais ~300 eram texto e a URL do
 * still. Como client component, o payload leva so os DADOS de cada episodio; a
 * marcacao sai deste arquivo, que o navegador baixa uma vez.
 *
 * O que NAO muda: o HTML do servidor (titulo, sinopse inteira e meta de cada
 * episodio continuam no documento, indexaveis), a licenca do still (decidida no
 * servidor por `buildSeriesPageView` — aqui chega `still` autorizado ou `null`) e
 * a selecao de temporada por `?temporada=`, que continua no servidor.
 */
export function EpisodeList({
  episodes,
  seasonNumber,
}: {
  episodes: readonly SeriesEpisodeView[]
  seasonNumber: number
}): ReactNode {
  return (
    <ol className="episode-list" style={{ marginTop: 6 }}>
      {episodes.map((episode) => (
        <EpisodeRow episode={episode} key={episode.episodeNumber} seasonNumber={seasonNumber} />
      ))}
    </ol>
  )
}

function EpisodeRow({
  episode,
  seasonNumber,
}: {
  episode: SeriesEpisodeView
  seasonNumber: number
}): ReactNode {
  const episodeMeta = [
    episode.airYear !== null ? String(episode.airYear) : null,
    episode.runtimeLabel,
  ].filter((item): item is string => item !== null)

  return (
    <li>
      <article className="episode-row">
        <div className="episode-row__media">
          {/* Um texto so: em quatro nos, o HTML do servidor ganhava tres `<!-- -->`. */}
          <span className="episode-row__num">{`T${seasonNumber} · E${episode.episodeNumber}`}</span>
          {episode.still !== null ? (
            <img
              alt=""
              height={episode.still.height}
              loading="lazy"
              src={episode.still.src}
              width={episode.still.width}
            />
          ) : null}
        </div>
        <div>
          {episode.title !== null ? (
            <h4 className="episode-row__title" style={{ letterSpacing: '-0.01em', textTransform: 'none' }}>
              {episode.title}
            </h4>
          ) : null}
          {episode.overview !== null ? (
            <p className="episode-row__synopsis">{episode.overview}</p>
          ) : null}
          {episodeMeta.length > 0 ? (
            <p className="episode-row__meta">{episodeMeta.join(' · ')}</p>
          ) : null}
        </div>
        <span aria-hidden="true" className="episode-row__chevron">
          <svg fill="none" height="22" viewBox="0 0 24 24" width="22">
            <path d="m10 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        </span>
      </article>
    </li>
  )
}
