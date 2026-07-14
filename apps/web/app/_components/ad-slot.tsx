import type { CSSProperties, ReactNode } from "react";

import { allowHomeVisualPlaceholders } from "../../src/lib/home-placeholder-governance";

export type AdSlotVariant = "leaderboard" | "billboard" | "skyscraper" | "rectangle";

interface AdSlotProps {
  readonly label?: string;
  readonly margin?: string;
  readonly variant?: AdSlotVariant;
}

const AD_SIZES: Readonly<Record<AdSlotVariant, { width: number; height: number }>> = {
  leaderboard: { width: 728, height: 90 },
  billboard: { width: 970, height: 250 },
  skyscraper: { width: 300, height: 600 },
  rectangle: { width: 300, height: 250 },
};

/**
 * Reserva as dimensões exatas do `AdSlot.dc.html` sem instalar runtime externo.
 * O traço e o texto de diagnóstico aparecem somente em dev/preview; produção
 * conserva o espaço para evitar CLS até existir uma unidade AdSense aprovada.
 */
export function AdSlot({
  label = "Publicidade",
  margin = "0",
  variant = "leaderboard",
}: AdSlotProps): ReactNode {
  const size = AD_SIZES[variant];
  const showDiagnostic = allowHomeVisualPlaceholders();
  const style: CSSProperties = {
    margin,
  };

  return (
    <aside
      aria-label={label === "" ? "Anúncio" : label}
      className="cinematic-ad"
      data-ad-state={showDiagnostic ? "placeholder" : "reserved"}
      data-ad-variant={variant}
      style={style}
    >
      {label !== "" ? <span className="cinematic-ad__label">{label}</span> : null}
      <span aria-hidden="true" className="cinematic-ad__box">
        {showDiagnostic ? (
          <>
            <strong>
              Google AdSense · {size.width}×{size.height}
            </strong>
            <span>Anúncio</span>
          </>
        ) : null}
      </span>
    </aside>
  );
}
