/**
 * Testes PUROS da avaliacao de prontidao de staging (Fase 8A).
 *
 * Cobrem: status correto para local, production-like protegido e production-like
 * sem credenciais; Node major divergente; banco indisponivel; determinismo e
 * ausencia de segredo na saida.
 */

import { describe, expect, it } from "vitest";

import {
  EXPECTED_NODE_MAJOR,
  evaluateStagingReadiness,
  runtimeKindLabel,
  stagingBadgeVariant,
  stagingStatusLabel,
  type StagingDatabaseFacts,
  type StagingReadinessInput,
} from "../../apps/admin/src/lib/staging-readiness";

const DB: StagingDatabaseFacts = {
  articleRecords: 3,
  translations: 4,
  contentBlocks: 8,
  pending: 2,
  approved: 5,
  blocked: 1,
  indexReadyCandidates: 2,
};

function baseInput(overrides: Partial<StagingReadinessInput> = {}): StagingReadinessInput {
  return {
    runtimeKind: "development",
    productionLike: false,
    protectionRequired: false,
    protectionExplicitlyEnabled: false,
    hasCredentials: false,
    editorialActionsEnabled: false,
    nodeMajor: EXPECTED_NODE_MAJOR,
    database: DB,
    ...overrides,
  };
}

describe("evaluateStagingReadiness — ambiente local", () => {
  it("local com Node alvo e banco acessivel -> ok e seguro para revisar", () => {
    const r = evaluateStagingReadiness(baseInput());
    expect(r.overall).toBe("ok");
    expect(r.flowStatus).toBe("safe_to_review");
    expect(r.flowLabel).toBe("Seguro para revisar");
    expect(r.seedPosture).toBe("manual_only");
    // Ha checks de todas as secoes (menos flow, que sao links da pagina).
    const sections = new Set(r.checks.map((c) => c.section));
    for (const s of ["environment", "protection", "editorial", "database", "seed"]) {
      expect(sections.has(s as never), `secao ausente: ${s}`).toBe(true);
    }
  });
});

describe("evaluateStagingReadiness — production-like", () => {
  it("preview protegido (com credenciais) -> ok, seed manual", () => {
    const r = evaluateStagingReadiness(
      baseInput({
        runtimeKind: "preview",
        productionLike: true,
        protectionRequired: true,
        hasCredentials: true,
      }),
    );
    expect(r.overall).toBe("ok");
    expect(r.flowStatus).toBe("safe_to_review");
    expect(r.seedPosture).toBe("manual_only");
  });

  it("producao real -> seed bloqueado (blocked_production)", () => {
    const r = evaluateStagingReadiness(
      baseInput({
        runtimeKind: "production",
        productionLike: true,
        protectionRequired: true,
        hasCredentials: true,
      }),
    );
    expect(r.seedPosture).toBe("blocked_production");
    expect(r.seedPostureLabel.toLowerCase()).toContain("bloqueado");
  });

  it("production-like SEM credenciais -> fail e precisa configurar staging", () => {
    const r = evaluateStagingReadiness(
      baseInput({
        runtimeKind: "production",
        productionLike: true,
        protectionRequired: true,
        hasCredentials: false,
      }),
    );
    expect(r.overall).toBe("fail");
    expect(r.flowStatus).toBe("needs_setup");
    const protection = r.checks.find((c) => c.id === "protection.credentials");
    expect(protection?.status).toBe("fail");
    expect(r.recommendedActions.join(" ")).toContain("credenciais");
  });

  it("production-like sem credenciais + escrita habilitada -> check editorial critico", () => {
    const r = evaluateStagingReadiness(
      baseInput({
        runtimeKind: "production",
        productionLike: true,
        protectionRequired: true,
        hasCredentials: false,
        editorialActionsEnabled: true,
      }),
    );
    const editorial = r.checks.find((c) => c.id === "editorial.actions");
    expect(editorial?.status).toBe("fail");
  });
});

describe("evaluateStagingReadiness — atencoes (warn)", () => {
  it("Node major divergente -> warn (nao fail)", () => {
    const r = evaluateStagingReadiness(baseInput({ nodeMajor: 24 }));
    const node = r.checks.find((c) => c.id === "env.node");
    expect(node?.status).toBe("warn");
    expect(r.overall).toBe("warn");
    expect(r.recommendedActions.join(" ")).toContain(`Node ${EXPECTED_NODE_MAJOR}`);
  });

  it("banco indisponivel -> warn e precisa configurar staging", () => {
    const r = evaluateStagingReadiness(baseInput({ database: null }));
    const db = r.checks.find((c) => c.id === "database.connectivity");
    expect(db?.status).toBe("warn");
    expect(r.flowStatus).toBe("needs_setup");
  });

  it("escrita habilitada fora de production-like -> warn", () => {
    const r = evaluateStagingReadiness(baseInput({ editorialActionsEnabled: true }));
    const editorial = r.checks.find((c) => c.id === "editorial.actions");
    expect(editorial?.status).toBe("warn");
  });

  it("nodeMajor null nao quebra e vira info", () => {
    const r = evaluateStagingReadiness(baseInput({ nodeMajor: null }));
    const node = r.checks.find((c) => c.id === "env.node");
    expect(node?.status).toBe("info");
  });
});

describe("determinismo e ausencia de segredo", () => {
  it("mesma entrada -> mesma saida (determinista)", () => {
    const input = baseInput({ runtimeKind: "preview", productionLike: true, hasCredentials: true });
    expect(evaluateStagingReadiness(input)).toEqual(evaluateStagingReadiness(input));
  });

  it("nenhuma saida contem termo de segredo", () => {
    const inputs = [
      baseInput(),
      baseInput({ productionLike: true, hasCredentials: false, editorialActionsEnabled: true }),
      baseInput({ database: null, nodeMajor: 24 }),
    ];
    const dump = inputs.map((i) => JSON.stringify(evaluateStagingReadiness(i))).join(" ");
    for (const secret of [
      "password",
      "senha",
      "authorization",
      "database_url",
      "process.env",
      "basic_auth",
      "bearer",
    ]) {
      expect(dump.toLowerCase()).not.toContain(secret);
    }
  });
});

describe("rotulos e badges", () => {
  it("mapeia status para badge e rotulo estaveis", () => {
    expect(stagingBadgeVariant("ok")).toBe("ok");
    expect(stagingBadgeVariant("fail")).toBe("fail");
    expect(stagingStatusLabel("warn")).toBe("Atencao");
    expect(runtimeKindLabel("preview")).toContain("preview");
  });
});
