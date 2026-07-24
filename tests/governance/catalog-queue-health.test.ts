/**
 * Testes do sentinela de saude do ciclo de catalogo.
 *
 * O caso (1) e a razao de existir do modulo: na primeira execucao do Prompt 03 a
 * fila reivindicava jobs, reportava progresso e o exit code era 0 — com ZERO
 * entidades persistidas. Se este teste cair, esse modo de falha volta a passar
 * despercebido.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  evaluateCycleHealth,
  toAlertOutcome,
  // @ts-expect-error — modulo .mjs de operacao, sem tipos declarados.
} from "../../scripts/catalog/lib/queue-health.mjs";

const base = {
  entities: 100,
  titles: 10,
  people: 500,
  slugs: 10,
  translations: 10,
  searchDocuments: 10,
  deadLetter: 0,
  pending: 0,
  retryWait: 0,
  succeeded: 100,
};

describe("evaluateCycleHealth", () => {
  it("(1) DETECTA jobs concluidos com catalogo parado — o modo de falha real", () => {
    const v = evaluateCycleHealth(base, { ...base, succeeded: 150 });
    expect(v.healthy).toBe(false);
    const issue = v.issues.find((i: { code: string }) => i.code === "zero_growth");
    expect(issue?.severity).toBe("critical");
    expect(issue?.message).toContain("NAO cresceu");
  });

  it("(2) ciclo que realmente cresceu e saudavel", () => {
    const v = evaluateCycleHealth(base, { ...base, succeeded: 150, entities: 200 });
    expect(v.healthy).toBe(true);
    expect(v.issues).toHaveLength(0);
  });

  it("(3) backlog sem nenhum job concluido = worker travado", () => {
    const v = evaluateCycleHealth(base, { ...base, pending: 40 });
    expect(v.healthy).toBe(false);
    expect(v.issues.some((i: { code: string }) => i.code === "queue_stuck")).toBe(true);
  });

  it("(4) dead-letter CRESCENDO e critico; estavel e aviso", () => {
    const growing = evaluateCycleHealth(
      { ...base, deadLetter: 2 },
      { ...base, deadLetter: 9, succeeded: 150, entities: 200 },
    );
    expect(growing.issues.find((i: { code: string }) => i.code === "dead_letter_growing")?.severity).toBe(
      "critical",
    );

    const stable = evaluateCycleHealth(
      { ...base, deadLetter: 3 },
      { ...base, deadLetter: 3, succeeded: 150, entities: 200 },
    );
    expect(stable.issues.find((i: { code: string }) => i.code === "dead_letter_present")?.severity).toBe(
      "warning",
    );
  });

  it("(5) tempestade de retry e critica", () => {
    const v = evaluateCycleHealth(base, {
      ...base,
      succeeded: 110,
      entities: 200,
      retryWait: 200,
    });
    expect(v.issues.some((i: { code: string }) => i.code === "retry_storm")).toBe(true);
    expect(v.healthy).toBe(false);
  });

  it("(6) titulos sem NENHUM slug = critico (nada vira rota publica)", () => {
    const v = evaluateCycleHealth(base, {
      ...base,
      succeeded: 150,
      entities: 200,
      slugs: 0,
    });
    const issue = v.issues.find((i: { code: string }) => i.code === "no_slugs");
    expect(issue?.severity).toBe("critical");
  });

  it("(7) slugs sem search_documents = a projecao de busca nao rodou", () => {
    const v = evaluateCycleHealth(base, {
      ...base,
      succeeded: 150,
      entities: 200,
      searchDocuments: 0,
    });
    expect(v.issues.some((i: { code: string }) => i.code === "no_search_documents")).toBe(true);
  });

  it("(8) crescimento anormal de pessoas dispara acima do limiar", () => {
    // O elenco normal (~295 pessoas/titulo) NAO alarma...
    const normal = evaluateCycleHealth(base, {
      ...base,
      succeeded: 150,
      entities: 200,
      people: 2950,
    });
    expect(normal.issues.some((i: { code: string }) => i.code === "abnormal_people_growth")).toBe(
      false,
    );

    // ...mas ingestao por descoberta, sim.
    const abnormal = evaluateCycleHealth(base, {
      ...base,
      succeeded: 150,
      entities: 200,
      people: 10 * DEFAULT_THRESHOLDS.peoplePerTitleMax + 1,
    });
    expect(abnormal.issues.some((i: { code: string }) => i.code === "abnormal_people_growth")).toBe(
      true,
    );
  });

  it("(9) checkpoint parado alem do limite vira aviso", () => {
    const v = evaluateCycleHealth(base, {
      ...base,
      succeeded: 150,
      entities: 200,
      oldestCheckpointAgeSeconds: DEFAULT_THRESHOLDS.checkpointStaleSeconds + 1,
    });
    expect(v.issues.some((i: { code: string }) => i.code === "checkpoint_stale")).toBe(true);
  });

  it("(10) so problema CRITICO derruba a saude; aviso nao", () => {
    const warningOnly = evaluateCycleHealth(
      { ...base, deadLetter: 3 },
      { ...base, deadLetter: 3, succeeded: 150, entities: 200 },
    );
    expect(warningOnly.issues.length).toBeGreaterThan(0);
    expect(warningOnly.healthy).toBe(true);
  });
});

describe("toAlertOutcome — reuso da infra do Prompt 02", () => {
  it("(11) usa a source `queue`, que ja existe em ALERT_SOURCES", () => {
    const v = evaluateCycleHealth(base, { ...base, succeeded: 150 });
    const outcome = toAlertOutcome(v, { timestamp: "2026-07-24T00:00:00Z" });
    expect(outcome.source).toBe("queue");
    expect(outcome.status).toBe("failure");
  });

  it("(12) ciclo saudavel vira alerta informativo de sucesso", () => {
    const v = evaluateCycleHealth(base, { ...base, succeeded: 150, entities: 200 });
    const outcome = toAlertOutcome(v, { timestamp: "2026-07-24T00:00:00Z" });
    expect(outcome.status).toBe("success");
    expect(outcome.exitCode).toBe(0);
  });

  it("(13) PRESERVA o exit code original — o alerta nunca mascara o resultado", () => {
    const v = evaluateCycleHealth(base, { ...base, succeeded: 150 });
    const outcome = toAlertOutcome(v, { timestamp: "2026-07-24T00:00:00Z", exitCode: 42 });
    expect(outcome.exitCode).toBe(42);
  });
});
