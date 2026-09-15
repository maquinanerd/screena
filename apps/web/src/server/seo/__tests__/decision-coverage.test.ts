/**
 * decision-coverage — a regra que decide o que a AUSENCIA de decisao significa.
 *
 * Desde 2026-09-11 ela governa dois consumidores (o SQL do sitemap e o `<meta
 * robots>` da pagina). O que se trava aqui e a parte sem banco: o piso que arma o
 * gate, a leitura do resultado e a memoria curta da pagina. A leitura contra
 * PostgreSQL real e a paridade pagina x sitemap moram no validador de SEO.
 */

import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_DECISION_COVERAGE,
  SITEMAP_DECISION_GATE_MIN_ROWS,
  absentDecisionFor,
  createCoverageMemo,
  isDecisionGateArmed,
  readDecisionCoverage,
  unarmedDecisionEntities,
  type DecisionCoverage,
} from "../decision-coverage";

const PISO = SITEMAP_DECISION_GATE_MIN_ROWS;

/** Um cliente que so conhece `$queryRaw` — o unico metodo que a leitura usa. */
function clienteFalso(rows: unknown[] | Error) {
  const $queryRaw = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  return { client: { $queryRaw } as never, $queryRaw };
}

describe("o gate arma por cobertura, e por TIPO", () => {
  it("(1) abaixo do piso esta desarmado; no piso, armado", () => {
    expect(isDecisionGateArmed({ ...EMPTY_DECISION_COVERAGE, movie: PISO - 1 }, "movie")).toBe(false);
    expect(isDecisionGateArmed({ ...EMPTY_DECISION_COVERAGE, movie: PISO }, "movie")).toBe(true);
  });

  it("(2) armado, a ausencia vale noindex; desarmado, vale index (o comportamento antigo)", () => {
    const armado: DecisionCoverage = { ...EMPTY_DECISION_COVERAGE, movie: PISO };
    expect(absentDecisionFor(armado, "movie")).toBe("noindex");
    expect(absentDecisionFor(EMPTY_DECISION_COVERAGE, "movie")).toBe("index");
  });

  it("(3) armar FILME nao arma SERIE: cada tipo espera a propria prova", () => {
    const soFilme: DecisionCoverage = { ...EMPTY_DECISION_COVERAGE, movie: PISO * 50 };
    expect(absentDecisionFor(soFilme, "tv")).toBe("index");
    expect(unarmedDecisionEntities(soFilme)).toEqual(["tv", "person", "season", "episode"]);
  });
});

describe("a leitura", () => {
  it("(4) le as contagens por tipo e ignora tipo desconhecido e numero invalido", async () => {
    const { client } = clienteFalso([
      { entity_type: "movie", n: 1_000 },
      { entity_type: "tv", n: "12" },
      { entity_type: "person", n: "abc" },
      { entity_type: "article", n: 999 },
    ]);
    const cobertura = await readDecisionCoverage(client, "pt-BR");
    expect(cobertura).toEqual({ movie: 1_000, tv: 12, person: 0, season: 0, episode: 0 });
  });

  it("(5) falha de banco SOBE — cobertura zero em cima de erro desarmaria o gate por um timeout", async () => {
    const { client } = clienteFalso(new Error("db down"));
    await expect(readDecisionCoverage(client, "pt-BR")).rejects.toThrow("db down");
  });

  it("(6) a leitura crua nao memoriza: duas chamadas, duas consultas (quem memoriza e a camada da pagina)", async () => {
    const { client, $queryRaw } = clienteFalso([{ entity_type: "movie", n: 5 }]);
    await readDecisionCoverage(client, "pt-BR");
    await readDecisionCoverage(client, "pt-BR");
    expect($queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("a memoria curta da pagina", () => {
  const cobertura: DecisionCoverage = { ...EMPTY_DECISION_COVERAGE, movie: PISO };

  it("(7) dentro da janela, carrega UMA vez", async () => {
    const memo = createCoverageMemo(60_000);
    const load = vi.fn(async () => cobertura);
    await memo.read("pt-BR", load, 0);
    await memo.read("pt-BR", load, 59_999);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("(8) passada a janela, carrega de novo", async () => {
    const memo = createCoverageMemo(60_000);
    const load = vi.fn(async () => cobertura);
    await memo.read("pt-BR", load, 0);
    await memo.read("pt-BR", load, 60_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("(9) a memoria e por IDIOMA", async () => {
    const memo = createCoverageMemo(60_000);
    const load = vi.fn(async () => cobertura);
    await memo.read("pt-BR", load, 0);
    await memo.read("en", load, 1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("(10) uma falha NAO fica memorizada: a chamada seguinte tenta de novo", async () => {
    const memo = createCoverageMemo(60_000);
    const load = vi
      .fn<() => Promise<DecisionCoverage>>()
      .mockRejectedValueOnce(new Error("soluco"))
      .mockResolvedValueOnce(cobertura);
    await expect(memo.read("pt-BR", load, 0)).rejects.toThrow("soluco");
    await expect(memo.read("pt-BR", load, 1)).resolves.toEqual(cobertura);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("(11) `reset` esquece dentro da janela — e o que o validador usa depois de armar o gate", async () => {
    const memo = createCoverageMemo(60_000);
    const load = vi.fn(async () => cobertura);
    await memo.read("pt-BR", load, 0);
    memo.reset();
    await memo.read("pt-BR", load, 1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
