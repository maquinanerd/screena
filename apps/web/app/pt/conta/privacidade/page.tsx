import type { Metadata } from 'next'

import { PrivacyPanel } from './privacy-panel'

/**
 * PRIVACIDADE E MEUS DADOS (C7D) — sub-superfície "Privacidade" da tela 13:
 * consentimentos, exportação e encerramento, no layout canônico de
 * configurações (sub-nav + cards de linhas). `noindex`: área privada.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Privacidade e meus dados',
  robots: { index: false, follow: false },
}

export default function PrivacidadePage() {
  return (
    <main data-vertical="account">
      <div className="set-layout">
        <aside className="set-nav">
          <div className="set-nav__label">Configurações</div>
          <nav aria-label="Seções de configurações">
            <a className="set-nav__item" href="/pt/conta/">
              <span aria-hidden="true" className="set-nav__bar" />
              Geral
            </a>
            <a className="set-nav__item" href="/pt/importar/">
              <span aria-hidden="true" className="set-nav__bar" />
              Dados
            </a>
            <a
              aria-current="page"
              className="set-nav__item set-nav__item--active"
              href="/pt/conta/privacidade/"
            >
              <span aria-hidden="true" className="set-nav__bar" />
              Privacidade
            </a>
          </nav>
        </aside>
        <div className="set-content">
          <h1 className="set-page-title">Privacidade e meus dados</h1>
          <PrivacyPanel />
        </div>
      </div>
    </main>
  )
}
