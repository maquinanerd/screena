/**
 * Testes do PORTAO DE QUALIDADE do hero.
 *
 * Quase todos sao CONTROLES NEGATIVOS: descrevem um titulo que NAO pode ser
 * destaque e exigem a recusa. Com o codigo anterior (ordenacao por ano desc, sem
 * portao nenhum) todos reprovam — inclusive o caso "Der Liebesbrief", que e o
 * registro real que motivou a mudanca.
 *
 * O ultimo e um CONTROLE POSITIVO, e ele nao e formalidade: sem ele, um portao
 * que recusasse TUDO passaria em todos os negativos. Um teste de rejeicao so
 * significa alguma coisa quando alguem consegue entrar.
 */

import { describe, expect, it } from "vitest";

import {
  HERO_MIN_VOTE_COUNT,
  heroRejectionReason,
  isHeroEligible,
  type HeroCandidateFacts,
} from "../home-hero-eligibility";

const AGORA = new Date("2026-08-25T12:00:00.000Z");

/** Um titulo que passa em tudo. Cada teste estraga UM fato de cada vez. */
function completo(over: Partial<HeroCandidateFacts> = {}): HeroCandidateFacts {
  return {
    kind: "movie",
    backdropPath: "/backdrop.jpg",
    posterPath: "/poster.jpg",
    voteCount: 4_200,
    summary: "Um resumo editorial em pt-BR, com conteudo de verdade.",
    releaseDate: new Date("2023-05-10T00:00:00.000Z"),
    status: "Released",
    ...over,
  };
}

describe("portao do hero — controles negativos", () => {
  it('"Der Liebesbrief": ano 2057 NAO entra', () => {
    const facts = completo({ releaseDate: new Date("2057-01-01T00:00:00.000Z") });
    expect(heroRejectionReason(facts, AGORA)).toBe("ano_implausivel");
    expect(isHeroEligible(facts, AGORA)).toBe(false);
  });

  it("titulo SEM backdrop NAO entra", () => {
    expect(heroRejectionReason(completo({ backdropPath: null }), AGORA)).toBe("sem_backdrop");
  });

  it("backdrop so de espacos conta como ausente", () => {
    expect(heroRejectionReason(completo({ backdropPath: "   " }), AGORA)).toBe("sem_backdrop");
  });

  it("titulo SEM poster NAO entra (o retangulo bege da home)", () => {
    expect(heroRejectionReason(completo({ posterPath: null }), AGORA)).toBe("sem_poster");
  });

  it("titulo com vote_count 3 NAO entra", () => {
    expect(heroRejectionReason(completo({ voteCount: 3 }), AGORA)).toBe("votos_insuficientes");
  });

  it("vote_count ausente NAO entra (fail-closed)", () => {
    expect(heroRejectionReason(completo({ voteCount: null }), AGORA)).toBe("votos_insuficientes");
  });

  it(`exatamente ${HERO_MIN_VOTE_COUNT - 1} votos ainda NAO entra; ${HERO_MIN_VOTE_COUNT} entra`, () => {
    expect(heroRejectionReason(completo({ voteCount: HERO_MIN_VOTE_COUNT - 1 }), AGORA)).toBe(
      "votos_insuficientes",
    );
    expect(heroRejectionReason(completo({ voteCount: HERO_MIN_VOTE_COUNT }), AGORA)).toBeNull();
  });

  it("titulo SEM sinopse pt-BR NAO entra", () => {
    expect(heroRejectionReason(completo({ summary: null }), AGORA)).toBe("sem_sinopse_pt_br");
    expect(heroRejectionReason(completo({ summary: "  " }), AGORA)).toBe("sem_sinopse_pt_br");
  });

  it("estreia FUTURA nao entra no hero (pertence a Em breve)", () => {
    const facts = completo({ releaseDate: new Date("2026-12-01T00:00:00.000Z") });
    expect(heroRejectionReason(facts, AGORA)).toBe("estreia_futura");
  });

  it("filme nao lancado (status != Released) NAO entra", () => {
    expect(heroRejectionReason(completo({ status: "Post Production" }), AGORA)).toBe("nao_lancado");
    expect(heroRejectionReason(completo({ status: null }), AGORA)).toBe("nao_lancado");
  });

  it("ano anterior a 1888 NAO entra", () => {
    const facts = completo({ releaseDate: new Date("1870-01-01T00:00:00.000Z") });
    expect(heroRejectionReason(facts, AGORA)).toBe("ano_implausivel");
  });

  it("sem data de estreia NAO entra (nao ha como provar que estreou)", () => {
    expect(heroRejectionReason(completo({ releaseDate: null }), AGORA)).toBe("estreia_futura");
  });
});

describe("portao do hero — o que a data ainda permite", () => {
  it("estreia distante porem PLAUSIVEL (ano_atual + 3) nao e recusada por implausibilidade", () => {
    // Ela ainda cai por `estreia_futura` — o ponto e que o motivo e outro: a
    // data nao e lixo, so nao chegou. Confundir os dois mandaria o operador
    // procurar erro de cadastro onde ha apenas um anuncio legitimo.
    const facts = completo({ releaseDate: new Date("2029-06-01T00:00:00.000Z") });
    expect(heroRejectionReason(facts, AGORA)).toBe("estreia_futura");
  });

  it("ano_atual + 4 ja e implausivel", () => {
    const facts = completo({ releaseDate: new Date("2030-06-01T00:00:00.000Z") });
    expect(heroRejectionReason(facts, AGORA)).toBe("ano_implausivel");
  });
});

describe("portao do hero — serie", () => {
  it('serie NAO precisa de status "Released" (que nem existe para serie)', () => {
    const serie = completo({ kind: "series", status: "Returning Series" });
    expect(heroRejectionReason(serie, AGORA)).toBeNull();
  });

  it("serie encerrada continua elegivel", () => {
    expect(heroRejectionReason(completo({ kind: "series", status: "Ended" }), AGORA)).toBeNull();
  });

  it("serie tambem obedece arte, votos e sinopse", () => {
    expect(heroRejectionReason(completo({ kind: "series", voteCount: 10 }), AGORA)).toBe(
      "votos_insuficientes",
    );
  });
});

describe("portao do hero — controle positivo", () => {
  it("um titulo completo ENTRA (sem isto, o zero seria vacuo)", () => {
    expect(heroRejectionReason(completo(), AGORA)).toBeNull();
    expect(isHeroEligible(completo(), AGORA)).toBe(true);
  });

  it("estreia HOJE entra (o corte e `<= agora`, nao `< hoje`)", () => {
    const facts = completo({ releaseDate: new Date("2026-08-25T00:00:00.000Z") });
    expect(heroRejectionReason(facts, AGORA)).toBeNull();
  });
});
