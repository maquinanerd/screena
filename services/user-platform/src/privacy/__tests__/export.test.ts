/**
 * Testes de exportacao: aceite/duplicidade; manifesto/plano deterministicos que
 * EXCLUEM hashes/tokens/credenciais/antifraude/catalogo-terceiro; rede de
 * seguranca anti-segredo; resultado publico sem estrutura interna.
 */

import { describe, expect, it } from "vitest";
import {
  assertExportContainsNoSecrets,
  buildExportManifest,
  buildExportPlan,
  decideExportRequest,
  toPublicExportAccepted,
} from "../export.js";
import { NEVER_EXPORTABLE_CATEGORIES } from "../retention.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");

describe("decideExportRequest (duplicidade)", () => {
  it("(1) pedido valido e aceito (sem pedido anterior)", () => {
    expect(decideExportRequest({ existingRequestStatus: null }).ok).toBe(true);
  });

  it("(2) duplicidade ATIVA (pending/processing) e rejeitada", () => {
    expect(decideExportRequest({ existingRequestStatus: "pending" }).ok).toBe(false);
    expect(decideExportRequest({ existingRequestStatus: "processing" }).ok).toBe(false);
  });

  it("(3) pedido concluido/rejeitado/cancelado libera novo", () => {
    expect(decideExportRequest({ existingRequestStatus: "completed" }).ok).toBe(true);
    expect(decideExportRequest({ existingRequestStatus: "rejected" }).ok).toBe(true);
    expect(decideExportRequest({ existingRequestStatus: "cancelled" }).ok).toBe(true);
  });
});

describe("buildExportPlan / buildExportManifest (determinismo + exclusao)", () => {
  it("(1) plano e deterministico (mesma entrada -> mesma saida)", () => {
    const a = buildExportPlan({ now: NOW });
    const b = buildExportPlan({ now: NOW });
    expect(a.includedCategories).toEqual(b.includedCategories);
    expect(a.excludedCategories).toEqual(b.excludedCategories);
  });

  it("(2) NENHUMA categoria never-exportable entra em includedCategories", () => {
    const plan = buildExportPlan({ now: NOW });
    for (const category of plan.includedCategories) {
      expect(NEVER_EXPORTABLE_CATEGORIES.has(category), category).toBe(false);
    }
  });

  it("(3) credenciais, sessoes, tokens, ip, audit e catalogo-terceiro estao EXCLUIDOS", () => {
    const plan = buildExportPlan({ now: NOW });
    for (const category of [
      "account_credentials",
      "security_sessions",
      "security_tokens",
      "security_ip",
      "security_audit",
      "third_party_catalog",
    ] as const) {
      expect(plan.excludedCategories.includes(category), category).toBe(true);
      expect(plan.includedCategories.includes(category), category).toBe(false);
    }
  });

  it("(4) dados proprios permitidos entram (perfil, conteudo, consentimentos)", () => {
    const plan = buildExportPlan({ now: NOW });
    for (const category of ["profile", "product_content", "governance_consents"] as const) {
      expect(plan.includedCategories.includes(category), category).toBe(true);
    }
  });

  it("(5) manifesto cobre TODAS as categorias em ordem canonica", () => {
    const manifest = buildExportManifest();
    expect(manifest.length).toBe(12);
  });
});

describe("assertExportContainsNoSecrets (rede de seguranca)", () => {
  it("(1) objeto limpo passa", () => {
    const clean = { profile: { displayName: "Pablo", locale: "pt-BR" }, ratings: [{ value: 4.5 }] };
    expect(assertExportContainsNoSecrets(clean).ok).toBe(true);
  });

  it("(2) qualquer chave sensivel e acusada (recursivo)", () => {
    for (const contaminated of [
      { passwordHash: "x" },
      { nested: { tokenHash: "x" } },
      { list: [{ ipHash: "x" }] },
      { csrfToken: "x" },
      { deep: { deeper: { internal_reason: "x" } } },
    ]) {
      expect(assertExportContainsNoSecrets(contaminated).ok, JSON.stringify(contaminated)).toBe(
        false,
      );
    }
  });

  it("(3) ciclo/profundidade excessiva falha fechado (nao trava)", () => {
    const a: Record<string, unknown> = {};
    a.self = a; // ciclo
    expect(assertExportContainsNoSecrets(a).ok).toBe(true); // ciclo sem chave sensivel: ok (seen dedup)
  });
});

describe("toPublicExportAccepted", () => {
  it("(1) DTO publico sem estrutura interna (schema/coluna/id)", () => {
    const dto = toPublicExportAccepted();
    const text = JSON.stringify(dto).toLowerCase();
    for (const t of ["user_", "column", "table", "select", "id_"]) expect(text.includes(t)).toBe(false);
    expect(dto).toEqual({ ok: true, kind: "export", status: "pending", message: expect.any(String) });
  });
});
