'use client'

import type { ReactNode } from 'react'

import { episodePath } from '../../src/lib/routes'
import type { SeriesEpisodeView } from '../../src/lib/series-presenter'

/**
 * Quantos episodios a ficha mostra abertos. O resto fica num `<details>` NATIVO
 * logo abaixo: sem JavaScript, acessivel por teclado, e TODOS os episodios
 * continuam no HTML do servidor (titulo, sinopse, meta). Medido em producao em
 * 23/11/2026: com dez episodios de ~200px, a lista sozinha empurrava elenco,
 * "Mais como este" e ficha tecnica dois mil pixels para baixo. A IMDb nem lista
 * os episodios na ficha — aponta para o guia; aqui o guia vem dobrado.
 */
export const EPISODES_OPEN_LIMIT = 6

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
 *
 * O que MUDOU em 23/11/2026 (analise de UX): a linha tinha um chevron "›" que
 * prometia clique e nao levava a lugar nenhum — a pagina do episodio existia e
 * a ficha nao apontava para ela. Agora, com o slug da serie, o titulo e o link
 * e o cartao inteiro e o alvo (link esticado, ver `.episode-row__link` em
 * detail.css). Sem slug, nem link nem chevron.
 */
export function EpisodeList({
  episodes,
  seasonNumber,
  seriesSlug = null,
}: {
  episodes: readonly SeriesEpisodeView[]
  seasonNumber: number
  /** Slug da serie; sem ele a linha continua texto e o chevron nao aparece. */
  seriesSlug?: string | null
}): ReactNode {
  const open = episodes.slice(0, EPISODES_OPEN_LIMIT)
  const folded = episodes.slice(EPISODES_OPEN_LIMIT)
  const row = (episode: SeriesEpisodeView): ReactNode => (
    <EpisodeRow
      episode={episode}
      href={seriesSlug === null ? null : episodePath(seriesSlug, seasonNumber, episode.episodeNumber)}
      key={episode.episodeNumber}
      seasonNumber={seasonNumber}
    />
  )

  return (
    <>
      <ol className="episode-list" style={{ marginTop: 6 }}>
        {open.map(row)}
      </ol>
      {folded.length > 0 ? (
        <details className="episode-more">
          <summary className="episode-more__toggle">
            {`Mostrar mais ${folded.length} ${folded.length === 1 ? 'episódio' : 'episódios'}`}
          </summary>
          <ol className="episode-list" start={EPISODES_OPEN_LIMIT + 1}>
            {folded.map(row)}
          </ol>
        </details>
      ) : null}
    </>
  )
}

function EpisodeRow({
  episode,
  href,
  seasonNumber,
}: {
  episode: SeriesEpisodeView
  href: string | null
  seasonNumber: number
}): ReactNode {
  const episodeMeta = [
    episode.airYear !== null ? String(episode.airYear) : null,
    episode.runtimeLabel,
  ].filter((item): item is string => item !== null)
  const linked = href !== null && episode.title !== null

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
              {/* Link esticado: o `<a>` e so o titulo (nome acessivel curto e
                  verdadeiro) e o `::after` dele cobre a linha inteira. */}
              {linked ? (
                <a className="episode-row__link" href={href}>
                  {episode.title}
                </a>
              ) : (
                episode.title
              )}
            </h4>
          ) : null}
          {episode.overview !== null ? (
            <p className="episode-row__synopsis">{episode.overview}</p>
          ) : null}
          {episodeMeta.length > 0 ? (
            <p className="episode-row__meta">{episodeMeta.join(' · ')}</p>
          ) : null}
        </div>
        {linked ? (
          <span aria-hidden="true" className="episode-row__chevron">
            <svg fill="none" height="22" viewBox="0 0 24 24" width="22">
              <path d="m10 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          </span>
        ) : null}
      </article>
    </li>
  )
}
