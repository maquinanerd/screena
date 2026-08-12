/**
 * remediation.test.ts — Classificacao PURA da remediacao.
 *
 * O que estes testes travam: a remediacao so toca linha que bate a IMPRESSAO
 * DIGITAL do rebaixamento pelo seed, e RECUSA por inteiro quando aparece
 * corrupcao fora do diagnostico. Reparar so a parte conhecida deixaria o resto
 * invisivel — que e como este defeito sobreviveu a primeira rodada.
 *
 * O ciclo em banco real vive em
 * `scripts/validate-source-authorization-legacy-grants.ts`.
 */

import { describe, expect, it } from "vitest";

import { planRemediation, renderRemediationRecord, type LegacyGrant } from "../remediation.js";

/** Linha legada canonica: exatamente o que o seed produzia por cima do apply. */
function legacyGrant(overrides: Partial<LegacyGrant> = {}): LegacyGrant {
  return {
    decisionId: "3",
    licenseId: "8",
    sourceKey: "imdb",
    contentType: "rating",
    licenseStatus: "unknown",
    licensePolicyVersion: "cinerie-source-auth/imdb/2026-08-v1",
    licenseDecisionOrigin: "owner_authorization",
    useCase: "rating_display",
    territory: "BR",
    stage: "approved_for_display",
    displayAllowed: true,
    storageAllowed: true,
    derivativeAllowed: false,
    policyVersion: "cinerie-source-auth/imdb/2026-08-v1",
    decidedBy: "Pablo Eduardo — proprietário da Cinerie",
    validFrom: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("planRemediation", () => {
  it("aceita a linha que bate a impressao digital inteira", () => {
    const plan = planRemediation([legacyGrant()]);
    expect(plan.remediable).toHaveLength(1);
    expect(plan.refused).toHaveLength(0);
  });

  it("RECUSA licenca 'blocked' — bloqueio e decisao humana, nao corrupcao", () => {
    const plan = planRemediation([legacyGrant({ licenseStatus: "blocked" })]);
    expect(plan.remediable).toHaveLength(0);
    expect(plan.refused[0]!.failedConditions.join(" ")).toContain("decisao humana");
  });

  it("RECUSA quando falta decision_origin=owner_authorization", () => {
    const plan = planRemediation([legacyGrant({ licenseDecisionOrigin: null })]);
    expect(plan.remediable).toHaveLength(0);
    expect(plan.refused[0]!.failedConditions.join(" ")).toContain("decision_origin");
  });

  it("RECUSA quando policy_version da licenca esta vazio", () => {
    // Licenca so de seed (nunca autorizada) nao tem policy_version. Uma decisao
    // concedendo sob ela e outro problema — nao ESTE — e nao se repara aqui.
    const plan = planRemediation([legacyGrant({ licensePolicyVersion: "   " })]);
    expect(plan.remediable).toHaveLength(0);
    expect(plan.refused[0]!.failedConditions.join(" ")).toContain("policy_version");
  });

  it("acumula TODAS as condicoes que falharam, nao so a primeira", () => {
    const plan = planRemediation([
      legacyGrant({ licenseStatus: "blocked", licenseDecisionOrigin: null, licensePolicyVersion: null }),
    ]);
    expect(plan.refused[0]!.failedConditions).toHaveLength(3);
  });

  it("uma linha fora do diagnostico nao impede a classificacao das outras — mas fica registrada", () => {
    const plan = planRemediation([legacyGrant(), legacyGrant({ decisionId: "99", licenseStatus: "blocked" })]);
    expect(plan.items).toHaveLength(2);
    expect(plan.remediable).toHaveLength(1);
    expect(plan.refused).toHaveLength(1);
    // `applyRemediationWithin` e quem barra a escrita quando ha recusa; a
    // classificacao pura continua descrevendo o conjunto inteiro.
  });

  it("plano vazio nao repara nem recusa nada", () => {
    const plan = planRemediation([]);
    expect(plan.items).toHaveLength(0);
    expect(plan.remediable).toHaveLength(0);
    expect(plan.refused).toHaveLength(0);
  });
});

describe("renderRemediationRecord", () => {
  it("registra o que a decisao concedia — e o stage que sobrevive", () => {
    const record = renderRemediationRecord(planRemediation([legacyGrant()]), "2026-08-12");
    expect(record).toContain("display + storage");
    expect(record).toContain("approved_for_display");
    expect(record).toContain("cinerie-source-auth/imdb/2026-08-v1");
  });

  it("a decisao so de storage aparece com o grant certo", () => {
    const record = renderRemediationRecord(
      planRemediation([
        legacyGrant({ useCase: "internal_analytics", territory: null, stage: "approved_for_internal_use", displayAllowed: false }),
      ]),
      "2026-08-12",
    );
    expect(record).toContain("**storage**");
    expect(record).not.toContain("display + storage");
  });

  it("lista as recusadas em secao propria, dizendo por que", () => {
    const record = renderRemediationRecord(planRemediation([legacyGrant({ licenseStatus: "blocked" })]), "2026-08-12");
    expect(record).toContain("RECUSADAS");
    expect(record).toContain("nada foi tocado");
  });
});
