'use client'

/**
 * OriginCell — a materia diz, na lista, de onde veio.
 *
 * `autoPublished` e o indicador EXPLICITO de automacao: `false` afirmativo numa
 * materia humana, `true` numa autopublicada (`hooks/articles.ts` garante os
 * dois). Na lista, porem, ele aparecia como uma caixa marcada — que nao diz
 * quem operou nem se distingue de qualquer outro checkbox.
 *
 * A celula so LE o que ja esta na linha. Nada e consultado, nada e derivado
 * alem do rotulo.
 */

import React from 'react'

interface OriginCellProps {
  readonly cellData?: unknown
  readonly rowData?: Record<string, unknown>
}

export default function OriginCell({ cellData, rowData }: OriginCellProps): React.ReactElement {
  const automated = cellData === true
  const actor = rowData?.automationActorLabel

  if (!automated) {
    return <span className="cinerie-origin is-human">Redação</span>
  }

  return (
    <span className="cinerie-origin is-automated">
      Automática
      {typeof actor === 'string' && actor.trim() !== '' ? (
        <small> · {actor}</small>
      ) : null}
    </span>
  )
}
