import type { ReactNode } from "react";

export type ScreenLogoAccent = "movie" | "series" | "neutral";
export type ScreenLogoInk = "dark" | "light";

interface ScreenLogoProps {
  readonly accent?: ScreenLogoAccent;
  readonly className?: string;
  readonly height: number;
  readonly ink?: ScreenLogoInk;
  readonly label?: string;
  readonly width: number;
}

/**
 * Wordmark do arquivo canônico `Screen Screens v4.dc.html`.
 *
 * O ZIP não contém uma versão em outlines: tanto o HTML validado quanto todos
 * os SVGs de marca em `uploads/` usam quatro glifos `<text>` e a caixa central.
 * Manter o SVG inline faz a Montserrat auto-hospedada da página participar do
 * desenho e preserva exatamente o viewBox e as coordenadas do canônico.
 */
export function ScreenLogo({
  accent = "neutral",
  className,
  height,
  ink = "dark",
  label = "SCREEN",
  width,
}: ScreenLogoProps): ReactNode {
  return (
    <svg
      aria-label={label}
      className={className}
      height={height}
      role="img"
      viewBox="0 0 406 78"
      width={width}
    >
      <text className="screen-logo__glyph" data-ink={ink} x="0" y="62">
        S
      </text>
      <text className="screen-logo__glyph" data-ink={ink} x="79" y="62">
        C
      </text>
      <text className="screen-logo__glyph" data-ink={ink} x="158" y="62">
        R
      </text>
      <rect
        className="screen-logo__box"
        data-accent={accent}
        data-ink={ink}
        height="42"
        rx="4"
        width="81"
        x="239"
        y="20"
      />
      <text className="screen-logo__glyph" data-ink={ink} x="363" y="62">
        N
      </text>
    </svg>
  );
}
