/**
 * Testes do FREIO de mudanca em massa da indexabilidade.
 *
 * Dois eixos:
 *
 *  1. POLARIDADE. O sitemap trata AUSENCIA de decisao como "dentro"
 *     (`NOT EXISTS (... decision <> 'index')`). Se essa leitura estiver
 *     invertida, o freio mede o oposto do que acontece: deixaria passar a
 *     retirada em massa e travaria o crescimento normal do catalogo. E o unico
 *     fato deste modulo que nao e aritmetica.
 *
 *  2. ARITMETICA DO TETO. Absoluto e proporcional em OU, comparacao estrita, e
 *     o opt-in que LIBERA a escrita sem apagar o registro de que houve mudanca
 *     em massa.
 */

import { describe, expect, it } from "vitest";
import {
  censusMassChange,
  classifyIndexFlip,
  DEFAULT_MASS_CHANGE_THRESHOLDS,
  evaluateMassChangeBrake,
  isEffectivelyIndexed,
  resolveMassChangeThresholds,
  type PlannedTransition,
} from "./catalog-mass-change.js";

describe("isEffectivelyIndexed — a polaridade do sitemap", () => {
  it("AUSENCIA de decisao conta como DENTRO do sitemap", () => {
    // `NOT EXISTS (... decision <> 'index')`: sem linha vigente, nada exclui a
    // entidade. Inverter isto inverte o freio inteiro.
    expect(isEffectivelyIndexed(null)).toBe(true);
  });

  it("'index' conta como dentro", () => {
    expect(isEffectivelyIndexed("index")).toBe(true);
  });

  it("noindex, draft e blocked contam como FORA", () => {
    expect(isEffectivelyIndexed("noindex")).toBe(false);
    expect(isEffectivelyIndexed("draft")).toBe(false);
    expect(isEffectivelyIndexed("blocked")).toBe(false);
  });
});

describe("classifyIndexFlip", () => {
  it("null -> index NAO e flip: e o crescimento normal do catalogo", () => {
    // Entidade nova que finaliza com slug + titulo + traducao. Ja estava dentro
    // (sem linha), continua dentro. O ciclo horario faz isto o tempo todo e nao
    // pode ser confundido com reindexacao em massa.
    expect(classifyIndexFlip(null, "index")).toBe("no_flip");
  });

  it("null -> noindex E flip: a pagina SAI do sitemap", () => {
    expect(classifyIndexFlip(null, "noindex")).toBe("leaves_index");
    expect(classifyIndexFlip(null, "draft")).toBe("leaves_index");
    expect(classifyIndexFlip(null, "blocked")).toBe("leaves_index");
  });

  it("index -> noindex E flip de saida", () => {
    expect(classifyIndexFlip("index", "noindex")).toBe("leaves_index");
  });

  it("noindex -> index E flip de entrada", () => {
    expect(classifyIndexFlip("noindex", "index")).toBe("enters_index");
  });

  it("noindex -> draft NAO e flip: so mudou a razao, continua fora", () => {
    expect(classifyIndexFlip("noindex", "draft")).toBe("no_flip");
    expect(classifyIndexFlip("draft", "blocked")).toBe("no_flip");
  });

  it("index -> index NAO e flip (reemissao por bump de policy_version)", () => {
    // Subir CATALOG_POLICY_VERSION sozinho reemite as linhas com o mesmo
    // veredito: zero flips, zero mudanca de sitemap, freio nao dispara.
    expect(classifyIndexFlip("index", "index")).toBe("no_flip");
  });
});

describe("censusMassChange", () => {
  const transitions: readonly PlannedTransition[] = [
    { entityType: "movie", previousDecision: "index", nextDecision: "noindex", nextReason: "missing_translation" },
    { entityType: "movie", previousDecision: "index", nextDecision: "noindex", nextReason: "missing_translation" },
    { entityType: "person", previousDecision: "index", nextDecision: "noindex", nextReason: "no_eligible_credit" },
    { entityType: "tv", previousDecision: "noindex", nextDecision: "index", nextReason: "eligible" },
    // Ruido que NAO deve entrar no censo:
    { entityType: "movie", previousDecision: null, nextDecision: "index", nextReason: "eligible" },
    { entityType: "movie", previousDecision: "noindex", nextDecision: "draft", nextReason: "language_not_published" },
  ];

  it("conta apenas os FLIPS, agrupados por razao e por tipo", () => {
    const census = censusMassChange(transitions, 1000);
    expect(census.leavesIndex).toBe(3);
    expect(census.entersIndex).toBe(1);
    expect(census.byReason).toEqual({
      missing_translation: 2,
      no_eligible_credit: 1,
      eligible: 1,
    });
    expect(census.byEntityType).toEqual({ movie: 2, person: 1, tv: 1 });
  });

  it("`evaluated` vem de FORA, nao do numero de transicoes", () => {
    // Se o denominador fosse o proprio plano, a razao daria sempre ~100% e o
    // teto proporcional dispararia em qualquer execucao que mudasse algo.
    expect(censusMassChange(transitions, 53_054).evaluated).toBe(53_054);
  });

  it("plano vazio produz censo zerado", () => {
    const census = censusMassChange([], 500);
    expect(census.entersIndex).toBe(0);
    expect(census.leavesIndex).toBe(0);
    expect(census.byReason).toEqual({});
  });
});

/** Fabrica um censo com `flips` saidas em `evaluated` avaliadas. */
function censusWith(flips: number, evaluated: number) {
  const transitions: PlannedTransition[] = [];
  for (let i = 0; i < flips; i += 1) {
    transitions.push({
      entityType: "movie",
      previousDecision: "index",
      nextDecision: "noindex",
      nextReason: "missing_translation",
    });
  }
  return censusMassChange(transitions, evaluated);
}

describe("evaluateMassChangeBrake — os tetos", () => {
  it("deriva normal de uma hora passa livre", () => {
    // 12 flips em 53.054: 0,02%. E o regime em que o ciclo horario vive.
    const v = evaluateMassChangeBrake({ census: censusWith(12, 53_054), confirmed: false });
    expect(v.exceeded).toBe(false);
    expect(v.blocked).toBe(false);
  });

  it("o teto ABSOLUTO dispara mesmo com proporcao pequena", () => {
    // 600 flips em 1.000.000: 0,06% (abaixo dos 5%), mas 600 paginas mudando de
    // lado sem humano nenhum e indexacao em massa.
    const v = evaluateMassChangeBrake({ census: censusWith(600, 1_000_000), confirmed: false });
    expect(v.exceeded).toBe(true);
    expect(v.exceededBy).toEqual(["absolute"]);
    expect(v.blocked).toBe(true);
  });

  it("o teto PROPORCIONAL dispara mesmo com poucos flips absolutos", () => {
    // 30 flips em 300: 10%. Longe dos 500 absolutos, mas e um decimo do acervo.
    const v = evaluateMassChangeBrake({ census: censusWith(30, 300), confirmed: false });
    expect(v.exceeded).toBe(true);
    expect(v.exceededBy).toEqual(["ratio"]);
    expect(v.blocked).toBe(true);
  });

  it("o teto e o ultimo valor ACEITO: 500 passa, 501 trava", () => {
    const limits = { maxFlipRatio: 1 }; // isola o teto absoluto
    const ok = evaluateMassChangeBrake({
      census: censusWith(500, 100_000),
      thresholds: limits,
      confirmed: false,
    });
    const nope = evaluateMassChangeBrake({
      census: censusWith(501, 100_000),
      thresholds: limits,
      confirmed: false,
    });
    expect(ok.exceeded).toBe(false);
    expect(nope.exceeded).toBe(true);
  });

  it("catalogo vazio nao divide por zero", () => {
    const v = evaluateMassChangeBrake({ census: censusWith(0, 0), confirmed: false });
    expect(v.flipRatio).toBe(0);
    expect(v.exceeded).toBe(false);
  });

  it("a mudanca que motivou o freio (53.054 -> 2.338 URLs) dispara nos DOIS tetos", () => {
    const v = evaluateMassChangeBrake({ census: censusWith(50_716, 53_054), confirmed: false });
    expect(v.exceededBy).toEqual(["absolute", "ratio"]);
    expect(v.blocked).toBe(true);
    expect(v.explanation).toContain("RECUSADA");
    expect(v.explanation).toContain("--confirm-mass-change");
  });
});

describe("evaluateMassChangeBrake — o opt-in humano", () => {
  it("confirmado LIBERA a escrita sem apagar o fato", () => {
    // `exceeded` continua true: a execucao FOI uma mudanca em massa, e o resumo
    // precisa poder dizer isso. So `blocked` cede ao opt-in.
    const v = evaluateMassChangeBrake({ census: censusWith(50_716, 53_054), confirmed: true });
    expect(v.exceeded).toBe(true);
    expect(v.blocked).toBe(false);
    expect(v.explanation).toContain("CONFIRMADA");
  });

  it("confirmar sem estourar teto nao inventa mudanca em massa", () => {
    const v = evaluateMassChangeBrake({ census: censusWith(3, 53_054), confirmed: true });
    expect(v.exceeded).toBe(false);
    expect(v.blocked).toBe(false);
  });
});

describe("resolveMassChangeThresholds", () => {
  it("sem argumento, os defaults sao 500 / 5%", () => {
    expect(resolveMassChangeThresholds()).toEqual(DEFAULT_MASS_CHANGE_THRESHOLDS);
    expect(DEFAULT_MASS_CHANGE_THRESHOLDS).toEqual({ maxFlips: 500, maxFlipRatio: 0.05 });
  });

  it("aceita override parcial sem perder o outro teto", () => {
    expect(resolveMassChangeThresholds({ maxFlips: 10 })).toEqual({
      maxFlips: 10,
      maxFlipRatio: 0.05,
    });
  });

  it("sanea valor absurdo em vez de virar teto infinito", () => {
    // Um NaN vindo de parse ruim nao pode significar "sem limite": comparacao
    // com NaN e sempre false, e o freio ficaria permanentemente desarmado.
    expect(resolveMassChangeThresholds({ maxFlips: Number.NaN }).maxFlips).toBe(500);
    expect(resolveMassChangeThresholds({ maxFlips: -5 }).maxFlips).toBe(0);
    expect(resolveMassChangeThresholds({ maxFlipRatio: 7 }).maxFlipRatio).toBe(1);
    expect(resolveMassChangeThresholds({ maxFlipRatio: -1 }).maxFlipRatio).toBe(0);
  });
});
