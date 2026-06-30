/**
 * inspect-format.test.ts — Testes da apresentacao PURA do relatorio.
 *
 * Cobre o resumo legivel (rotulos, fila acumulada, secoes vazias) e o JSON
 * estruturado (valido + roundtrip). Garante que o resumo nao vaza segredo nem
 * stack trace longo.
 */

import { describe, expect, it } from "vitest";
import { buildInspectionReport, type InspectionData } from "../inspect/inspect-entity-writer.js";
import { formatInspectionSummary, toInspectionJson } from "../inspect/inspect-format.js";

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

const QUERY = { limit: 20, languageCode: "pt-BR" } as const;

describe("formatInspectionSummary", () => {
  it("inclui cabecalho, filtro e secoes principais", () => {
    const report = buildInspectionReport(emptyData(), QUERY);
    const out = formatInspectionSummary(report);
    expect(out).toContain("Entity Writer — status operacional");
    expect(out).toContain("language=pt-BR");
    expect(out).toContain("Jobs (total 0)");
    expect(out).toContain("Content blocks (total 0)");
    expect(out).toContain("fila acumulada: nao");
  });

  it("marca fila acumulada quando ha jobs queued", () => {
    const data: InspectionData = {
      ...emptyData(),
      jobsByStatus: [{ key: "queued", count: 4 }],
    };
    const out = formatInspectionSummary(buildInspectionReport(data, QUERY));
    expect(out).toContain("fila acumulada: sim");
    expect(out).toContain("queued=4");
  });

  it("mostra '(nenhuma)' quando nao ha entidades/falhas", () => {
    const out = formatInspectionSummary(buildInspectionReport(emptyData(), QUERY));
    expect(out).toContain("Entidades com blocos (0)");
    expect(out).toContain("Falhas recentes (0)");
  });

  it("usa apenas a 1a linha do erro (sem stack trace)", () => {
    const data: InspectionData = {
      ...emptyData(),
      recentFailedJobs: [
        {
          id: "1",
          entityType: "movie",
          entityId: "10",
          languageCode: "pt-BR",
          status: "failed",
          attempts: 1,
          lastError: "Mensagem curta\nSEGREDO-NA-STACK linha 2",
          updatedAt: null,
        },
      ],
    };
    const out = formatInspectionSummary(buildInspectionReport(data, QUERY));
    expect(out).toContain("Mensagem curta");
    expect(out).not.toContain("SEGREDO-NA-STACK");
  });
});

describe("toInspectionJson", () => {
  it("produz JSON valido que roundtrip-a no relatorio", () => {
    const data: InspectionData = {
      ...emptyData(),
      jobsByStatus: [{ key: "queued", count: 2 }],
      entitiesWithBlocks: [
        { entityType: "movie", entityId: "10", languageCode: "pt-BR", blockCount: 3 },
      ],
    };
    const report = buildInspectionReport(data, QUERY);
    const json = toInspectionJson(report);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(report);
    expect(parsed.jobs.queued).toBe(2);
    expect(parsed.entitiesWithBlocks[0].blockCount).toBe(3);
  });
});
