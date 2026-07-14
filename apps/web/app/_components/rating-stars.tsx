import type { ReactNode } from "react";

/**
 * RatingStars — estrelas douradas da NOTA EDITORIAL PROPRIA da cinerie.
 *
 * PRESENTACIONAL e PURO: recebe `value`/`scale` ja validados pelo presenter
 * (`home-hero-presenter`) e so produz JSX. Nao importa @screena/db nem faz IO.
 *
 * Governanca (invariantes 1/2/6): esta nota e a nota editorial do PROPRIO
 * cinerie — nunca uma AggregateRating de terceiro, nunca IMDb/Rotten Tomatoes,
 * nunca convertida entre escalas. O `aria-label` deixa a autoria explicita.
 *
 * A cor dourada vem do token `--accent-star` (design v4), nunca hex hardcoded.
 */

interface RatingStarsProps {
  /** Valor da nota (0 < value <= scale). */
  value: number;
  /** Escala da nota (numero de estrelas). */
  scale: number;
  /** Classe extra opcional. */
  className?: string;
}

/** Formata a nota em pt-BR (ponto -> virgula): 4 -> "4", 4.5 -> "4,5". */
function formatScore(value: number): string {
  return String(value).replace(".", ",");
}

export function RatingStars({ value, scale, className }: RatingStarsProps): ReactNode {
  const safeScale = Number.isInteger(scale) && scale > 0 ? scale : 5;
  const pct = Math.max(0, Math.min(100, (value / safeScale) * 100));
  const stars = "★".repeat(safeScale);
  return (
    <span
      className={`sc-stars${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={`Nota editorial da cinerie: ${formatScore(value)} de ${safeScale}`}
    >
      <span className="sc-stars__track" aria-hidden="true">
        <span className="sc-stars__base">{stars}</span>
        <span className="sc-stars__fill" style={{ width: `${pct}%` }}>
          {stars}
        </span>
      </span>
    </span>
  );
}
