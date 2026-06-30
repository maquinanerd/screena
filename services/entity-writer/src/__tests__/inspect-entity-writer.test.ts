/**
 * inspect-entity-writer.test.ts — Testes da camada PURA de inspecao.
 *
 * Cobre derivacao de contagens, flag de fila acumulada, resumo de erro (truncado),
 * reaplicacao do `limit`, e o repasse dos filtros (entityType/language/limit) ao
 * store via fake em memoria. Sem banco, sem Gemini, sem IO.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ERROR_SUMMARY_MAX,
  buildInspectionReport,
  inspectEntityWriter,
  summarizeError,
  type InspectQuery,
  type InspectStorePort,
  type InspectionData,
} from "../inspect/inspect-entity-writer.js";

/** InspectionData vazio (base para sobrescrever apenas o relevante). */
function emptyData(): InspectionData {
  return {
    jobsByStatus: [],
    jobsByType: [],
    jobsByEntityType: [],
    blocksByReviewStatus: [],
    blocksByBlockType: [],
    blocksBySourceType: [],
    recentFailedJobs: [],
    recentLogErrors: [],
    recentCompletedJobs: [],
    entitiesWithBlocks: [],
  };
}

const QUERY: InspectQuery = { limit: 20, languageCode: "pt-BR" };

describe("buildInspectionReport — contagens de jobs", () => {
  it("deriva contagens, ativos e fila acumulada", () => {
    const data: InspectionData = {
      ...emptyData(),
      jobsByStatus: [
        { key: "queued", count: 3 },
        { key: "running", count: 1 },
        { key: "completed", count: 5 },
        { key: "failed", count: 2 },
      ],
    };
    const report = buildInspectionReport(data, QUERY);
    expect(report.jobs.queued).toBe(3);
    expect(report.jobs.running).toBe(1);
    expect(report.jobs.completed).toBe(5);
    expect(report.jobs.failed).toBe(2);
    expect(report.jobs.active).toBe(4); // queued + claimed(0) + running
    expect(report.jobs.total).toBe(11);
    expect(report.jobs.hasBacklog).toBe(true);
  });

  it("hasBacklog=false quando nao ha jobs queued", () => {
    const data: InspectionData = {
      ...emptyData(),
      jobsByStatus: [{ key: "completed", count: 2 }],
    };
    expect(buildInspectionReport(data, QUERY).jobs.hasBacklog).toBe(false);
  });
});

describe("buildInspectionReport — contagens de blocks", () => {
  it("deriva contagens por review_status (incl. 0 para ausentes)", () => {
    const data: InspectionData = {
      ...emptyData(),
      blocksByReviewStatus: [
        { key: "ai_generated", count: 4 },
        { key: "needs_review", count: 2 },
        { key: "archived", count: 1 },
      ],
    };
    const report = buildInspectionReport(data, QUERY);
    expect(report.blocks.aiGenerated).toBe(4);
    expect(report.blocks.needsReview).toBe(2);
    expect(report.blocks.archived).toBe(1);
    expect(report.blocks.published).toBe(0);
    expect(report.blocks.humanReviewed).toBe(0);
    expect(report.blocks.total).toBe(7);
  });
});

describe("summarizeError — truncamento seguro", () => {
  it("null/undefined -> null", () => {
    expect(summarizeError(null)).toBeNull();
    expect(summarizeError(undefined)).toBeNull();
  });

  it("pega so a 1a linha (descarta stack trace)", () => {
    expect(summarizeError("Boom\n  at foo (x.ts:1)\n  at bar")).toBe("Boom");
  });

  it("trunca mensagens muito longas com reticencias", () => {
    const long = "x".repeat(ERROR_SUMMARY_MAX + 50);
    const out = summarizeError(long);
    expect(out).not.toBeNull();
    expect(out?.length).toBe(ERROR_SUMMARY_MAX);
    expect(out?.endsWith("…")).toBe(true);
  });
});

describe("buildInspectionReport — erro longo e truncado nas listas", () => {
  it("resume lastError e errorMessage", () => {
    const data: InspectionData = {
      ...emptyData(),
      recentFailedJobs: [
        {
          id: "1",
          entityType: "movie",
          entityId: "10",
          languageCode: "pt-BR",
          status: "failed",
          attempts: 2,
          lastError: "Falha de validacao\nstack line 1\nstack line 2",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      recentLogErrors: [
        {
          id: "9",
          jobId: "1",
          entityType: "movie",
          entityId: "10",
          validationStatus: "failed",
          errorMessage: "Erro X\nstack",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    };
    const report = buildInspectionReport(data, QUERY);
    expect(report.recentFailedJobs[0]?.lastError).toBe("Falha de validacao");
    expect(report.recentLogErrors[0]?.errorMessage).toBe("Erro X");
  });
});

describe("buildInspectionReport — reaplica limit", () => {
  it("trunca listas recentes ao limit", () => {
    const failed = Array.from({ length: 5 }, (_unused, i) => ({
      id: String(i),
      entityType: "movie",
      entityId: String(i),
      languageCode: "pt-BR",
      status: "failed",
      attempts: 1,
      lastError: "x",
      updatedAt: null,
    }));
    const data: InspectionData = { ...emptyData(), recentFailedJobs: failed };
    const report = buildInspectionReport(data, { limit: 2, languageCode: "pt-BR" });
    expect(report.recentFailedJobs).toHaveLength(2);
  });
});

describe("buildInspectionReport — filtro no relatorio", () => {
  it("reflete entityType/language/limit no campo filter", () => {
    const report = buildInspectionReport(emptyData(), {
      limit: 7,
      entityType: "tv",
      languageCode: "es",
    });
    expect(report.filter).toEqual({ entityType: "tv", languageCode: "es", limit: 7 });
  });

  it("entityType ausente vira null no filter", () => {
    expect(buildInspectionReport(emptyData(), QUERY).filter.entityType).toBeNull();
  });
});

describe("inspectEntityWriter — repassa a query ao store", () => {
  it("encaminha entityType/language/limit ao store e monta o relatorio", async () => {
    let received: InspectQuery | undefined;
    const fakeStore: InspectStorePort = {
      async collect(query) {
        received = query;
        return {
          ...emptyData(),
          jobsByStatus: [{ key: "queued", count: 1 }],
        };
      },
    };
    const query: InspectQuery = { limit: 15, entityType: "movie", languageCode: "pt-BR" };
    const report = await inspectEntityWriter(fakeStore, query);
    expect(received).toEqual(query);
    expect(report.jobs.queued).toBe(1);
    expect(report.filter).toEqual({ entityType: "movie", languageCode: "pt-BR", limit: 15 });
  });
});

describe("camada pura — sem escrita e sem Gemini", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../inspect/inspect-entity-writer.ts", import.meta.url)),
    "utf8",
  );

  it("nao importa @screena/db nem usa Gemini", () => {
    expect(source).not.toMatch(/@screena\/db/);
    expect(source).not.toMatch(/from\s+["'][^"']*gemini/i);
    expect(source).not.toMatch(/Gemini(Port|Adapter)|createGemini|FakeGemini/);
  });

  it("nao contem metodo de escrita Prisma", () => {
    expect(source).not.toMatch(/\.(create|update|delete|upsert)\s*\(/);
  });
});
