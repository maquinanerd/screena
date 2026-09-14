/**
 * Os tres portoes de qualidade das decisoes do dono de 11/09/2026.
 *
 * O que se trava aqui e a REGRA PURA. A concordancia entre esta regra e o SQL do
 * sitemap e provada contra PostgreSQL real, no validador de SEO.
 */

import { describe, expect, it } from "vitest";

import {
  DISPLAYABLE_BIOGRAPHY_SOURCE_STATUSES,
  QUALITY_GATE_ROBOTS,
  TMDB_FALLBACK_SLUG_PATTERN,
  TMDB_FALLBACK_SLUG_SQL_PATTERN,
  evaluateGalleryGate,
  evaluateLocalizationGate,
  evaluatePersonQualityGate,
  type PersonQualityGateInput,
} from "./entity-quality-gates.js";

describe("portao de qualidade — desfecho", () => {
  it("(1) barrado e noindex, FOLLOW: a pagina e valida, os links dela seguem valendo", () => {
    expect(QUALITY_GATE_ROBOTS).toEqual({ index: false, follow: true });
  });
});

describe("D1 — galeria", () => {
  it("(2) nunca passa — nem com muitas imagens, nem com o dono indexado", () => {
    // Nao recebe entrada DE PROPOSITO: o vazamento da galeria de episodio vinha
    // de decidir pelo piso de quantidade sem olhar o dono.
    const v = evaluateGalleryGate();
    expect(v.passed).toBe(false);
    expect(v.gate).toBe("gallery");
    expect(v.reason).toContain("D1");
  });
});

describe("D3 — ficha com slug de fallback", () => {
  const semNada = { hasLocalizedTitle: false, hasLocalizedDescription: false };

  it("(3) tmdb-{id} sem titulo e sem descricao => barrada", () => {
    const v = evaluateLocalizationGate({ canonicalSlug: "tmdb-12345", ...semNada });
    expect(v.passed).toBe(false);
    expect(v.code).toBe("not_localized");
  });

  it("(4) ganhou titulo em pt-BR => passa, MESMO com o slug ainda tmdb-{id}", () => {
    // Se a condicao fosse so o slug, a ficha enriquecida ficaria fora para sempre.
    const v = evaluateLocalizationGate({
      canonicalSlug: "tmdb-12345",
      hasLocalizedTitle: true,
      hasLocalizedDescription: false,
    });
    expect(v.passed).toBe(true);
    expect(v.code).toBe("localized");
  });

  it("(5) ganhou so descricao => passa (basta um dos dois)", () => {
    expect(
      evaluateLocalizationGate({
        canonicalSlug: "tmdb-12345",
        hasLocalizedTitle: false,
        hasLocalizedDescription: true,
      }).passed,
    ).toBe(true);
  });

  it("(6) slug legivel NAO entra no portao, mesmo sem titulo nem descricao", () => {
    // O portao e sobre o que o dono decidiu (as fichas tmdb-{id}), nao uma regra
    // nova para o catalogo inteiro.
    expect(evaluateLocalizationGate({ canonicalSlug: "a-origem", ...semNada }).passed).toBe(true);
  });

  it("(7) o sufixo de COLISAO nao e fallback: la o titulo produziu slug", () => {
    expect(TMDB_FALLBACK_SLUG_PATTERN.test("espaco-1999-tmdb-134")).toBe(false);
    expect(evaluateLocalizationGate({ canonicalSlug: "espaco-1999-tmdb-134", ...semNada }).passed).toBe(
      true,
    );
  });

  it.each([["tmdb-"], ["tmdb-abc"], ["tmdb-12-a"], ["xtmdb-12"]])(
    "(8) %s nao e slug de fallback",
    (slug) => {
      expect(TMDB_FALLBACK_SLUG_PATTERN.test(slug)).toBe(false);
    },
  );

  it("(9) a regex do SQL descreve a MESMA linguagem que a do JavaScript", () => {
    // Uma traducao por codigo seria melhor que duas strings; aqui ao menos se
    // prova que as duas aceitam e recusam o mesmo conjunto de amostras.
    const sql = new RegExp(TMDB_FALLBACK_SLUG_SQL_PATTERN);
    for (const amostra of ["tmdb-1", "tmdb-999999", "tmdb-", "tmdb-1a", "a-tmdb-1", "espaco-1999-tmdb-134"]) {
      expect(sql.test(amostra), amostra).toBe(TMDB_FALLBACK_SLUG_PATTERN.test(amostra));
    }
  });
});

describe("D2 — pessoa", () => {
  const completa: PersonQualityGateInput = {
    name: "Fernanda Montenegro",
    hasCanonicalSlug: true,
    biography: "Atriz brasileira.",
    biographySourceStatus: "licensed",
    profilePath: "/f.jpg",
    indexableCreditCount: 3,
  };

  it("(10) com biografia exibivel, foto e credito indexavel => passa", () => {
    const v = evaluatePersonQualityGate(completa);
    expect(v.passed).toBe(true);
    expect(v.code).toBe("eligible");
  });

  it("(11) biografia com texto mas status `unknown` NAO conta (invariante 6)", () => {
    // E o estado de producao hoje: a coluna nasce unknown e nada a altera.
    const v = evaluatePersonQualityGate({ ...completa, biographySourceStatus: "unknown" });
    expect(v.passed).toBe(false);
    expect(v.code).toBe("no_displayable_biography");
  });

  it("(12) status liberado mas biografia vazia tambem nao conta", () => {
    expect(evaluatePersonQualityGate({ ...completa, biography: "   " }).code).toBe(
      "no_displayable_biography",
    );
  });

  it("(13) sem foto => barrada", () => {
    expect(evaluatePersonQualityGate({ ...completa, profilePath: null }).code).toBe("no_profile_photo");
  });

  it("(14) sem credito em obra indexavel => barrada, pela regra de elegibilidade que ja existia", () => {
    expect(evaluatePersonQualityGate({ ...completa, indexableCreditCount: 0 }).code).toBe(
      "no_publishable_credit",
    );
  });

  it("(15) nome e slug vem ANTES: sem eles nao ha pagina para avaliar", () => {
    expect(evaluatePersonQualityGate({ ...completa, name: "" }).code).toBe("name_missing");
    expect(
      evaluatePersonQualityGate({ ...completa, hasCanonicalSlug: false, biography: null }).code,
    ).toBe("slug_missing");
  });

  it("(16) os status que liberam a biografia sao exatamente os que o SQL do sitemap usa", () => {
    expect([...DISPLAYABLE_BIOGRAPHY_SOURCE_STATUSES]).toEqual(["official", "licensed", "third_party"]);
  });
});
