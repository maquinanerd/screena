/**
 * Testes de `projectPublicIndexability` — a projecao FAIL-CLOSED da decisao
 * vigente de `page_indexability_decisions` para um contrato publico.
 *
 * Motivo (achado de revisao humana): o contrato publico cravava
 * `index: true` / `robots: 'index,follow'` para toda entidade com slug,
 * ignorando a decisao registrada. Slug e resolucao de ROTA; indexabilidade e
 * decisao REGISTRADA. Estes testes travam a regra.
 */

import { describe, expect, it } from "vitest";
import {
  formatRobots,
  projectPublicIndexability,
  type IndexDecision,
} from "./resolver.js";

/** Fatos persistidos minimos para uma decisao. */
function facts(decision: IndexDecision) {
  return { decision, decisionOrigin: "seo_policy_engine", policyVersion: "2026-07" };
}

describe("projectPublicIndexability", () => {
  it("ausencia de decisao e FAIL-CLOSED (o silencio nao autoriza indexar)", () => {
    expect(projectPublicIndexability(null)).toEqual({
      index: false,
      robots: "noindex,follow",
      decision: "absent",
    });
  });

  it("'index' e a UNICA decisao que indexa", () => {
    expect(projectPublicIndexability(facts("index"))).toEqual({
      index: true,
      robots: "index,follow",
      decision: "index",
    });
  });

  it.each([
    ["noindex", "noindex,nofollow"],
    ["blocked", "noindex,nofollow"],
    ["draft", "noindex,follow"],
    ["stale", "noindex,follow"],
  ] as const)("'%s' nao indexa (robots=%s)", (decision, robots) => {
    const projection = projectPublicIndexability(facts(decision));
    expect(projection.index).toBe(false);
    expect(projection.robots).toBe(robots);
    expect(projection.decision).toBe(decision);
  });

  it("index e robots NUNCA se contradizem, em toda decisao possivel", () => {
    const all: (IndexDecision | null)[] = [
      null,
      "index",
      "noindex",
      "draft",
      "stale",
      "blocked",
    ];
    for (const decision of all) {
      const projection = projectPublicIndexability(
        decision === null ? null : facts(decision),
      );
      expect(
        projection.robots.startsWith("index,"),
        `${projection.decision}: robots=${projection.robots} vs index=${projection.index}`,
      ).toBe(projection.index);
    }
  });

  it("noindex/blocked sao exclusao REGISTRADA (nofollow); draft/stale seguem links", () => {
    // A distincao importa: uma exclusao decidida nao deve propagar crawl; um
    // rascunho/stale ainda e conteudo nosso que voltara ao indice.
    expect(projectPublicIndexability(facts("noindex")).robots).toContain("nofollow");
    expect(projectPublicIndexability(facts("blocked")).robots).toContain("nofollow");
    expect(projectPublicIndexability(facts("draft")).robots).toContain(",follow");
    expect(projectPublicIndexability(facts("stale")).robots).toContain(",follow");
  });
});

describe("formatRobots", () => {
  it("serializa as 4 combinacoes", () => {
    expect(formatRobots({ index: true, follow: true })).toBe("index,follow");
    expect(formatRobots({ index: true, follow: false })).toBe("index,nofollow");
    expect(formatRobots({ index: false, follow: true })).toBe("noindex,follow");
    expect(formatRobots({ index: false, follow: false })).toBe("noindex,nofollow");
  });
});
