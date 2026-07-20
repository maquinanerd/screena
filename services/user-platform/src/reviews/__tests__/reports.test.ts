/**
 * Testes de DENUNCIAS de review: planCreateReport (report/noop), gate de conta,
 * anti-auto-denuncia, dedup idempotente (unique review+denunciante), e as
 * projecoes internas (nunca expoem a identidade do denunciante).
 */

import { describe, expect, it } from "vitest";
import type { UserStatus } from "../../core/types.js";
import {
  planCreateReport,
  projectReportForModeration,
  type StoredReport,
  summarizeReports,
} from "../reports.js";

function reportInput(overrides: Partial<Parameters<typeof planCreateReport>[0]> = {}) {
  return {
    reporterStatus: "active" as UserStatus,
    reporterId: 7n,
    reviewId: 100n,
    reviewAuthorId: 9n,
    reviewExists: true,
    reason: "spam",
    hasExistingReport: false,
    ...overrides,
  };
}

const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

describe("planCreateReport", () => {
  it("(1) denuncia valida produz report com status open (nao oculta a review)", () => {
    const result = planCreateReport(reportInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("report");
      expect(result.value.status).toBe("open");
      // O plano de denuncia NAO carrega mudanca de estado da review.
      expect(Object.keys(result.value)).not.toContain("reviewStatus");
    }
  });

  it("(2) reason invalida e rejeitada (validation_failed)", () => {
    const result = planCreateReport(reportInput({ reason: "inventada" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_failed");
  });

  it("(3) conta bloqueada nao denuncia (forbidden)", () => {
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const result = planCreateReport(reportInput({ reporterStatus: status }));
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    }
  });

  it("(4) denuncia duplicada (mesmo denunciante+review) produz noop", () => {
    const result = planCreateReport(reportInput({ hasExistingReport: true }));
    expect(result.ok && result.value.kind).toBe("noop");
  });

  it("(5) autor nao denuncia a propria review (forbidden)", () => {
    const result = planCreateReport(reportInput({ reporterId: 9n, reviewAuthorId: 9n }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });

  it("(6) review inexistente falha (not_found)", () => {
    const result = planCreateReport(reportInput({ reviewExists: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("(7) ids nao positivos sao rejeitados", () => {
    expect(planCreateReport(reportInput({ reporterId: 0n })).ok).toBe(false);
    expect(planCreateReport(reportInput({ reviewId: -1n })).ok).toBe(false);
  });
});

describe("projectReportForModeration", () => {
  it("(8) projecao interna nao expoe reporterId; data em ISO UTC", () => {
    const stored: StoredReport = {
      reason: "harassment",
      detail: "detalhe",
      status: "open",
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
    };
    const view = projectReportForModeration(stored);
    expect(stable(view).includes("reporterId")).toBe(false);
    expect(view.createdAt).toBe("2026-07-20T00:00:00.000Z");
    expect(view.reason).toBe("harassment");
  });
});

describe("summarizeReports", () => {
  const reports: StoredReport[] = [
    { reason: "spam", detail: null, status: "open", createdAt: new Date("2026-07-01T00:00:00Z") },
    { reason: "spam", detail: null, status: "dismissed", createdAt: new Date("2026-07-02T00:00:00Z") },
    { reason: "harassment", detail: null, status: "open", createdAt: new Date("2026-07-03T00:00:00Z") },
  ];

  it("(9) conta total/abertas/por-motivo; vazio retorna zeros", () => {
    const summary = summarizeReports(reports);
    expect(summary.total).toBe(3);
    expect(summary.open).toBe(2);
    expect(summary.byReason.spam).toBe(2);
    expect(summary.byReason.harassment).toBe(1);
    const empty = summarizeReports([]);
    expect(empty.total).toBe(0);
    expect(empty.byReason.spam).toBe(0);
  });

  it("(10) ordem de entrada NAO altera o resumo agregado", () => {
    expect(stable(summarizeReports(reports))).toEqual(stable(summarizeReports([...reports].reverse())));
  });
});
