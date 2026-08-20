/**
 * score-compute-run.test.ts — Núcleo puro do worker do Cinerie Score.
 *
 * O que se prova aqui: a projeção da decisão (uma vigente resolve; duas é
 * defeito, não empate; zero é ausência que fala), o elo decisão->fórmula pelo
 * mapa fechado, e a montagem por entidade que não deixa recusa muda.
 */

import { describe, expect, it } from "vitest";

import {
  CINERIE_SCORE_DECISION_POLICY,
} from "@screena/config";

import {
  buildEntityInputs,
  projectScoreDecision,
  type ScoreDecisionRow,
} from "../score/compute-run.js";

function decisionRow(over: Partial<ScoreDecisionRow> = {}): ScoreDecisionRow {
  return {
    id: "1",
    useCase: "cinerie_score_display",
    stage: "approved_for_display",
    displayAllowed: true,
    derivativeAllowed: true,
    isCurrent: true,
    validFrom: new Date("2026-08-20T00:00:00Z"),
    validUntil: null,
    policyVersion: CINERIE_SCORE_DECISION_POLICY,
    ...over,
  };
}

describe("projectScoreDecision", () => {
  it("zero linhas => null (ausencia explicada pelo bin, nada calculado)", () => {
    expect(projectScoreDecision([])).toBeNull();
  });

  it("uma vigente => decisao com a formula aprovada derivada do policy_version", () => {
    const decision = projectScoreDecision([decisionRow()]);
    expect(decision).not.toBeNull();
    expect(decision!.approvedFormulaVersion).toBe("cinerie-score/2026-08-v1");
    expect(decision!.policyVersion).toBe(CINERIE_SCORE_DECISION_POLICY);
  });

  it("policy fora do mapa => approvedFormulaVersion vazio (engine devolve formula-not-registered)", () => {
    const decision = projectScoreDecision([decisionRow({ policyVersion: "cinerie-score-decisao/9999-x" })]);
    expect(decision!.approvedFormulaVersion).toBe("");
  });

  it("DUAS vigentes => lanca (ambiguidade de registro, nao empate a resolver)", () => {
    expect(() => projectScoreDecision([decisionRow(), decisionRow({ id: "2" })])).toThrow(
      /ambiguidade de registro/,
    );
  });
});

describe("buildEntityInputs", () => {
  const nota = {
    entityId: "10",
    ratingSource: "imdb",
    ratingValue: 8.4,
    ratingScale: 10,
    ratingCount: null,
    scoreType: "audience",
    dataUsageDecisionId: "77",
  };

  it("agrupa por entidade e carrega o licenseDecisionId de cada nota", () => {
    const { inputs, skipped } = buildEntityInputs(
      [nota, { ...nota, ratingSource: "rotten_tomatoes", ratingValue: 88, ratingScale: 100, scoreType: "critics" }],
      [],
      null,
    );
    expect(skipped).toEqual([]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.ratings.map((r) => r.source).sort()).toEqual(["imdb", "rotten_tomatoes"]);
    expect(inputs[0]!.ratings.every((r) => r.licenseDecisionId === "77")).toBe(true);
  });

  it("nota exibivel SEM decisao e anomalia RELATADA, nunca muda", () => {
    const { inputs, skipped } = buildEntityInputs([{ ...nota, dataUsageDecisionId: null }], [], null);
    expect(inputs).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain("sem data_usage_decision_id");
  });

  it("TMDB entra como audience sob a decisao internal_analytics do TMDB", () => {
    const { inputs } = buildEntityInputs(
      [],
      [{ entityId: "10", voteAverageTmdb: 7.6, voteCountTmdb: 980 }],
      "55",
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.ratings[0]).toMatchObject({
      source: "tmdb",
      type: "audience",
      value: 7.6,
      best: 10,
      count: 980,
      licenseDecisionId: "55",
    });
  });

  it("TMDB com sinal e SEM decisao vigente e relatado, nunca incluido", () => {
    const { inputs, skipped } = buildEntityInputs(
      [],
      [{ entityId: "10", voteAverageTmdb: 7.6, voteCountTmdb: 980 }],
      null,
    );
    expect(inputs).toEqual([]);
    expect(skipped[0]!.reason).toContain("sem decisao internal_analytics");
  });
});
