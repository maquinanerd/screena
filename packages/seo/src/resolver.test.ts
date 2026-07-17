/**
 * resolver.test.ts — Matriz da FONTE UNICA de SEO (`resolvePageSeo`).
 *
 * Cobre a precedencia completa (exclusao explicita -> licenca -> atribuicao de
 * noticia -> idioma -> stale -> entidade nao publicada -> tecnico -> index) e a
 * regra invariante `includeInSitemap === (decision === 'index')` — metadata e
 * sitemap NUNCA discordam porque derivam do mesmo contrato.
 */

import { describe, expect, it } from "vitest";

import {
  resolvePageSeo,
  SEO_POLICY,
  SEO_POLICY_VERSION,
  type PageSeoFacts,
} from "./resolver.js";

function facts(overrides: Partial<PageSeoFacts> = {}): PageSeoFacts {
  return {
    language: "pt-BR",
    hasReliableStructuredData: true,
    displayedRatings: [{ licenseDisplayAllowed: true }],
    valueBlocksCount: 2,
    thinContentScore: 0.1,
    reviewStatusOk: true,
    ...overrides,
  };
}

describe("resolvePageSeo — matriz de decisao", () => {
  it("caso feliz pt-BR licenciado -> index/follow/sitemap", () => {
    const r = resolvePageSeo(facts());
    expect(r.decision).toBe("index");
    expect(r.robots).toEqual({ index: true, follow: true });
    expect(r.includeInSitemap).toBe(true);
    expect(r.decisionSource).toBe("total-indexing");
    expect(r.policy).toBe(SEO_POLICY);
    expect(r.policyVersion).toBe(SEO_POLICY_VERSION);
  });

  it("exclusao explicita vence tudo -> noindex/nofollow/fora do sitemap", () => {
    const r = resolvePageSeo(
      facts({
        explicitlyExcluded: true,
        // Mesmo com licenca bloqueada, a exclusao explicita tem precedencia.
        displayedRatings: [{ licenseDisplayAllowed: false }],
      }),
    );
    expect(r.decision).toBe("noindex");
    expect(r.robots).toEqual({ index: false, follow: false });
    expect(r.includeInSitemap).toBe(false);
    expect(r.decisionSource).toBe("explicit-exclusion");
  });

  it("rating com licenca bloqueada -> blocked (invariante 6)", () => {
    const r = resolvePageSeo(
      facts({
        displayedRatings: [
          { licenseDisplayAllowed: true },
          { licenseDisplayAllowed: false },
        ],
      }),
    );
    expect(r.decision).toBe("blocked");
    expect(r.robots).toEqual({ index: false, follow: false });
    expect(r.includeInSitemap).toBe(false);
    expect(r.allRatingsLicensed).toBe(false);
    expect(r.decisionSource).toBe("license-blocked");
  });

  it("noticia sem atribuicao exigida -> blocked", () => {
    const r = resolvePageSeo(
      facts({
        newsAttribution: {
          isNews: true,
          requiresAttribution: true,
          hasAttributionText: false,
          requiresLinkback: false,
          hasAttributionUrl: false,
        },
      }),
    );
    expect(r.decision).toBe("blocked");
    expect(r.decisionSource).toBe("news-attribution-missing");
    expect(r.includeInSitemap).toBe(false);
  });

  it("noticia sem linkback exigido -> blocked", () => {
    const r = resolvePageSeo(
      facts({
        newsAttribution: {
          isNews: true,
          requiresAttribution: false,
          hasAttributionText: false,
          requiresLinkback: true,
          hasAttributionUrl: false,
        },
      }),
    );
    expect(r.decision).toBe("blocked");
    expect(r.decisionSource).toBe("news-attribution-missing");
  });

  it("noticia com atribuicao e linkback presentes -> index", () => {
    const r = resolvePageSeo(
      facts({
        newsAttribution: {
          isNews: true,
          requiresAttribution: true,
          hasAttributionText: true,
          requiresLinkback: true,
          hasAttributionUrl: true,
        },
      }),
    );
    expect(r.decision).toBe("index");
  });

  it("idioma fora de PUBLISHED_LOCALES -> draft (invariante 7)", () => {
    const r = resolvePageSeo(facts({ language: "en" }));
    expect(r.decision).toBe("draft");
    expect(r.robots).toEqual({ index: false, follow: true });
    expect(r.includeInSitemap).toBe(false);
    expect(r.decisionSource).toBe("language-not-published");
  });

  it("conteudo invalidado -> stale (fora do indice ate revalidar)", () => {
    const r = resolvePageSeo(facts({ isStale: true }));
    expect(r.decision).toBe("stale");
    expect(r.robots).toEqual({ index: false, follow: true });
    expect(r.includeInSitemap).toBe(false);
    expect(r.decisionSource).toBe("stale-invalidation");
  });

  it("entidade nao publicada -> noindex (entity-not-published)", () => {
    const r = resolvePageSeo(facts({ isPublished: false }));
    expect(r.decision).toBe("noindex");
    expect(r.decisionSource).toBe("entity-not-published");
    expect(r.includeInSitemap).toBe(false);
  });

  it("caso tecnico (sem dados estruturados) -> noindex", () => {
    const r = resolvePageSeo(facts({ hasReliableStructuredData: false }));
    expect(r.decision).toBe("noindex");
    expect(r.decisionSource).toBe("technical-invalid");
    expect(r.includeInSitemap).toBe(false);
  });

  it("licenca vence idioma (precedencia): en + rating bloqueado -> blocked", () => {
    const r = resolvePageSeo(
      facts({
        language: "en",
        displayedRatings: [{ licenseDisplayAllowed: false }],
      }),
    );
    expect(r.decision).toBe("blocked");
    expect(r.decisionSource).toBe("license-blocked");
  });

  it("canonical e repassado; blocos so alimentam hasUniqueValue", () => {
    const r = resolvePageSeo(
      facts({ canonicalUrl: "https://cinerie.com/pt/filmes/x/", valueBlocksCount: 1 }),
    );
    expect(r.canonical).toBe("https://cinerie.com/pt/filmes/x/");
    expect(r.hasUniqueValue).toBe(false);
    expect(r.decision).toBe("index");
  });

  it("INVARIANTE: includeInSitemap sempre igual a (decision === 'index')", () => {
    const cases: PageSeoFacts[] = [
      facts(),
      facts({ explicitlyExcluded: true }),
      facts({ displayedRatings: [{ licenseDisplayAllowed: false }] }),
      facts({ language: "es" }),
      facts({ isStale: true }),
      facts({ isPublished: false }),
      facts({ hasReliableStructuredData: false }),
    ];
    for (const input of cases) {
      const r = resolvePageSeo(input);
      expect(r.includeInSitemap).toBe(r.decision === "index");
    }
  });
});
