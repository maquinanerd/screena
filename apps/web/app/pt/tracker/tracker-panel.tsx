'use client'

import { useState } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'

/**
 * Painel do TRACKER (C8): progresso da serie, proximo episodio e marcacao em
 * massa.
 *
 * A operacao em massa envia UMA requisicao ("marque a serie"), nunca uma por
 * episodio: o servidor enumera e escreve em lote. E o que torna viavel uma
 * serie com dezenas de milhares de episodios.
 */

interface Progresso {
  tvShowId: string
  totalEpisodes: number
  watchedEpisodes: number
  percent: number
  completed: boolean
  nextEpisode: { episodeId: string; seasonNumber: number; episodeNumber: number } | null
}

export function TrackerPanel(): React.ReactElement {
  const [serieId, setSerieId] = useState('')
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const [estado, setEstado] = useState<'inicial' | 'carregando' | 'pronto' | 'erro' | 'nao-autenticado'>('inicial')
  const [aviso, setAviso] = useState<string | null>(null)

  async function consultar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setEstado('carregando')
    setAviso(null)
    try {
      const r = await fetch(`/api/me/series-progress/${encodeURIComponent(serieId)}`, {
        credentials: 'same-origin',
      })
      if (r.status === 401) {
        setEstado('nao-autenticado')
        return
      }
      if (!r.ok) {
        setEstado('erro')
        return
      }
      const dados = (await r.json()) as { progress: Progresso }
      setProgresso(dados.progress)
      setEstado('pronto')
    } catch {
      setEstado('erro')
    }
  }

  async function marcarTudo(watched: boolean): Promise<void> {
    setAviso(null)
    const r = await authFetch('/api/me/episodes/bulk', {
      method: 'POST',
      body: JSON.stringify({ tvShowId: serieId, seasonNumber: null, watched }),
    })
    if (!r.ok) {
      setAviso('Nao foi possivel atualizar a serie.')
      return
    }
    const dados = (await r.json()) as { episodesConsidered: number; created: number; updated: number }
    setAviso(
      `${dados.episodesConsidered} episodio(s) considerados; ${dados.created + dados.updated} alterado(s).`,
    )
    const p = await fetch(`/api/me/series-progress/${encodeURIComponent(serieId)}`, {
      credentials: 'same-origin',
    })
    if (p.ok) {
      const dadosP = (await p.json()) as { progress: Progresso }
      setProgresso(dadosP.progress)
    }
  }

  if (estado === 'nao-autenticado') {
    return (
      <p role="status">
        <a href="/pt/entrar">Entre na sua conta</a> para acompanhar series.
      </p>
    )
  }

  return (
    <div>
      <form onSubmit={consultar}>
        <label htmlFor="serie-id">Id da serie</label>
        <input
          id="serie-id"
          type="text"
          inputMode="numeric"
          required
          value={serieId}
          onChange={(e) => setSerieId(e.target.value)}
        />
        <button type="submit">Ver progresso</button>
      </form>

      <div aria-live="polite">
        {estado === 'carregando' ? <p role="status">Carregando...</p> : null}
        {estado === 'erro' ? <p role="alert">Nao foi possivel carregar o progresso.</p> : null}
        {estado === 'pronto' && progresso !== null ? (
          <section aria-labelledby="progresso-titulo">
            <h2 id="progresso-titulo">Progresso</h2>
            {progresso.totalEpisodes === 0 ? (
              <p role="status">Esta serie ainda nao tem episodios no catalogo.</p>
            ) : (
              <>
                <p>
                  {progresso.watchedEpisodes} de {progresso.totalEpisodes} episodio(s) —{' '}
                  {progresso.percent}%
                </p>
                <progress value={progresso.watchedEpisodes} max={progresso.totalEpisodes}>
                  {progresso.percent}%
                </progress>
                <p>
                  {progresso.completed
                    ? 'Serie concluida.'
                    : progresso.nextEpisode !== null
                      ? `Proximo: T${progresso.nextEpisode.seasonNumber} E${progresso.nextEpisode.episodeNumber}`
                      : 'Sem proximo episodio.'}
                </p>
                <p>
                  <button type="button" onClick={() => void marcarTudo(true)}>
                    Marcar serie inteira como assistida
                  </button>{' '}
                  <button type="button" onClick={() => void marcarTudo(false)}>
                    Desmarcar tudo
                  </button>
                </p>
                <p>
                  Episodios especiais (temporada 0) ficam de fora por padrao.
                </p>
              </>
            )}
          </section>
        ) : null}
        {aviso !== null ? <p role="status">{aviso}</p> : null}
      </div>
    </div>
  )
}
