import type { ReactNode } from "react";

/**
 * CertificationBadge — chip da CLASSIFICACAO INDICATIVA (advisory de conteudo:
 * "14", "16", "L", "TV-MA").
 *
 * PRESENTACIONAL e PURO: recebe `value` ja resolvido pelo presenter e so produz
 * JSX. Nao importa @screena/db nem faz IO.
 *
 * Governanca: classificacao indicativa NAO e nota nem rating source — nunca se
 * mistura com IMDb/Rotten Tomatoes nem vira AggregateRating. E apenas um aviso
 * de conteudo. Segue o padrao compacto bordado do design v4.
 */

interface CertificationBadgeProps {
  /** Rotulo da classificacao (ex.: "14", "16", "L", "TV-MA"). */
  value: string;
  /** Classe extra opcional. */
  className?: string;
}

export function CertificationBadge({
  value,
  className,
}: CertificationBadgeProps): ReactNode {
  return (
    <span
      className={`sc-cert${className ? ` ${className}` : ""}`}
      aria-label={`Classificação indicativa: ${value}`}
    >
      {value}
    </span>
  );
}
