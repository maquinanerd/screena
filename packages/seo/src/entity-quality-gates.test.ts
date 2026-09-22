/**
 * Os tres portoes de qualidade das decisoes do dono de 11/09/2026.
 *
 * O que se trava aqui e a REGRA PURA. A concordancia entre esta regra e o SQL do
 * sitemap e provada contra PostgreSQL real, no validador de SEO.
 */

import { describe, expect, it } from "vitest";

import {
  DISPLAYABLE_BIOGRAPHY_SOURCE_STATUSES,
  MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY,
  QUALITY_GATE_ROBOTS,
  TMDB_FALLBACK_SLUG_PATTERN,
  TMDB_FALLBACK_SLUG_SQL_PATTERN,
  evaluateGalleryGate,
  evaluateLocalizationGate,
  evaluatePersonQualityGate,
  isDisplayableBiography,
  isLocalizedTitle,
  requiredIndexableWorks,
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
  const ORIGINAL = "Τίποτα";
  const semNada = {
    localizedTitle: null,
    originalTitle: ORIGINAL,
    hasLocalizedDescription: false,
  };

  it("(3) tmdb-{id} sem titulo e sem descricao => barrada", () => {
    const v = evaluateLocalizationGate({ canonicalSlug: "tmdb-12345", ...semNada });
    expect(v.passed).toBe(false);
    expect(v.code).toBe("not_localized");
  });

  it("(3b) titulo pt-BR IGUAL ao original => barrada: copia nao e traducao", () => {
    // O caso REAL de producao (medido em 17/09/2026): a linha pt-BR existe e
    // carrega o titulo original, e o portao passava a ficha adiante. Eram 11.922
    // fichas tmdb-N no sitemap, praticamente toda a populacao da D3.
    const v = evaluateLocalizationGate({
      canonicalSlug: "tmdb-12345",
      localizedTitle: ORIGINAL,
      originalTitle: ORIGINAL,
      hasLocalizedDescription: false,
    });
    expect(v.passed).toBe(false);
    expect(v.code).toBe("not_localized");
  });

  it("(3c) a copia com espaco em volta tambem e copia", () => {
    expect(
      evaluateLocalizationGate({
        canonicalSlug: "tmdb-12345",
        localizedTitle: `  ${ORIGINAL} `,
        originalTitle: `${ORIGINAL}  `,
        hasLocalizedDescription: false,
      }).passed,
    ).toBe(false);
  });

  it("(4) ganhou titulo em pt-BR => passa, MESMO com o slug ainda tmdb-{id}", () => {
    // Se a condicao fosse so o slug, a ficha enriquecida ficaria fora para sempre.
    const v = evaluateLocalizationGate({
      canonicalSlug: "tmdb-12345",
      localizedTitle: "Nada",
      originalTitle: ORIGINAL,
      hasLocalizedDescription: false,
    });
    expect(v.passed).toBe(true);
    expect(v.code).toBe("localized");
  });

  it("(4b) titulo que difere do original SO pela caixa continua abrindo o portao", () => {
    // Decisao consciente: `lower()` do PostgreSQL depende do collation do cluster
    // e o do JavaScript nao, e divergir entre pagina e sitemap e o defeito que a
    // remediacao fechou. Na duvida, o lado conservador mantem no indice.
    expect(
      evaluateLocalizationGate({
        canonicalSlug: "tmdb-12345",
        localizedTitle: "nada",
        originalTitle: "Nada",
        hasLocalizedDescription: false,
      }).passed,
    ).toBe(true);
  });

  it("(4c) ficha sem titulo original: qualquer titulo na linha publicada localiza", () => {
    expect(
      evaluateLocalizationGate({
        canonicalSlug: "tmdb-12345",
        localizedTitle: "Nada",
        originalTitle: null,
        hasLocalizedDescription: false,
      }).passed,
    ).toBe(true);
  });

  it("(5) ganhou so descricao => passa (basta um dos dois)", () => {
    expect(
      evaluateLocalizationGate({
        canonicalSlug: "tmdb-12345",
        localizedTitle: ORIGINAL,
        originalTitle: ORIGINAL,
        hasLocalizedDescription: true,
      }).passed,
    ).toBe(true);
  });

  it("(5b) isLocalizedTitle: existir nao basta, precisa ser diferente do original", () => {
    expect(isLocalizedTitle(null, "Nada")).toBe(false);
    expect(isLocalizedTitle("   ", "Nada")).toBe(false);
    expect(isLocalizedTitle("Nada", "Nada")).toBe(false);
    expect(isLocalizedTitle("Nada", " Nada ")).toBe(false);
    expect(isLocalizedTitle("Nada de Novo", "Nada")).toBe(true);
    expect(isLocalizedTitle("Nada", null)).toBe(true);
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
  /** O estado de PRODUCAO: biografia com texto e status `unknown` (nada o altera). */
  const semBiografiaExibivel: PersonQualityGateInput = {
    name: "Josh Brolin",
    hasCanonicalSlug: true,
    biography: "Ator norte-americano.",
    biographySourceStatus: "unknown",
    profilePath: "/j.jpg",
    indexableWorkCount: 60,
  };
  const comBiografia: PersonQualityGateInput = {
    name: "Fernanda Montenegro",
    hasCanonicalSlug: true,
    biography: "Atriz brasileira.",
    biographySourceStatus: "licensed",
    profilePath: "/f.jpg",
    indexableWorkCount: 3,
  };

  it("(10) foto + filmografia no indice, SEM biografia exibivel => passa (o caso que o portao antigo barrava)", () => {
    // Medido em producao em 22/09/2026: Josh Brolin, 60 obras, noindex.
    const v = evaluatePersonQualityGate(semBiografiaExibivel);
    expect(v.passed).toBe(true);
    expect(v.code).toBe("eligible");
    expect(v.reason).toContain("filmografia de 60 obras");
  });

  it("(11) o piso e exatamente MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY: no piso passa, um abaixo nao", () => {
    const piso = MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY;
    expect(piso).toBe(5);
    expect(evaluatePersonQualityGate({ ...semBiografiaExibivel, indexableWorkCount: piso }).passed).toBe(true);
    const abaixo = evaluatePersonQualityGate({ ...semBiografiaExibivel, indexableWorkCount: piso - 1 });
    expect(abaixo.passed).toBe(false);
    expect(abaixo.code).toBe("short_filmography");
  });

  it("(12) CONTROLE: biografia com texto mas status `unknown` NAO baixa o piso (invariante 6)", () => {
    // Se a biografia nao liberada contasse, o piso cairia para 1 e 3 obras bastariam.
    const v = evaluatePersonQualityGate({ ...semBiografiaExibivel, indexableWorkCount: 3 });
    expect(v.passed).toBe(false);
    expect(v.code).toBe("short_filmography");
    // Status liberado mas texto vazio tambem nao e biografia exibivel.
    expect(
      evaluatePersonQualityGate({ ...comBiografia, biography: "   " }).code,
    ).toBe("short_filmography");
  });

  it("(13) com biografia EXIBIVEL, uma obra no indice basta", () => {
    expect(evaluatePersonQualityGate({ ...comBiografia, indexableWorkCount: 1 }).passed).toBe(true);
    expect(evaluatePersonQualityGate(comBiografia).reason).toContain("biografia exibivel");
  });

  it("(14) sem foto => barrada, mesmo com filmografia enorme e com biografia", () => {
    expect(
      evaluatePersonQualityGate({ ...semBiografiaExibivel, profilePath: null }).code,
    ).toBe("no_profile_photo");
    expect(evaluatePersonQualityGate({ ...comBiografia, profilePath: "  " }).code).toBe(
      "no_profile_photo",
    );
  });

  it("(15) sem obra no indice => barrada pela regra de elegibilidade que ja existia", () => {
    expect(evaluatePersonQualityGate({ ...comBiografia, indexableWorkCount: 0 }).code).toBe(
      "no_publishable_credit",
    );
  });

  it("(15b) nome e slug vem ANTES: sem eles nao ha pagina para avaliar", () => {
    expect(evaluatePersonQualityGate({ ...comBiografia, name: "" }).code).toBe("name_missing");
    expect(
      evaluatePersonQualityGate({ ...comBiografia, hasCanonicalSlug: false, profilePath: null }).code,
    ).toBe("slug_missing");
  });

  it("(15c) requiredIndexableWorks e isDisplayableBiography: as pecas que o SQL repete", () => {
    expect(requiredIndexableWorks(true)).toBe(1);
    expect(requiredIndexableWorks(false)).toBe(MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY);
    expect(isDisplayableBiography("Texto.", "third_party")).toBe(true);
    expect(isDisplayableBiography("Texto.", "unknown")).toBe(false);
    expect(isDisplayableBiography("Texto.", "blocked")).toBe(false);
    expect(isDisplayableBiography(null, "licensed")).toBe(false);
  });

  it("(16) os status que liberam a biografia sao exatamente os que o SQL do sitemap usa", () => {
    expect([...DISPLAYABLE_BIOGRAPHY_SOURCE_STATUSES]).toEqual(["official", "licensed", "third_party"]);
  });
});
