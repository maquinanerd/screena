/**
 * <AdSlot id> — a posicao OpaPreco que a pagina declara. SERVER component.
 *
 * Substitui o AdSlot do AdSense (removido por completo em 2026-10-30). A pagina
 * diz SO o id e as tags; o registro (`src/lib/opapreco/slots.ts`) diz o
 * componente e a reserva. `className` leva as margens da pagina e fica na raiz
 * do slot, para que a margem suma junto quando o slot colapsar.
 *
 * Desligado (sem `OPAPRECO_*` no ambiente — o padrao): devolve `null` e a
 * pagina sai como se o slot nao existisse. A leitura do ambiente e por
 * requisicao, como a da newsletter do rodape.
 *
 * Ligado: o HTML do servidor leva a raiz `data-op-slot` com a reserva da faixa
 * de viewport e o skeleton; o anuncio vem pelo navegador (ver
 * `ad-slot-client.tsx` — a invariante 3 proibe chamar o ad server no render).
 */

import type { ReactNode } from 'react'

import { isOpaPrecoEnabled } from '../../../src/lib/opapreco/config'
import type { OpSlotId, OpSlotTags } from '../../../src/lib/opapreco/slots'
import { AdSlotClient } from './ad-slot-client'

export interface AdSlotProps {
  readonly id: OpSlotId
  readonly tags?: OpSlotTags
  readonly className?: string
}

export function AdSlot({ className, id, tags }: AdSlotProps): ReactNode {
  if (!isOpaPrecoEnabled()) return null
  return <AdSlotClient className={className} id={id} tags={tags} />
}
