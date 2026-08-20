/**
 * series-similar-absence.test.ts — a faixa final da SERIE nao reserva metade da
 * largura para nada, e o motivo da ausencia e o certo.
 *
 * O QUE ESTE ARQUIVO GUARDA, E O QUE ELE NAO PROVA. A prova de que a grade
 * COLAPSA (estilo computado das trilhas, nos dois estados) vive em
 * `apps/web/app/_components/__tests__/similar-titles-computed.test.tsx`. Aqui a
 * pergunta e outra e so a serie tem: o `<div />` morto saiu, o caminho passa
 * pelo `SectionBoundary` (que loga) e o motivo escolhido e o de VERTICAL, nao o
 * de entidade.
 *
 * A assercao de fonte roda sobre o arquivo SEM COMENTARIOS: neste repositorio
 * uma guarda que varre texto ja aprovou e reprovou pelo motivo errado por causa
 * de comentario.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSectionAbsence } from "../../apps/web/src/lib/section-absence";

const PAGE = readFileSync(
  path.join(process.cwd(), "apps/web/app/pt/series/[slug]/page.tsx"),
  "utf8",
);

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const code = withoutComments(PAGE);

describe("a coluna morta saiu da faixa final da serie", () => {
  it("nao ha mais elemento vazio de preenchimento dentro da grade", () => {
    // O defeito era exatamente esta linha: `<div />` como segunda coluna.
    expect(code).not.toMatch(/<div\s*\/>/);
  });

  it("a classe da grade e DECIDIDA pelo bloco, nao fixa", () => {
    expect(code).toContain("similarSection.rendered ? 'ficha-grid' : 'ficha-grid ficha-grid--solo'");
  });

  it("a ausencia passa pelo SectionBoundary — sumir calado nao e opcao", () => {
    expect(code).toMatch(/<SectionBoundary decision=\{similarSection\} once>/);
  });

  it("o motivo e o de VERTICAL, nao o de entidade", () => {
    // Serie nao tem dataset nenhum (so filme tem colecao). Usar o motivo de
    // entidade aqui diria ao operador que faltou ESTA serie, e ele iria olhar o
    // lugar errado.
    expect(code).toContain("reason: 'no_recommendation_dataset'");
    expect(code).not.toContain("reason: 'no_recommendation_for_entity'");
  });
});

describe("os dois motivos nao dizem a mesma coisa", () => {
  const base = { section: "mais-como-este", entityId: "1" } as const;

  it("sem dataset para a vertical => alguem precisa agir", () => {
    const absence = buildSectionAbsence({
      ...base,
      entityType: "tv",
      reason: "no_recommendation_dataset",
    });
    expect(absence.actionable).toBe(true);
  });

  it("dataset existe e o titulo nao esta nele => fato sobre a obra", () => {
    const absence = buildSectionAbsence({
      ...base,
      entityType: "movie",
      reason: "no_recommendation_for_entity",
    });
    expect(absence.actionable).toBe(false);
  });
});
