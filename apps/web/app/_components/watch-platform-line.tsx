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
 * O LOGO da plataforma (quando a licenca do provedor declara arquivo presente)
 * vai ANTES do nome, e o nome continua escrito: o logo e decorativo no HTML.
 */
export function WatchPlatformLine({
  name,
  modalityLabels,
  logo = null,
}: {
  /** Nome CANONICO da plataforma (nunca o nome do fornecedor tecnico). */
  name: string
  /** Rotulos pt-BR ja na ordem canonica (incluso antes do que custa). */
  modalityLabels: readonly string[]
  /** Logo declarado pela licenca do provedor; `null` = so o nome. */
  logo?: { readonly src: string; readonly heightPx: number; readonly widthPx: number | null } | null
}): ReactNode {
  return (
    <span className="disc-feature__provider">
      {logo !== null ? (
        <img
          alt=""
          aria-hidden="true"
          className="watch-logo watch-logo--line"
          decoding="async"
          height={logo.heightPx}
          loading="lazy"
          src={logo.src}
          width={logo.widthPx ?? undefined}
        />
      ) : null}
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
