import type { ReactNode } from "react";

import { DailyBars } from "../../src/components/ops/charts";
import { Metric, Section, Stamp, Undetermined } from "../../src/components/ops/measured";
import { utcDayList } from "../../src/lib/ops/describe";
import { formatInt, formatPercent } from "../../src/lib/ops/format";
import {
  headlineCoverage,
  latestSnapshotDay,
  measureCoverageLive,
  readCoverageSnapshots,
} from "../../src/server/ops/coverage";

/**
 * Cobertura — por tipo de entidade, quanto tem titulo, sinopse, poster, trailer,
 * nota exibivel e indexacao; a serie diaria; e o recorte por idioma original.
 *
 * O padrao e o RETRATO diario (barato). "Medir agora" roda a medida ao vivo, com
 * teto de 60 s por consulta: estourou, a tela diz nao determinado.
 */
export const dynamic = "force-dynamic";

const KIND_LABELS: Readonly<Record<string, string>> = {
  movie: "Filmes",
  tv: "Séries",
  season: "Temporadas",
  episode: "Episódios",
  person: "Pessoas",
};

const COLUMNS = [
  ["withTitle", "Título"],
  ["withSynopsis", "Sinopse / biografia"],
  ["withPoster", "Pôster / still / foto"],
  ["withTrailer", "Trailer exibível"],
  ["withDisplayableRating", "Nota exibível"],
  ["indexable", "Indexável"],
] as const;

interface Row {
  readonly entityKind: string;
  readonly originalLanguage: string;
  readonly total: number;
  readonly withTitle: number | null;
  readonly withSynopsis: number | null;
  readonly withPoster: number | null;
  readonly withTrailer: number | null;
  readonly withDisplayableRating: number | null;
  readonly indexable: number | null;
}

function Cell({ value, total, metric }: { readonly value: number | null; readonly total: number; readonly metric: string }): ReactNode {
  if (value === null) return <td className="ops-muted">não se aplica</td>;
  return (
    <td className="num">
      <Metric name={metric}>{formatInt(value)}</Metric>
      <br />
      <span className="ops-stamp">{formatPercent(value, total)}</span>
    </td>
  );
}

function CoverageTable({ rows, label }: { readonly rows: readonly Row[]; readonly label: string }): ReactNode {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table" data-table={label}>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Idioma original</th>
            <th className="num">Total</th>
            {COLUMNS.map(([, title]) => (
              <th key={title} className="num">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.entityKind}-${row.originalLanguage}`}>
              <td>{KIND_LABELS[row.entityKind] ?? row.entityKind}</td>
              <td className="ops-mono">{row.originalLanguage === "*" ? "todos" : row.originalLanguage === "?" ? "sem idioma" : row.originalLanguage}</td>
              <td className="num">
                <Metric name={`coverage.${row.entityKind}.${row.originalLanguage}.total`}>{formatInt(row.total)}</Metric>
              </td>
              {COLUMNS.map(([key]) => (
                <Cell key={key} value={row[key]} total={row.total} metric={`coverage.${row.entityKind}.${row.originalLanguage}.${key}`} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const query = await searchParams;
  const now = new Date();
  const live = query.medir === "agora";
  const snapshots = await readCoverageSnapshots(now, 30);
  const measurement = live ? await measureCoverageLive(now) : null;

  const latest = snapshots.ok ? latestSnapshotDay(snapshots.value) : [];
  const shownRows: readonly Row[] | null =
    measurement !== null ? (measurement.ok ? measurement.value.rows : null) : latest.length > 0 ? latest : null;
  const days = utcDayList(now, 30);

  return (
    <>
      <h1 className="ops-page-title">Cobertura</h1>
      <p className="ops-lede">
        Cada coluna usa o portão que a página usa: trailer pelo gate da linha de tmdb_videos, nota pelo gate de leitura
        (decisão vigente, licença-mãe, frescor e crédito), biografia pelo texto E pela licença, indexável por slug canônico
        pt-BR sem decisão mais restritiva. Temporada e episódio estão suspensos do índice e contam zero indexável.
      </p>
      <p>
        {live ? (
          <a className="ops-link-button" href="/cobertura">
            Voltar ao retrato diário
          </a>
        ) : (
          <a className="ops-link-button" href="/cobertura?medir=agora" data-action-link="medir-cobertura">
            Medir agora (consulta pesada, até 60 s por tipo)
          </a>
        )}
      </p>

      <Section title={measurement !== null ? "Medida ao vivo" : "Último retrato diário"}>
        {measurement !== null && !measurement.ok ? (
          <p>
            <Undetermined reason={measurement.reason} />
            <Stamp source={measurement.source} measuredAt={measurement.measuredAt} />
          </p>
        ) : shownRows === null ? (
          <p>
            <Undetermined
              reason={snapshots.ok ? "a fila catalog_coverage ainda não gravou nenhum retrato nos últimos 30 dias" : snapshots.reason}
            />
            <Stamp source={snapshots.source} measuredAt={snapshots.measuredAt} />
          </p>
        ) : (
          <>
            <CoverageTable rows={shownRows.filter((row) => row.originalLanguage === "*")} label="cobertura-total" />
            {measurement !== null && measurement.ok ? (
              <Stamp source={`${measurement.source} · ${measurement.value.methodVersion}`} measuredAt={measurement.measuredAt} />
            ) : latest[0] !== undefined ? (
              <Stamp source={`catalog_coverage_snapshots (${latest[0].methodVersion}, retrato de ${latest[0].capturedOn})`} measuredAt={latest[0].capturedAt} />
            ) : null}
            <Section title="Por idioma original (filmes e séries)">
              <CoverageTable
                rows={shownRows.filter((row) => row.originalLanguage !== "*" && (row.entityKind === "movie" || row.entityKind === "tv"))}
                label="cobertura-idioma"
              />
            </Section>
          </>
        )}
      </Section>

      <Section title="Série diária (retratos dos últimos 30 dias)" note="Dia sem retrato fica sem barra: não é zero, é dia em que a fila não gravou.">
        {!snapshots.ok ? (
          <p>
            <Undetermined reason={snapshots.reason} />
            <Stamp source={snapshots.source} measuredAt={snapshots.measuredAt} />
          </p>
        ) : (
          <>
            {(
              [
                ["withSynopsis", "Filmes e séries com sinopse"],
                ["withDisplayableRating", "Filmes e séries com nota exibível"],
                ["withTrailer", "Filmes e séries com trailer exibível"],
              ] as const
            ).map(([key, title]) => (
              <DailyBars
                key={key}
                title={title}
                unit="títulos"
                points={days.map((day) => {
                  const headline = headlineCoverage(snapshots.value.filter((row) => row.capturedOn === day));
                  return { day, value: headline === null ? null : headline[key] };
                })}
              />
            ))}
            <div className="ops-table-wrap">
              <table className="ops-table" data-table="cobertura-historico">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Tipo</th>
                    <th className="num">Total</th>
                    {COLUMNS.map(([, title]) => (
                      <th key={title} className="num">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.value
                    .filter((row) => row.originalLanguage === "*")
                    .map((row) => (
                      <tr key={`${row.capturedOn}-${row.entityKind}`}>
                        <td className="nowrap">{row.capturedOn}</td>
                        <td>{KIND_LABELS[row.entityKind] ?? row.entityKind}</td>
                        <td className="num">{formatInt(row.total)}</td>
                        {COLUMNS.map(([key]) => (
                          <Cell key={key} value={row[key]} total={row.total} metric={`coverage.history.${row.capturedOn}.${row.entityKind}.${key}`} />
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Stamp source={snapshots.source} measuredAt={snapshots.measuredAt} />
          </>
        )}
      </Section>
    </>
  );
}
