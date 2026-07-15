/**
 * resolver-persisted.test.ts — Fusao da resolucao viva com a decisao VIGENTE
 * persistida em page_indexability_decisions (`mergePersistedDecision`).
 *
 * Trava a regra fail-closed: a decisao persistida so pode RESTRINGIR; um `index`
 * persistido desatualizado nunca reabre uma pagina bloqueada ao vivo por licenca
 * (invariante 6), idioma (invariante 7) ou caso tecnico.
 */

import { describe, expect, it } from "vitest";

import {
  mergePersistedDecision,
  resolvePageSeo,
  type IndexDecision,
  type PageSeoFacts,
  type PageSeoResolution,
  type PersistedDecisionFacts,
} from "./resolver.js";

function live(overrides: Partial<PageSeoFacts> = {}): PageSeoResolution {
  return resolvePageSeo({
    language: "pt-BR",
    hasReliableStructuredData: true,
    displayedRatings: [{ licenseDisplayAllowed: true }],
    canonicalUrl: "https://thescreen.media/pt/filmes/x/",
    ...overrides,
  });
}

function persisted(
  decision: IndexDecision,
  extra: Partial<PersistedDecisionFacts> = {},
): PersistedDecisionFacts {
  return {
    decision,
    decisionOrigin: "human_override",
    policyVersion: "2026-07",
    ...extra,
  };
}

describe("mergePersistedDecision", () => {
  it("sem decisao persistida (null) devolve a resolucao viva inalterada", () => {
    const l = live();
    expect(mergePersistedDecision(l, null)).toBe(l);
  });

  it("persistida noindex sobre viva index -> noindex/nofollow/fora do sitemap", () => {
    const r = mergePersistedDecision(live(), persisted("noindex"));
    expect(r.decision).toBe("noindex");
    expect(r.robots).toEqual({ index: false, follow: false });
    expect(r.includeInSitemap).toBe(false);
    expect(r.decisionSource).toBe("persisted-decision");
  });

  it("persistida blocked sobre viva index -> blocked/nofollow", () => {
    const r = mergePersistedDecision(live(), persisted("blocked"));
    expect(r.decision).toBe("blocked");
    expect(r.robots).toEqual({ index: false, follow: false });
    expect(r.includeInSitemap).toBe(false);
  });

  it("persistida stale sobre viva index -> stale (follow true, fora do sitemap)", () => {
    const r = mergePersistedDecision(live(), persisted("stale"));
    expect(r.decision).toBe("stale");
    expect(r.robots).toEqual({ index: false, follow: true });
    expect(r.includeInSitemap).toBe(false);
  });

  it("FAIL-CLOSED: persistida index NAO reabre pagina bloqueada por licenca viva", () => {
    const l = live({ displayedRatings: [{ licenseDisplayAllowed: false }] });
    const r = mergePersistedDecision(l, persisted("index"));
    expect(r.decision).toBe("blocked");
    expect(r.decisionSource).toBe("license-blocked");
  });

  it("FAIL-CLOSED: persistida index NAO reabre noindex tecnico vivo", () => {
    const l = live({ hasReliableStructuredData: false });
    const r = mergePersistedDecision(l, persisted("index"));
    expect(r.decision).toBe("noindex");
    expect(r.decisionSource).toBe("technical-invalid");
  });

  it("FAIL-CLOSED: persistida index NAO reabre draft de idioma nao publicado", () => {
    const l = live({ language: "en" });
    const r = mergePersistedDecision(l, persisted("index"));
    expect(r.decision).toBe("draft");
    expect(r.decisionSource).toBe("language-not-published");
  });

  it("persistida menos restritiva que a viva: a viva governa (draft vence stale)", () => {
    const l = live({ language: "en" }); // draft (severidade 2)
    const r = mergePersistedDecision(l, persisted("stale")); // stale (severidade 1)
    expect(r.decision).toBe("draft");
    expect(r.decisionSource).toBe("language-not-published");
  });

  it("reason persistido e preservado quando presente", () => {
    const r = mergePersistedDecision(
      live(),
      persisted("noindex", { reason: "Excluido por decisao juridica registrada." }),
    );
    expect(r.reason).toBe("Excluido por decisao juridica registrada.");
  });

  it("INVARIANTE: includeInSitemap === (decision === 'index') apos a fusao", () => {
    const decisions: IndexDecision[] = ["index", "noindex", "draft", "stale", "blocked"];
    for (const d of decisions) {
      const r = mergePersistedDecision(live(), persisted(d));
      expect(r.includeInSitemap).toBe(r.decision === "index");
    }
  });
});
