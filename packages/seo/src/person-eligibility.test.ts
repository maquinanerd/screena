/**
 * Testes da regra de elegibilidade de PESSOA.
 *
 * O que estes testes travam: uma pessoa so vira pagina publica quando tem nome,
 * slug canonico e pelo menos um credito em obra PUBLICAVEL. O caso decisivo e o
 * (3): sem ele, o catalogo volta a publicar milhares de stubs de elenco.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_PUBLISHABLE_CREDITS,
  PERSON_ELIGIBILITY_CONTRACT,
  evaluatePersonEligibility,
} from "./person-eligibility.js";

const base = {
  name: "Fernanda Torres",
  hasCanonicalSlug: true,
  publishableCreditCount: 3,
};

describe("evaluatePersonEligibility", () => {
  it("(1) aprova pessoa com nome, slug e creditos em obra publicavel", () => {
    const decision = evaluatePersonEligibility(base);
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBeNull();
  });

  it("(2) REPROVA pessoa sem nenhum credito em obra publicavel", () => {
    const decision = evaluatePersonEligibility({ ...base, publishableCreditCount: 0 });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("no_publishable_credit");
  });

  it("(3) REPROVA pessoa sem slug canonico (caso tecnico)", () => {
    const decision = evaluatePersonEligibility({ ...base, hasCanonicalSlug: false });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("slug_missing");
  });

  it("(4) REPROVA pessoa sem nome, inclusive so-espacos", () => {
    expect(evaluatePersonEligibility({ ...base, name: "" }).reason).toBe("name_missing");
    expect(evaluatePersonEligibility({ ...base, name: "   " }).reason).toBe("name_missing");
  });

  it("(5) precedencia: falta de nome vence falta de credito", () => {
    const decision = evaluatePersonEligibility({
      name: "",
      hasCanonicalSlug: false,
      publishableCreditCount: 0,
    });
    expect(decision.reason).toBe("name_missing");
  });

  it("(6) o minimo e exatamente MIN_PUBLISHABLE_CREDITS (fronteira)", () => {
    const atMinimum = evaluatePersonEligibility({
      ...base,
      publishableCreditCount: MIN_PUBLISHABLE_CREDITS,
    });
    const belowMinimum = evaluatePersonEligibility({
      ...base,
      publishableCreditCount: MIN_PUBLISHABLE_CREDITS - 1,
    });
    expect(atMinimum.eligible).toBe(true);
    expect(belowMinimum.eligible).toBe(false);
  });

  it("(7) toda decisao carrega explicacao nao vazia (auditabilidade)", () => {
    const cases = [
      base,
      { ...base, name: "" },
      { ...base, hasCanonicalSlug: false },
      { ...base, publishableCreditCount: 0 },
    ];
    for (const input of cases) {
      expect(evaluatePersonEligibility(input).explanation.trim()).not.toBe("");
    }
  });
});

describe("PERSON_ELIGIBILITY_CONTRACT", () => {
  it("(8) so 'movie' e 'tv' sustentam relevancia — episodio NAO conta sozinho", () => {
    expect([...PERSON_ELIGIBILITY_CONTRACT.creditEntityTypes]).toEqual(["movie", "tv"]);
    expect([...PERSON_ELIGIBILITY_CONTRACT.creditEntityTypes]).not.toContain("episode");
  });

  it("(9) considera as DUAS tabelas de credito (elenco e equipe)", () => {
    expect([...PERSON_ELIGIBILITY_CONTRACT.creditTables]).toEqual([
      "cast_members",
      "crew_members",
    ]);
  });

  it("(10) o contrato SQL e o modulo puro usam o MESMO minimo", () => {
    expect(PERSON_ELIGIBILITY_CONTRACT.minPublishableCredits).toBe(MIN_PUBLISHABLE_CREDITS);
  });
});
