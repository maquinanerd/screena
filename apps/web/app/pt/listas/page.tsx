import type { Metadata } from 'next'

import { AdSlot } from '../../_components/ad-slot'
import { ListsPanel } from './lists-panel'

/**
 * Suas listas (C8) — tela 15 do canônico: Ad leaderboard → cabeçalho →
 * grade de cards de lista → Ad billboard. Sem "Listas em destaque" (não há
 * produto de listas editoriais). `noindex`: área privada do titular.
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
        <AdSlot format="leaderboard" slotId="lists-top" />
        <ListsPanel />
        <AdSlot format="billboard" slotId="lists-bottom" />
      </div>
    </main>
  )
}
