'use client'

/**
 * consent-banner.tsx — O aviso de cookies e o carregamento do Google Analytics.
 *
 * O GA4 NAO CARREGA ANTES DO "ACEITAR". Enquanto nao houver um "sim" legivel no
 * armazenamento do navegador, nao existe `<script>` do Google, nem `dataLayer`,
 * nem cookie `_ga` — o documento nao contem a string "googletagmanager". E o que
 * sustenta o item 6 da Politica de Privacidade, e e a prova principal do teste.
 *
 * RECUSAR CUSTA O MESMO QUE ACEITAR. Os dois botoes tem o mesmo tamanho, o mesmo
 * estilo e a mesma posicao de destaque; nenhum vem pre-selecionado. O aviso nao
 * bloqueia a leitura (nao e modal): quem nao responde continua navegando, e a
 * ausencia de resposta e lida como "nao".
 *
 * MUDAR DE IDEIA. O botao "Preferencias de cookies" do rodape dispara
 * `OPEN_CONSENT_PREFERENCES_EVENT` e o aviso volta, mostrando a escolha atual.
 * Retirar a autorizacao desliga a coleta na hora (`ga-disable-<ID>` + consent
 * mode) e apaga os cookies `_ga*` deste dominio.
 *
 * Sem `measurementId` este componente nem e montado (`app/layout.tsx`): sem
 * ferramenta, nao ha o que consentir, e o aviso nao aparece.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  GA4_COOKIE_MAX_AGE_SECONDS,
  ga4ScriptUrl,
} from '../../src/lib/analytics-scripts'
import {
  OPEN_CONSENT_PREFERENCES_EVENT,
  cookieDeletionAssignments,
  ga4CookieNames,
  readConsent,
  writeConsent,
  type AnalyticsChoice,
} from '../../src/lib/analytics-consent'
import { PRIVACY_PATH } from '../../src/lib/routes'

type Gtag = (...args: unknown[]) => void

interface GtagWindow extends Window {
  dataLayer?: unknown[]
  gtag?: Gtag
  [disableFlag: `ga-disable-${string}`]: boolean | undefined
}

const SCRIPT_MARKER = 'data-cinerie-ga4'

function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function startGa4(measurementId: string): void {
  const w = window as unknown as GtagWindow
  w[`ga-disable-${measurementId}`] = false
  w.dataLayer = w.dataLayer ?? []
  if (w.gtag === undefined) {
    // O gtag.js le o objeto `arguments`, e nao um array: e o contrato do
    // snippet oficial, por isso o `arguments` aqui e deliberado.
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer?.push(arguments)
    }
  }
  const gtag = w.gtag

  if (document.querySelector(`script[${SCRIPT_MARKER}]`) !== null) {
    gtag('consent', 'update', { analytics_storage: 'granted' })
    return
  }

  gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
  gtag('js', new Date())
  gtag('config', measurementId, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: GA4_COOKIE_MAX_AGE_SECONDS,
  })

  const script = document.createElement('script')
  script.async = true
  script.src = ga4ScriptUrl(measurementId)
  script.setAttribute(SCRIPT_MARKER, measurementId)
  document.head.appendChild(script)
}

function stopGa4(measurementId: string): void {
  const w = window as unknown as GtagWindow
  w[`ga-disable-${measurementId}`] = true
  w.gtag?.('consent', 'update', { analytics_storage: 'denied' })
  for (const name of ga4CookieNames(document.cookie)) {
    for (const assignment of cookieDeletionAssignments(name, window.location.hostname)) {
      document.cookie = assignment
    }
  }
}

export interface ConsentBannerProps {
  /** Identificador do fluxo web do GA4, ja validado no servidor. */
  measurementId: string
}

export function ConsentBanner({ measurementId }: ConsentBannerProps): ReactNode {
  const [choice, setChoice] = useState<AnalyticsChoice | null>(null)
  const [open, setOpen] = useState(false)
  const [reopened, setReopened] = useState(false)
  const firstButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const stored = readConsent(browserStorage(), new Date())
    setChoice(stored)
    if (stored === null) setOpen(true)

    const reopen = () => {
      setReopened(true)
      setOpen(true)
    }
    window.addEventListener(OPEN_CONSENT_PREFERENCES_EVENT, reopen)
    return () => window.removeEventListener(OPEN_CONSENT_PREFERENCES_EVENT, reopen)
  }, [])

  useEffect(() => {
    if (choice === 'granted') startGa4(measurementId)
  }, [choice, measurementId])

  // Quem pediu o aviso pelo rodape esta de teclado na mao: o foco vai para ele.
  // Na primeira visita, nao — o aviso nao rouba o foco de quem chegou para ler.
  useEffect(() => {
    if (open && reopened) firstButton.current?.focus()
  }, [open, reopened])

  const decide = useCallback(
    (next: AnalyticsChoice) => {
      writeConsent(browserStorage(), next, new Date())
      if (next === 'denied' && choice === 'granted') stopGa4(measurementId)
      setChoice(next)
      setOpen(false)
    },
    [choice, measurementId],
  )

  if (!open) return null

  return (
    <section aria-labelledby="consent-banner-title" className="consent-banner">
      <div className="consent-banner__inner">
        <div className="consent-banner__text">
          <h2 className="consent-banner__title" id="consent-banner-title">
            Cookies de análise
          </h2>
          <p>
            Com a sua autorização, o Google Analytics mede quais páginas são lidas. Ele grava
            cookies no seu navegador e envia ao Google dados da sua navegação. Sem autorização,
            ele não carrega.{' '}
            <a href={`${PRIVACY_PATH}#cookies`}>Saiba mais na Política de Privacidade</a>.
          </p>
          {reopened && choice !== null ? (
            <p className="consent-banner__current">
              Sua escolha atual: {choice === 'granted' ? 'autorizado' : 'recusado'}.
            </p>
          ) : null}
        </div>
        <div className="consent-banner__actions">
          <button
            className="consent-banner__button"
            onClick={() => decide('denied')}
            ref={firstButton}
            type="button"
          >
            Recusar
          </button>
          <button
            className="consent-banner__button"
            onClick={() => decide('granted')}
            type="button"
          >
            Aceitar
          </button>
        </div>
      </div>
    </section>
  )
}

/** Botao do rodape que reabre o aviso. So existe quando o GA4 esta ligado. */
export function CookiePreferencesButton(): ReactNode {
  return (
    <button
      className="cookie-prefs-button"
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_PREFERENCES_EVENT))}
      type="button"
    >
      Preferências de cookies
    </button>
  )
}
