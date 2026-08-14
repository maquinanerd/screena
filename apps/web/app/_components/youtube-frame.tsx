'use client'

/**
 * youtube-frame.tsx — O ÚNICO player de YouTube do site público.
 *
 * Antes havia um só: o `<iframe>` do bloco `embed` do corpo de matéria. Ele
 * carregava com a página (`loading="lazy"`, sem clique), embora o comentário
 * logo acima dele prometesse o contrário — "o `<iframe>` só entra no DOM depois
 * que a pessoa aperta". A promessa não estava implementada, e é dela que a
 * política de privacidade publicada depende. Este arquivo é a promessa
 * cumprida, e o lugar único onde ela vale.
 *
 * DUAS SUPERFÍCIES, DOIS DISPAROS, UM FRAME:
 *
 *  - `YouTubeFrame` — o player. Presume que o consentimento JÁ aconteceu.
 *  - `YouTubeFacade` — cartão de ativação nosso; o frame só nasce no clique.
 *
 * No modal de trailer o disparo é o clique em "Assistir ao trailer": o modal só
 * existe depois dele, então lá o `YouTubeFrame` entra direto. Na matéria não há
 * clique nenhum antes — o embed está no meio do texto —, então lá vai a
 * `YouTubeFacade`. Em nenhum dos dois casos o YouTube é contatado por VISITAR a
 * página.
 *
 * PLAYER QUE NÃO CARREGA NUNCA VIRA BURACO. Se o frame não sinalizar carga
 * dentro de `LOAD_TIMEOUT_MS`, ele é substituído por uma mensagem honesta com
 * link para o vídeo no YouTube. Modal em branco é pior que erro declarado.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Quanto esperamos o player sinalizar carga antes de declarar falha.
 *
 * `onLoad` de iframe entre origens dispara na conclusão da navegação, inclusive
 * quando o YouTube devolve página de erro — então isto não pega "vídeo
 * removido". Pega o que importa mais: rede bloqueada, extensão que remove
 * terceiros, DNS morto. Nesses casos, sem o relógio, o leitor ficaria olhando
 * um retângulo preto para sempre.
 */
const LOAD_TIMEOUT_MS = 8000

/** Permissões do player. Sem `autoplay`: reprodução é decisão do leitor. */
const IFRAME_ALLOW = 'encrypted-media; picture-in-picture; fullscreen'

/**
 * `sandbox` SEM `allow-same-origin` — o player roda isolado do nosso documento,
 * então nem cookie nem storage nosso alcança. Mesmo conjunto que o embed de
 * matéria já usava; unificar não é ocasião para afrouxar.
 */
const IFRAME_SANDBOX = 'allow-scripts allow-presentation allow-popups'

export interface YouTubeFrameProps {
  /** URL do player, montada por `buildYouTubeEmbedUrl`. */
  embedUrl: string
  /** URL pública do vídeo, para o link de escape quando o player falha. */
  watchUrl: string
  /** Nome acessível do frame (ex.: "Trailer de Duna: Parte Dois"). */
  title: string
}

export function YouTubeFrame({ embedUrl, watchUrl, title }: YouTubeFrameProps): ReactNode {
  const [failed, setFailed] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loadedRef.current) setFailed(true)
    }, LOAD_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [embedUrl])

  if (failed) {
    return (
      <div className="yt-frame yt-frame--failed" role="status">
        <p className="yt-frame__error">Não foi possível carregar o player aqui.</p>
        <a
          className="yt-frame__escape"
          href={watchUrl}
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          Abrir no YouTube
        </a>
      </div>
    )
  }

  return (
    <div className="yt-frame">
      <iframe
        allow={IFRAME_ALLOW}
        allowFullScreen
        className="yt-frame__player"
        onLoad={() => {
          loadedRef.current = true
        }}
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox={IFRAME_SANDBOX}
        src={embedUrl}
        title={title}
      />
    </div>
  )
}

export interface YouTubeFacadeProps extends YouTubeFrameProps {
  /** Rótulo do botão de ativação. */
  label?: string
}

/**
 * Cartão de ativação: NADA do YouTube existe até o clique.
 *
 * O aviso de que carregar o player contata um terceiro fica no próprio botão,
 * não escondido num rodapé — quem decide precisa saber o que está decidindo no
 * momento em que decide.
 */
export function YouTubeFacade({
  embedUrl,
  watchUrl,
  title,
  label = 'Carregar vídeo',
}: YouTubeFacadeProps): ReactNode {
  const [activated, setActivated] = useState(false)

  if (activated) {
    return <YouTubeFrame embedUrl={embedUrl} title={title} watchUrl={watchUrl} />
  }

  return (
    <div className="yt-frame yt-frame--facade">
      <button
        className="yt-facade__button"
        onClick={() => {
          setActivated(true)
        }}
        type="button"
      >
        <span aria-hidden="true" className="yt-facade__play">
          <svg fill="currentColor" height="22" viewBox="0 0 24 24" width="22">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span className="yt-facade__label">{label}</span>
        <span className="yt-facade__note">O player do YouTube só carrega ao clicar aqui</span>
      </button>
    </div>
  )
}
