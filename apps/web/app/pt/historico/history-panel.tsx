'use client'

import { useEffect, useState } from 'react'

/**
 * Painel de HISTORICO (C8).
 *
 * Mostra APENAS consumo explicitamente registrado — o diario de eventos. Nao ha
 * "paginas visitadas" aqui: isso e telemetria comportamental, vive noutra
 * camada e depende de consentimento. A distincao e do produto, nao da tela.
 */

interface DiaryEvent {
  id: string
  entityType: string
  entityId: string
  eventType: string
  occurredAt: string
  source: string
}

const ROTULOS: Record<string, string> = {
  watch_started: 'Comecou a assistir',
  watch_completed: 'Concluiu',
  episode_watched: 'Episodio assistido',
  episode_unwatched: 'Episodio desmarcado',
  progress_updated: 'Atualizou o progresso',
  state_changed: 'Mudou o estado',
  rewatch_started: 'Recomecou',
  rating_set: 'Avaliou',
  rating_removed: 'Removeu a nota',
  undo: 'Desfez',
  import_applied: 'Importado',
}

export function HistoryPanel(): React.ReactElement {
  const [estado, setEstado] = useState<
    'carregando' | 'pronto' | 'erro' | 'nao-autenticado'
  >('carregando')
  const [eventos, setEventos] = useState<DiaryEvent[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/me/history?limit=50', { credentials: 'same-origin' })
        if (r.status === 401) {
          setEstado('nao-autenticado')
          return
        }
        if (!r.ok) {
          setEstado('erro')
          return
        }
        const dados = (await r.json()) as { items: DiaryEvent[]; total: number }
        setEventos(dados.items)
        setTotal(dados.total)
        setEstado('pronto')
      } catch {
        setEstado('erro')
      }
    })()
  }, [])

  if (estado === 'nao-autenticado') {
    return (
      <p role="status">
        <a href="/pt/entrar">Entre na sua conta</a> para ver seu historico.
      </p>
    )
  }

  return (
    <div aria-live="polite">
      {estado === 'carregando' ? <p role="status">Carregando...</p> : null}
      {estado === 'erro' ? <p role="alert">Nao foi possivel carregar o historico.</p> : null}
      {estado === 'pronto' && eventos.length === 0 ? (
        <p role="status">Nada registrado ainda.</p>
      ) : null}
      {estado === 'pronto' && eventos.length > 0 ? (
        <>
          <p>{total} registro(s).</p>
          <ul>
            {eventos.map((e) => (
              <li key={e.id}>
                <time dateTime={e.occurredAt}>
                  {new Date(e.occurredAt).toLocaleDateString('pt-BR')}
                </time>{' '}
                — {ROTULOS[e.eventType] ?? e.eventType} ({e.entityType} #{e.entityId})
                {e.source !== 'app' ? <em> via importacao</em> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
