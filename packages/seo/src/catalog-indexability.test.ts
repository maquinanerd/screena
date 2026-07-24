/**
 * Testes da politica de indexabilidade de catalogo.
 *
 * Os dois eixos que importam: PRECEDENCIA (licenca > idioma > tecnico > tipo) e
 * DETERMINISMO (mesmo estado -> mesma decisao, senao o produtor vira churn).
 */

import { describe, expect, it } from "vitest";
import {
  CATALOG_POLICY_VERSION,
  decideCatalogIndexability,
  decisionChanged,
  type CatalogEntityFacts,
} from "./catalog-indexability.js";

const publishableMovie: CatalogEntityFacts = {
  entityType: "movie",
  language: "pt-BR",
  hasCanonicalSlug: true,
  hasTitle: true,
  hasTranslation: true,
};

describe("decideCatalogIndexability — precedencia", () => {
  it("(1) filme completo em idioma publicado indexa (invariante 5)", () => {
    const d = decideCatalogIndexability(publishableMovie);
    expect(d.decision).toBe("index");
    expect(d.reason).toBe("eligible");
  });

  it("(2) LICENCA bloqueada vence tudo (invariante 6)", () => {
    const d = decideCatalogIndexability({
      ...publishableMovie,
      displayedRatings: [
        { licenseDisplayAllowed: false },
      ],
    });
    expect(d.decision).toBe("blocked");
    expect(d.reason).toBe("blocked_license");
  });

  it("(3) idioma nao publicado vira draft, mesmo com tudo completo (invariante 7)", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, language: "en" });
    expect(d.decision).toBe("draft");
    expect(d.reason).toBe("language_not_published");
  });

  it("(4) licenca vence idioma: bloqueado em idioma nao publicado continua blocked", () => {
    const d = decideCatalogIndexability({
      ...publishableMovie,
      language: "en",
      displayedRatings: [
        { licenseDisplayAllowed: false },
      ],
    });
    expect(d.decision).toBe("blocked");
  });

  it("(5) sem slug -> noindex tecnico", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, hasCanonicalSlug: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("missing_slug");
  });

  it("(6) sem titulo -> noindex tecnico", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, hasTitle: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("missing_title");
  });

  it("(7) sem traducao -> noindex (nao indexa meia pagina)", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, hasTranslation: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("missing_translation");
  });
});

describe("decideCatalogIndexability — gates por tipo", () => {
  const person: CatalogEntityFacts = {
    entityType: "person",
    language: "pt-BR",
    hasCanonicalSlug: true,
    hasTitle: true,
    hasTranslation: true,
    publishableCreditCount: 2,
  };

  it("(8) pessoa COM credito em obra publicavel indexa", () => {
    expect(decideCatalogIndexability(person).decision).toBe("index");
  });

  it("(9) pessoa SEM credito publicavel -> noindex (o caso das ~22.400)", () => {
    const d = decideCatalogIndexability({ ...person, publishableCreditCount: 0 });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("no_eligible_credit");
  });

  it("(10) temporada herda a serie: serie nao publicavel -> temporada noindex", () => {
    const d = decideCatalogIndexability({
      entityType: "season",
      language: "pt-BR",
      hasCanonicalSlug: true,
      hasTitle: true,
      hasTranslation: true,
      parentPublishable: false,
    });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("parent_not_publishable");
  });

  it("(11) episodio com serie publicavel indexa", () => {
    const d = decideCatalogIndexability({
      entityType: "episode",
      language: "pt-BR",
      hasCanonicalSlug: true,
      hasTitle: true,
      hasTranslation: true,
      parentPublishable: true,
    });
    expect(d.decision).toBe("index");
  });

  it("(12) temporada sem informacao do pai NAO indexa (fail-closed)", () => {
    // `parentPublishable` ausente = nao sabemos. Fail-closed: nao indexa.
    const d = decideCatalogIndexability({
      entityType: "season",
      language: "pt-BR",
      hasCanonicalSlug: true,
      hasTitle: true,
      hasTranslation: true,
    });
    expect(d.decision).toBe("noindex");
  });
});

describe("determinismo e churn", () => {
  it("(13) mesma entrada -> mesma saida, sempre", () => {
    const a = decideCatalogIndexability(publishableMovie);
    const b = decideCatalogIndexability({ ...publishableMovie });
    expect(a).toEqual(b);
  });

  it("(14) decisao inalterada NAO gera linha nova (sem churn)", () => {
    const next = decideCatalogIndexability(publishableMovie);
    const persisted = {
      decision: next.decision,
      reason: next.reason,
      policyVersion: next.policyVersion,
    };
    expect(decisionChanged(next, persisted)).toBe(false);
  });

  it("(15) sem decisao anterior, sempre grava", () => {
    expect(decisionChanged(decideCatalogIndexability(publishableMovie), null)).toBe(true);
  });

  it("(16) mudou a RAZAO com o mesmo veredito -> grava (auditabilidade)", () => {
    const next = decideCatalogIndexability({ ...publishableMovie, hasTitle: false });
    const persisted = {
      decision: "noindex",
      reason: "missing_slug", // veredito igual, razao diferente
      policyVersion: CATALOG_POLICY_VERSION,
    };
    expect(decisionChanged(next, persisted)).toBe(true);
  });

  it("(17) mudou so a VERSAO DA POLITICA -> grava (distingue regra de entidade)", () => {
    const next = decideCatalogIndexability(publishableMovie);
    const persisted = {
      decision: next.decision,
      reason: next.reason,
      policyVersion: "catalog-indexability-v0",
    };
    expect(decisionChanged(next, persisted)).toBe(true);
  });

  it("(18) toda decisao carrega versao e origem (rastreabilidade)", () => {
    for (const facts of [publishableMovie, { ...publishableMovie, hasCanonicalSlug: false }]) {
      const d = decideCatalogIndexability(facts);
      expect(d.policyVersion).toBe(CATALOG_POLICY_VERSION);
      expect(d.origin).toBe("catalog_policy_engine");
      expect(d.explanation.trim()).not.toBe("");
    }
  });
});
