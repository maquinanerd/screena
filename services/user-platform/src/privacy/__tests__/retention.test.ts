/**
 * Testes de retencao/minimizacao: segredo/hash nunca exportavel; dado proprio
 * exportavel; retencao exige razao controlada; categoria desconhecida
 * fail-closed; retencao indefinida so com razao justificada.
 */

import { describe, expect, it } from "vitest";
import { isCategoryExportable } from "../policy.js";
import {
  buildFullRetentionPlan,
  buildRetentionForCategory,
  isNeverExportable,
  validateRetentionDecision,
} from "../retention.js";
import { DATA_CATEGORIES } from "../types.js";

describe("exportabilidade por categoria", () => {
  it("(1) credenciais e hashes de seguranca NUNCA sao exportaveis", () => {
    for (const c of [
      "account_credentials",
      "security_sessions",
      "security_tokens",
      "security_ip",
      "security_audit",
    ] as const) {
      expect(isCategoryExportable(c), c).toBe(false);
      expect(isNeverExportable(c), c).toBe(true);
    }
  });

  it("(2) dados publicos/proprios do usuario podem ser exportaveis", () => {
    for (const c of ["profile", "product_content"] as const) {
      expect(isCategoryExportable(c), c).toBe(true);
    }
  });

  it("(3) dado de terceiro (catalogo) e excluido do export (nao redistribuivel)", () => {
    expect(isCategoryExportable("third_party_catalog")).toBe(false);
    expect(isNeverExportable("third_party_catalog")).toBe(true);
  });
});

describe("validateRetentionDecision (razao controlada obrigatoria)", () => {
  it("(1) razao vazia/livre e rejeitada", () => {
    expect(validateRetentionDecision({ action: "delete", reason: "", retainForDays: null }).ok).toBe(
      false,
    );
    expect(
      validateRetentionDecision({ action: "delete", reason: "porque sim", retainForDays: null }).ok,
    ).toBe(false);
  });

  it("(2) acao desconhecida e rejeitada (fail-closed)", () => {
    expect(
      validateRetentionDecision({ action: "keep_forever", reason: "legal_obligation", retainForDays: null })
        .ok,
    ).toBe(false);
  });

  it("(3) retain_until exige prazo positivo", () => {
    expect(
      validateRetentionDecision({ action: "retain_until", reason: "security_obligation", retainForDays: null }).ok,
    ).toBe(false);
    expect(
      validateRetentionDecision({ action: "retain_until", reason: "security_obligation", retainForDays: 0 }).ok,
    ).toBe(false);
    expect(
      validateRetentionDecision({ action: "retain_until", reason: "security_obligation", retainForDays: 365 }).ok,
    ).toBe(true);
  });

  it("(4) retencao INDEFINIDA so com razao justificada (nunca por conveniencia)", () => {
    expect(
      validateRetentionDecision({ action: "retain_indefinitely", reason: "user_owned_data", retainForDays: null }).ok,
    ).toBe(false); // user_owned_data nao justifica retencao indefinida
    expect(
      validateRetentionDecision({ action: "retain_indefinitely", reason: "legal_obligation", retainForDays: null }).ok,
    ).toBe(true);
  });
});

describe("buildRetentionForCategory / buildFullRetentionPlan", () => {
  it("(1) categoria desconhecida falha fechado", () => {
    // @ts-expect-error categoria fora do enum, testando fail-closed
    expect(buildRetentionForCategory("nao_existe").ok).toBe(false);
  });

  it("(2) plano completo cobre todas as categorias em ordem canonica", () => {
    const plan = buildFullRetentionPlan();
    expect(plan.map((d) => d.category)).toEqual([...DATA_CATEGORIES]);
  });

  it("(3) toda decisao do plano tem razao controlada e nao-vazia", () => {
    for (const d of buildFullRetentionPlan()) {
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});
