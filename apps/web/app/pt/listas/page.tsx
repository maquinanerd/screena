import type { Metadata } from 'next'

import { AdSlot } from '../../_components/opapreco/ad-slot'
import { ListsPanel } from './lists-panel'
import './lists.css'

/**
 * Suas listas (C8) — tela 15 do canônico: grade OpaPreço (`lists-top`) →
 * cabeçalho → grade de cards de lista → product_hero_v1 (`lists-billboard`).
 * Sem "Listas em destaque" (não há produto de listas editoriais) — e por isso
 * sem `lists-collection` nem `lists-bottom`: os dois cercam essa seção no
 * canônico, e sem ela ficariam colados no hero, o que o slot map proíbe.
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
        <AdSlot className="op-slot--lists-top" id="lists-top" />
        <ListsPanel />
        <AdSlot className="op-slot--lists-billboard" id="lists-billboard" />
      </div>
    </main>
  )
}
