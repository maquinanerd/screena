import type { ReactNode } from "react";

/**
 * badges.tsx — Selos com TEXTO. A cor e apoio; o rotulo e o sinal.
 */

/** O tom de um selo. */
export type Tone = "red" | "green" | "amber" | "neutral";

export function Badge({ tone, children, title }: { readonly tone: Tone; readonly children: ReactNode; readonly title?: string }): ReactNode {
  return (
    <span className={`ops-badge ops-badge--${tone}`} title={title} data-tone={tone}>
      {children}
    </span>
  );
}

/** Filme = vermelho, serie = verde, sempre com o nome escrito. */
export function VerticalBadge({ kind }: { readonly kind: "movie" | "tv" }): ReactNode {
  return (
    <span className={`ops-vertical ops-vertical--${kind}`} data-vertical={kind}>
      {kind === "movie" ? "Filme" : "Série"}
    </span>
  );
}
