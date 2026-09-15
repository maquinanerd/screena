import type { ReactNode } from "react";

import { formatInt } from "../../lib/ops/format";

/**
 * charts.tsx — Grafico SO para serie temporal. SVG inline, sem biblioteca.
 *
 * Dia sem registro fica SEM BARRA e com um tique no eixo: sem registro nao e
 * zero, e desenhar uma barra de altura zero diria que foi.
 */

/** Um dia da serie. `value: null` = nenhum registro naquele dia. */
export interface DailyPoint {
  readonly day: string;
  readonly value: number | null;
  readonly red?: boolean;
}

function dayLabel(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function DailyBars({
  points,
  limit = null,
  title,
  unit,
  emptyMeansZero = false,
}: {
  readonly points: readonly DailyPoint[];
  readonly limit?: number | null;
  readonly title: string;
  readonly unit: string;
  /** `true` quando a fonte e a propria tabela (dia sem linha E zero). */
  readonly emptyMeansZero?: boolean;
}): ReactNode {
  const width = 960;
  const height = 190;
  const left = 56;
  const right = 10;
  const top = 14;
  const bottom = 26;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const values = points.map((point) => point.value ?? 0);
  const max = Math.max(1, limit ?? 0, ...values);
  const step = innerWidth / Math.max(1, points.length);
  const barWidth = Math.max(2, step * 0.72);
  const y = (value: number): number => top + innerHeight - (Math.max(0, value) / max) * innerHeight;
  const baseline = top + innerHeight;
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  return (
    <figure style={{ margin: "6px 0 12px" }}>
      <svg className="ops-chart" viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={`${title} — série diária`}>
        <line className="ops-chart__grid" x1={left} x2={width - right} y1={top} y2={top} />
        <line className="ops-chart__axis" x1={left} x2={width - right} y1={baseline} y2={baseline} />
        <text className="ops-chart__label" x={4} y={top + 10}>
          {formatInt(max)}
        </text>
        <text className="ops-chart__label" x={4} y={baseline}>
          0
        </text>
        {limit !== null ? (
          <line className="ops-chart__line ops-chart__line--limit" x1={left} x2={width - right} y1={y(limit)} y2={y(limit)} />
        ) : null}
        {points.map((point, index) => {
          const x = left + index * step + (step - barWidth) / 2;
          if (point.value === null && !emptyMeansZero) {
            return (
              <line key={point.day} className="ops-chart__axis" x1={x + barWidth / 2} x2={x + barWidth / 2} y1={baseline - 4} y2={baseline + 4}>
                <title>{`${dayLabel(point.day)}: sem registro`}</title>
              </line>
            );
          }
          const value = point.value ?? 0;
          return (
            <rect
              key={point.day}
              className={`ops-chart__bar${point.red === true ? " ops-chart__bar--red" : ""}`}
              x={x}
              y={y(value)}
              width={barWidth}
              height={Math.max(0, baseline - y(value))}
            >
              <title>{`${dayLabel(point.day)}: ${formatInt(value)} ${unit}`}</title>
            </rect>
          );
        })}
        {points.map((point, index) =>
          index % labelEvery === 0 || index === points.length - 1 ? (
            <text key={`l-${point.day}`} className="ops-chart__label" x={left + index * step + 2} y={height - 8}>
              {dayLabel(point.day)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="ops-stamp">
        {title} ({unit}, por dia UTC).{" "}
        {emptyMeansZero ? "Dia sem linha é zero." : "Dia sem registro aparece como tique, sem barra: não é zero."}
        {limit !== null ? ` Linha tracejada: teto de ${formatInt(limit)}.` : ""}
      </figcaption>
    </figure>
  );
}
