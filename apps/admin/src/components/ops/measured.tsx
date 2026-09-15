import type { ReactNode } from "react";

import { formatDateTimeBrt } from "../../lib/ops/format";
import type { Measured } from "../../lib/ops/measure";

/**
 * measured.tsx — O CARIMBO unico do painel: valor · fonte · momento.
 *
 * Todo numero do painel operacional passa por aqui. A medida que falhou vira
 * "nao determinado" com o motivo — nunca zero, nunca traco, nunca o ultimo valor
 * conhecido.
 */

/** fonte · momento. */
export function Stamp({ source, measuredAt }: { readonly source: string; readonly measuredAt: Date }): ReactNode {
  return (
    <span className="ops-stamp">
      fonte: <span className="ops-stamp__source">{source}</span> · medido em {formatDateTimeBrt(measuredAt)}
    </span>
  );
}

/** A medida que nao pode ser apurada. */
export function Undetermined({ reason }: { readonly reason: string }): ReactNode {
  return (
    <span className="ops-undetermined" data-undetermined="true">
      não determinado
      <span className="ops-undetermined__reason">{reason}</span>
    </span>
  );
}

/** Mostra o valor (ou "nao determinado") e o carimbo. */
export function MeasuredView<T>({
  m,
  children,
  stamp = true,
}: {
  readonly m: Measured<T>;
  readonly children: (value: T) => ReactNode;
  readonly stamp?: boolean;
}): ReactNode {
  return (
    <>
      {m.ok ? children(m.value) : <Undetermined reason={m.reason} />}
      {stamp ? <Stamp source={m.source} measuredAt={m.measuredAt} /> : null}
    </>
  );
}

/** Um numero grande. */
export function Stat({
  label,
  children,
  sub,
  red = false,
  metric,
  footer,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly sub?: ReactNode;
  readonly red?: boolean;
  readonly metric?: string;
  readonly footer?: ReactNode;
}): ReactNode {
  return (
    <div className={`ops-stat${red ? " ops-stat--red" : ""}`} data-metric-card={metric}>
      <div className="ops-stat__label">
        {label}
        {red ? " — VERMELHO" : ""}
      </div>
      <div className="ops-stat__value">{children}</div>
      {sub === undefined ? null : <div className="ops-stat__sub">{sub}</div>}
      {footer}
    </div>
  );
}

/** Um valor numerico marcado para o validador ler (`data-metric`). */
export function Metric({ name, children }: { readonly name: string; readonly children: ReactNode }): ReactNode {
  return <span data-metric={name}>{children}</span>;
}

/** Titulo de secao com nota curta. */
export function Section({
  title,
  note,
  children,
  id,
}: {
  readonly title: string;
  readonly note?: ReactNode;
  readonly children: ReactNode;
  readonly id?: string;
}): ReactNode {
  return (
    <section className="ops-section" id={id}>
      <h2 className="ops-section__title">{title}</h2>
      {note === undefined ? null : <p className="ops-section__note">{note}</p>}
      {children}
    </section>
  );
}
