/**
 * plan.test.ts — Planejamento idempotente e as travas do spec.
 */

import { describe, expect, it } from "vitest";

import {
  STATIC_AUTHORIZATION,
  streamingProviderEntries,
  type AuthorizationEntry,
} from "../authorization-spec.js";
import {
  assertNoBlockedGrants,
  isPlanClean,
  planAuthorization,
  type CurrentDecision,
  type CurrentLicense,
} from "../plan.js";

/** Projeta o estado que o apply de um plano deixaria (para provar idempotência). */
function projectAfterApply(entries: readonly AuthorizationEntry[]): {
  licenses: CurrentLicense[];
  decisions: CurrentDecision[];
} {
  const licenses: CurrentLicense[] = [];
  const decisions: CurrentDecision[] = [];
  let licId = 1;
  let decId = 1;
  for (const e of entries) {
    const id = String(licId++);
    const l = e.license;
    licenses.push({
      id,
      sourceKey: l.sourceKey,
      contentType: l.contentType,
      ratingSourceKey: l.ratingSourceKey,
      providerKey: l.providerKey,
      territory: l.territory,
      licenseStatus: l.licenseStatus,
      displayAllowed: l.displayAllowed,
      logoAllowed: l.logoAllowed,
      scoreAllowed: l.scoreAllowed,
      reviewQuoteAllowed: l.reviewQuoteAllowed,
      requiresAttribution: l.requiresAttribution,
      requiresLinkback: l.requiresLinkback,
      attributionText: l.attributionText,
      policyVersion: l.policyVersion,
    });
    for (const d of e.decisions) {
      decisions.push({
        id: String(decId++),
        sourceLicenseId: id,
        useCase: d.useCase,
        territory: d.territory,
        stage: d.stage,
        displayAllowed: d.displayAllowed,
        storageAllowed: d.storageAllowed,
        derivativeAllowed: d.derivativeAllowed,
        attributionRequired: d.attributionRequired,
        linkbackRequired: d.linkbackRequired,
        policyVersion: d.policyVersion,
      });
    }
  }
  return { licenses, decisions };
}

describe("plano — do zero (banco sem autorização)", () => {
  it("planeja criar todas as licenças e decisões estáticas", () => {
    const plan = planAuthorization(STATIC_AUTHORIZATION, [], []);
    expect(plan.summary.licensesCreate).toBe(STATIC_AUTHORIZATION.length);
    expect(plan.summary.licensesSupersede).toBe(0);
    expect(plan.summary.decisionsCreate).toBeGreaterThan(0);
    expect(isPlanClean(plan)).toBe(false);
  });

  it("aplicado uma vez, um segundo plano NÃO escreve nada (idempotente)", () => {
    const { licenses, decisions } = projectAfterApply([...STATIC_AUTHORIZATION]);
    const plan2 = planAuthorization(STATIC_AUTHORIZATION, licenses, decisions);
    expect(isPlanClean(plan2)).toBe(true);
    expect(plan2.summary.licensesKeep).toBe(STATIC_AUTHORIZATION.length);
    expect(plan2.summary.decisionsSupersede).toBe(0);
  });
});

describe("plano — supersede da licença-semente", () => {
  it("uma licença vigente diferente do alvo é SUPERSEDIDA (não duplicada)", () => {
    // Semente conservadora do imdb/rating: global, unknown, nada exibível.
    const seed: CurrentLicense = {
      id: "100",
      sourceKey: "imdb",
      contentType: "rating",
      ratingSourceKey: "imdb",
      providerKey: null,
      territory: null,
      licenseStatus: "unknown",
      displayAllowed: false,
      logoAllowed: false,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText: null,
      policyVersion: null,
    };
    const imdbEntry = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "imdb" && e.license.contentType === "rating")!;
    const plan = planAuthorization([imdbEntry], [seed], []);
    expect(plan.entries[0]!.license.action).toBe("supersede");
    expect(plan.entries[0]!.license.currentId).toBe("100");
    // Decisões nascem novas na licença nova (não podem herdar a antiga).
    expect(plan.entries[0]!.decisions.every((d) => d.action === "create")).toBe(true);
  });
});

describe("plano — streaming por provedor real (nunca inventado)", () => {
  it("sem provedores em watch_providers, não há entrada de streaming display", () => {
    expect(streamingProviderEntries([])).toEqual([]);
  });

  it("com um provedor real, gera watch_availability + watch_offer_display (source_key = slug)", () => {
    const entries = streamingProviderEntries([{ slug: "netflix", canonicalName: "Netflix" }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.license.sourceKey).toBe("netflix");
    expect(entries[0]!.license.contentType).toBe("watch_availability");
    expect(entries[0]!.decisions[0]!.useCase).toBe("watch_offer_display");
    expect(entries[0]!.decisions[0]!.territory).toBe("BR");
  });
});

describe("travas do spec — o que NUNCA pode ser autorizado", () => {
  it("nenhuma entrada estática libera logo, review_quote ou obra derivada", () => {
    for (const e of STATIC_AUTHORIZATION) {
      expect(e.license.logoAllowed, e.label).toBe(false);
      expect(e.license.reviewQuoteAllowed, e.label).toBe(false);
      for (const d of e.decisions) expect(d.derivativeAllowed, e.label).toBe(false);
    }
  });

  it("nenhuma decisão é cinerie_score_display (o score permanece bloqueado)", () => {
    for (const e of STATIC_AUTHORIZATION) {
      for (const d of e.decisions) {
        expect(d.useCase).not.toBe("cinerie_score_display");
      }
    }
  });

  it("assertNoBlockedGrants passa no plano estático", () => {
    const plan = planAuthorization(STATIC_AUTHORIZATION, [], []);
    expect(() => assertNoBlockedGrants(plan)).not.toThrow();
  });

  it("assertNoBlockedGrants REJEITA um plano com derivative_allowed", () => {
    const poisoned: AuthorizationEntry = {
      label: "veneno",
      role: "editorial-rating-source",
      license: { ...STATIC_AUTHORIZATION.find((e) => e.license.contentType === "rating")!.license },
      decisions: [
        {
          useCase: "internal_analytics",
          territory: null,
          stage: "approved_for_internal_use",
          displayAllowed: false,
          storageAllowed: true,
          // @ts-expect-error — forçando o estado proibido para provar a trava
          derivativeAllowed: true,
          attributionRequired: true,
          linkbackRequired: true,
          policyVersion: "x",
        },
      ],
    };
    const plan = planAuthorization([poisoned], [], []);
    expect(() => assertNoBlockedGrants(plan)).toThrow(/derivative/);
  });
});

describe("fontes cobertas — papéis distintos (invariante 2)", () => {
  it("classifica corretamente official vs third_party", () => {
    const tmdb = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "tmdb" && e.license.contentType === "other")!;
    expect(tmdb.license.licenseStatus).toBe("official");
    for (const source of ["imdb", "rotten_tomatoes", "metacritic", "letterboxd", "filmaffinity"]) {
      const e = STATIC_AUTHORIZATION.find((x) => x.license.sourceKey === source)!;
      expect(e.license.licenseStatus, source).toBe("third_party");
    }
    const motn = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "movie-of-the-night")!;
    expect(motn.license.licenseStatus).toBe("third_party");
  });

  it("TMDB carrega o disclaimer literal exigido", () => {
    const tmdb = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "tmdb")!;
    expect(tmdb.license.attributionText).toBe(
      "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
    );
  });
});
