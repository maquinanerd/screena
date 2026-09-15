/**
 * coverage.ts — A cobertura do catalogo: o retrato diario e a medida ao vivo.
 * SERVER-ONLY.
 *
 * As duas usam a MESMA consulta (`@screena/sync/coverage`), que usa o portao que a
 * pagina usa em cada coluna. O retrato e barato de ler; a medida ao vivo varre
 * milhoes de episodios e so roda quando o dono pede, com teto de tempo — estourou,
 * a tela diz "nao determinado", nunca um numero pela metade.
 */

import {
  COVERAGE_ALL_LANGUAGES,
  measureCatalogCoverage,
  type CoverageKind,
  type CoverageMeasurement,
  type CoverageRow,
} from "@screena/sync/coverage";

import { measure, type Measured } from "../../lib/ops/measure";
import { DAY_MS, isoDay, num, numOrNull, opsDb } from "./db";

/** Uma linha de retrato. */
export interface CoverageSnapshotRow extends CoverageRow {
  readonly capturedOn: string;
  readonly capturedAt: Date;
  readonly methodVersion: string;
}

interface RawSnapshot {
  readonly captured_on: Date;
  readonly captured_at: Date;
  readonly method_version: string;
  readonly entity_kind: string;
  readonly original_language: string;
  readonly total: unknown;
  readonly with_title: unknown;
  readonly with_synopsis: unknown;
  readonly with_poster: unknown;
  readonly with_trailer: unknown;
  readonly with_displayable_rating: unknown;
  readonly indexable: unknown;
}

const KINDS: readonly CoverageKind[] = ["movie", "tv", "season", "episode", "person"];

function toKind(value: string): CoverageKind | null {
  return (KINDS as readonly string[]).includes(value) ? (value as CoverageKind) : null;
}

/** Os retratos dos ultimos `days` dias, do mais novo ao mais antigo. */
export async function readCoverageSnapshots(now: Date, days: number): Promise<Measured<readonly CoverageSnapshotRow[]>> {
  return measure(
    "catalog_coverage_snapshots",
    async () => {
      const since = isoDay(new Date(now.getTime() - days * DAY_MS));
      const rows = await opsDb().$queryRaw<RawSnapshot[]>`
        SELECT captured_on, captured_at, method_version, entity_kind, original_language, total,
               with_title, with_synopsis, with_poster, with_trailer, with_displayable_rating, indexable
          FROM catalog_coverage_snapshots
         WHERE captured_on >= ${since}::date
         ORDER BY captured_on DESC, entity_kind, original_language`;
      const out: CoverageSnapshotRow[] = [];
      for (const row of rows) {
        const kind = toKind(row.entity_kind);
        if (kind === null) continue;
        out.push({
          capturedOn: isoDay(row.captured_on),
          capturedAt: row.captured_at,
          methodVersion: row.method_version,
          entityKind: kind,
          originalLanguage: row.original_language,
          total: num(row.total),
          withTitle: numOrNull(row.with_title),
          withSynopsis: numOrNull(row.with_synopsis),
          withPoster: numOrNull(row.with_poster),
          withTrailer: numOrNull(row.with_trailer),
          withDisplayableRating: numOrNull(row.with_displayable_rating),
          indexable: numOrNull(row.indexable),
        });
      }
      return out;
    },
    () => now,
  );
}

/** A medida ao vivo (pesada). Teto de 60 s por consulta. */
export async function measureCoverageLive(now: Date): Promise<Measured<CoverageMeasurement>> {
  return measure(
    "medida ao vivo (coverage/v1 sobre movies, tv_shows, seasons, episodes, people)",
    () => measureCatalogCoverage(opsDb(), now, { statementTimeoutMs: 60_000 }),
    () => now,
  );
}

/** Os tres numeros da visao geral, somando filme e serie. */
export interface HeadlineCoverage {
  readonly titles: number;
  readonly withSynopsis: number;
  readonly withDisplayableRating: number;
  readonly withTrailer: number;
}

/** Soma filme + serie nas linhas de total (`*`). `null` se faltar um dos dois. */
export function headlineCoverage(rows: readonly CoverageRow[]): HeadlineCoverage | null {
  const movie = rows.find((row) => row.entityKind === "movie" && row.originalLanguage === COVERAGE_ALL_LANGUAGES);
  const tv = rows.find((row) => row.entityKind === "tv" && row.originalLanguage === COVERAGE_ALL_LANGUAGES);
  if (movie === undefined || tv === undefined) return null;
  return {
    titles: movie.total + tv.total,
    withSynopsis: (movie.withSynopsis ?? 0) + (tv.withSynopsis ?? 0),
    withDisplayableRating: (movie.withDisplayableRating ?? 0) + (tv.withDisplayableRating ?? 0),
    withTrailer: (movie.withTrailer ?? 0) + (tv.withTrailer ?? 0),
  };
}

/** O retrato mais recente (todas as linhas do dia mais novo). */
export function latestSnapshotDay(rows: readonly CoverageSnapshotRow[]): readonly CoverageSnapshotRow[] {
  const newest = rows[0]?.capturedOn;
  if (newest === undefined) return [];
  return rows.filter((row) => row.capturedOn === newest);
}
