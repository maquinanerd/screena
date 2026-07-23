/**
 * reports.ts — Planner puro de DENUNCIAS de review (Backend C, unidade C5B).
 *
 * PURO: sem rede, sem DB, sem relogio (createdAt e DB-default; a projecao
 * interna recebe a data ja persistida). Uma denuncia SINALIZA — nunca decide
 * sozinha nem oculta a review automaticamente (isso e MODERACAO, moderation.ts).
 *
 * DEDUP: o unique real e `(review_id, reporter_id)` — um denunciante denuncia
 * uma review no maximo UMA vez (independe do motivo). Re-denuncia = noop
 * idempotente.
 *
 * POLICY_GAP: as decisoes de produto nao definem se o AUTOR pode denunciar a
 * propria review. Escolha conservadora fail-closed: o autor NAO denuncia a
 * propria review (evita ruido/abuso). Registrado para decisao humana.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import { REPORT_REASONS, type ReportReason, type ReportStatus, type UserStatus } from "../core/types.js";
import { assertCanMutate } from "../privacy/deletion.js";
import { validateReport } from "./moderation.js";
import type { ReportPlan } from "./types.js";

export interface PlanCreateReportInput {
  readonly reporterStatus: UserStatus;
  readonly reporterId: bigint;
  readonly reviewId: bigint;
  /** Autor da review-alvo (para bloquear auto-denuncia). */
  readonly reviewAuthorId: bigint;
  /** A review-alvo existe? (a persistencia informa; evita denuncia fantasma). */
  readonly reviewExists: boolean;
  readonly reason: string;
  readonly detail?: string;
  /** Este denunciante ja denunciou esta review? (unique review+reporter). */
  readonly hasExistingReport: boolean;
}

/**
 * Planeja criar uma denuncia. Ordem fail-closed: gate de conta -> existencia da
 * review -> anti-auto-denuncia -> validacao de ids/motivo -> dedup -> plano.
 * Denuncia nova NUNCA oculta a review: nasce sempre `open`.
 */
export function planCreateReport(input: PlanCreateReportInput): DomainResult<ReportPlan> {
  const accountCheck = assertCanMutate(input.reporterStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  if (!input.reviewExists) {
    return err("not_found", "review nao encontrada.");
  }

  if (input.reporterId === input.reviewAuthorId) {
    return err("forbidden", "o autor nao pode denunciar a propria review.");
  }

  const errors: string[] = [];
  if (input.reporterId <= 0n) {
    errors.push("reporterId invalido: deve ser um identificador positivo.");
  }
  if (input.reviewId <= 0n) {
    errors.push("reviewId invalido: deve ser um identificador positivo.");
  }
  errors.push(...validateReport({ reason: input.reason, detail: input.detail }).errors);
  if (errors.length > 0) {
    return err("validation_failed", "denuncia invalida.", errors);
  }

  const reason = input.reason as ReportReason;
  const detail = input.detail ?? null;

  // Dedup idempotente: mesma review + mesmo denunciante = noop (unique real).
  if (input.hasExistingReport) {
    return ok({
      kind: "noop",
      reviewId: input.reviewId,
      reporterId: input.reporterId,
      reason,
      detail,
      status: "open",
    });
  }

  return ok({
    kind: "report",
    reviewId: input.reviewId,
    reporterId: input.reporterId,
    reason,
    detail,
    status: "open",
  });
}

/** Denuncia JA persistida (entrada da projecao interna de moderacao). */
export interface StoredReport {
  readonly reason: ReportReason;
  readonly detail: string | null;
  readonly status: ReportStatus;
  readonly createdAt: Date;
}

/** Visao INTERNA minima de moderacao — NUNCA exposta ao autor nem ao publico. */
export interface InternalReportView {
  readonly reason: ReportReason;
  readonly detail: string | null;
  readonly status: ReportStatus;
  /** ISO 8601 UTC; nunca Date mutavel. */
  readonly createdAt: string;
}

/**
 * Projecao interna minima de uma denuncia para a fila de moderacao (contexto
 * autorizado futuro). NAO inclui a identidade do denunciante (reporterId nunca
 * e exposto — nem ao autor nem no agregado).
 */
export function projectReportForModeration(report: StoredReport): InternalReportView {
  return {
    reason: report.reason,
    detail: report.detail,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
  };
}

/** Resumo INTERNO agregado de denuncias (contexto de moderacao autorizado). */
export interface ReportSummary {
  readonly total: number;
  readonly open: number;
  readonly byReason: Record<ReportReason, number>;
}

/**
 * Sumariza denuncias de uma review para a moderacao: contagem total, abertas e
 * por motivo. DETERMINISTICO e independente da ordem de entrada. NAO expoe
 * identidade de denunciante nem faz ranking — apenas contagens neutras.
 */
export function summarizeReports(reports: ReadonlyArray<StoredReport>): ReportSummary {
  const byReason = {} as Record<ReportReason, number>;
  for (const reason of REPORT_REASONS) {
    byReason[reason] = 0;
  }
  let open = 0;
  for (const report of reports) {
    byReason[report.reason] += 1;
    if (report.status === "open") {
      open += 1;
    }
  }
  return { total: reports.length, open, byReason };
}
