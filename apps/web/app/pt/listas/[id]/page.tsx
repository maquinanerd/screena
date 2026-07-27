import type { Metadata } from 'next'

import { ListDetailPanel } from './list-detail-panel'

/**
 * Detalhe de LISTA (C8) — itens, adicionar/remover e reordenar.
 *
 * Superficie funcional minima. `noindex`: area privada do titular. O ownership
 * e do servidor: conhecer o id na URL nao basta, o servico compara o dono com o
 * titular da sessao.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Lista',
  robots: { index: false, follow: false },
}

export default function Pagina() {
  return (
    <main data-vertical="account">
      <div className="container">
        <ListDetailPanel />
        <p>
          <a href="/pt/listas">Voltar para minhas listas</a>
        </p>
      </div>
    </main>
  )
}
