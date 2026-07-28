import type { ReactNode } from 'react'

import { AdSlot } from '../../_components/ad-slot'

/**
 * AuthShell — moldura da tela 16 do canônico (Entrar/Cadastrar), estrutura
 * EXATA: coluna central 460px (marca Cinerie + lede + card com tabs) e
 * skyscraper de publicidade sticky à direita.
 *
 * A marca é o wordmark ATUAL da Cinerie (o protótipo trazia a marca histórica
 * "THE SCREEN" — rebranding Gate 1.5 aplica a identidade vigente). Sem SSO:
 * "Continuar com Google/Apple" do protótipo não existe como produto — nunca
 * botão morto (DIVERGENCIAS registra).
 */

export function AuthShell({
  active,
  lede,
  children,
  showTabs = true,
}: {
  active: 'entrar' | 'criar'
  lede: string
  children: ReactNode
  showTabs?: boolean
}): ReactNode {
  return (
    <div className="auth-layout">
      <div className="auth-col">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Cinerie" height={28} src="/brand/cinerie-wordmark-black.svg" width={146} />
        </div>
        <p className="auth-lede">{lede}</p>
        <div className="auth-card">
          {showTabs ? (
            <nav aria-label="Entrar ou criar conta" className="auth-tabs">
              <a
                aria-current={active === 'entrar' ? 'page' : undefined}
                className={active === 'entrar' ? 'auth-tab auth-tab--active' : 'auth-tab'}
                href="/pt/entrar/"
              >
                Entrar
              </a>
              <a
                aria-current={active === 'criar' ? 'page' : undefined}
                className={active === 'criar' ? 'auth-tab auth-tab--active' : 'auth-tab'}
                href="/pt/criar-conta/"
              >
                Criar conta
              </a>
            </nav>
          ) : null}
          {children}
        </div>
        <p className="auth-terms">
          Ao continuar, você concorda com os Termos e a Política de Privacidade.
        </p>
      </div>
      <div className="auth-side">
        <AdSlot format="skyscraper" slotId="auth-side" />
      </div>
    </div>
  )
}
