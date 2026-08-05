'use client'

/**
 * MediaUsabilityCell — o estado de liberacao da midia, na LISTA e no SELETOR.
 *
 * O seletor de imagem do Payload reusa as colunas da collection. Trocar a
 * coluna crua de `licenseStatus` por esta faz a resposta aparecer onde a escolha
 * acontece: hoje da para vincular uma midia bloqueada e so descobrir na
 * publicacao, com a legenda ja escrita.
 *
 * NAO decide nada: `mediaUsability` decide, e ela e pura e testada. Este arquivo
 * so desenha — que e o unico jeito de a regra ter teste, porque o vitest deste
 * app nao coleta `.tsx`.
 *
 * O estado NUNCA depende so da cor: o rotulo esta escrito por extenso, o motivo
 * vem no `title`, e `data-tone` carrega o codigo para quem inspeciona.
 */

import React from 'react'

import { mediaUsability } from './media-usability.js'

interface CellProps {
  /** A linha inteira da lista — e dela que saem os fatos de licenca. */
  readonly rowData?: Record<string, unknown>
}

export default function MediaUsabilityCell({ rowData }: CellProps): React.JSX.Element {
  const verdict = mediaUsability({
    licenseStatus: rowData?.licenseStatus,
    allowedForEditorial: rowData?.allowedForEditorial,
    allowedForHero: rowData?.allowedForHero,
  })

  return (
    <span
      className={`cinerie-media-usability is-${verdict.tone}`}
      data-tone={verdict.tone}
      title={verdict.detail ?? undefined}
    >
      {verdict.label}
    </span>
  )
}
