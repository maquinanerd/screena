import type { ReactNode } from 'react'

import type { WatchAvailabilityView } from '../../src/lib/watch-availability-presenter'
import { WATCH_ANCHOR_ID, watchBrandsRow, watchShortcutLabel } from '../../src/lib/watch-brands-row'

/**
 * Atalho "Onde assistir" no TOPO da ficha (filme e série).
 *
 * Uma linha só, que nomeia até duas marcas e leva à tira de serviços logo
 * abaixo do mosaico (`#onde-assistir`). Não tem logo, modalidade nem link de
 * saída: isso continua vivendo SÓ na tira, que é onde a licença de cada marca
 * é aplicada. Aqui é um índice, não uma oferta. Ver `watchShortcutLabel`.
 *
 * Recebe a MESMA `WatchAvailabilityView` já licenciada que a tira recebe e
 * passa pela mesma derivação (`watchBrandsRow`): nunca cita um serviço que a
 * tira não mostra, e nenhuma plataforma chega aqui sem o gate de licença.
 */
export function WatchShortcut({ view }: { view: WatchAvailabilityView }): ReactNode {
  const label = watchShortcutLabel(watchBrandsRow(view))
  if (label === null) return null
  return (
    <a className="watch-shortcut" href={`#${WATCH_ANCHOR_ID}`}>
      <span className="watch-shortcut__kicker">Onde assistir</span>
      <span className="watch-shortcut__names">{label}</span>
      <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
        <path d="M12 5v14m0 0-6-6m6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      </svg>
    </a>
  )
}
