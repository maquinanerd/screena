import type { Metadata } from 'next'

import { ImportPanel } from './import-panel'

/**
 * Dados e importação (C8) — tela 14 do canônico: sub-nav de configurações
 * (Dados ativo) + cabeçalho com barra vermelha + painel de importação REAL
 * (prévia antes de qualquer escrita). `noindex`: área privada do titular.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Dados e importação',
  robots: { index: false, follow: false },
}

export default function Pagina() {
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
            <a aria-current="page" className="set-nav__item set-nav__item--active" href="/pt/importar/">
              <span aria-hidden="true" className="set-nav__bar" />
              Dados
            </a>
            <a className="set-nav__item" href="/pt/conta/privacidade/">
              <span aria-hidden="true" className="set-nav__bar" />
              Privacidade
            </a>
          </nav>
        </aside>
        <div className="set-content">
          <div className="imp-header">
            <span aria-hidden="true" className="imp-header__bar" />
            <h1>Dados e importação</h1>
          </div>
          <p className="imp-lede">
            Traga seu histórico, listas e avaliações de outras plataformas — e leve seus dados da
            Cinerie quando quiser.
          </p>
          <ImportPanel />
        </div>
      </div>
    </main>
  )
}
