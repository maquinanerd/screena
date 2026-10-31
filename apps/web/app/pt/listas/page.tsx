import type { Metadata } from 'next'

import { ListsPanel } from './lists-panel'
import './lists.css'

/**
 * Suas listas (C8) — tela 15 do canônico: cabeçalho → grade de cards de
 * lista. Sem "Listas em destaque" (não há produto de listas editoriais).
 * `noindex`: área privada do titular.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Minhas listas',
  robots: { index: false, follow: false },
}

export default function Pagina() {
  return (
    <main data-vertical="account">
      <div className="lists-page">
        <ListsPanel />
      </div>
    </main>
  )
}
