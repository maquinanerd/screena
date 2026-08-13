import type { ReactNode } from 'react'

/**
 * WatchPlatformLine — UMA plataforma e as modalidades dela, em TEXTO VISIVEL.
 *
 * PRESENTACIONAL e PURO. Existe para que o destaque do `/pt/explorar` tenha a
 * mesma garantia que as outras tres superficies: a modalidade e um NO DE TEXTO,
 * nunca `aria-label`, `title` ou `data-*`. Um `data-modality` seria invisivel
 * para quem enxerga — foi assim que a #165 passou quatro assercoes medindo
 * markup cru em vez de texto renderizado.
 *
 * Uma linha por PLATAFORMA (nunca uma por oferta): "Prime Video · Assinatura ·
 * Aluguel" e melhor que duas entradas da mesma marca, que e o defeito do hub
 * duplicado com outra roupa.
 *
 * NUNCA logo: a licenca do agregador da `logo_allowed = false`. So texto.
 */
export function WatchPlatformLine({
  name,
  modalityLabels,
}: {
  /** Nome CANONICO da plataforma (nunca o nome do fornecedor tecnico). */
  name: string
  /** Rotulos pt-BR ja na ordem canonica (incluso antes do que custa). */
  modalityLabels: readonly string[]
}): ReactNode {
  return (
    <span className="disc-feature__provider">
      <span className="disc-feature__provider-name">{name}</span>
      {modalityLabels.map((label) => (
        <span className="disc-feature__provider-modality" key={label}>
          {' · '}
          {label}
        </span>
      ))}
    </span>
  )
}
