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
    expect(code).toMatch(/<SectionBoundary decision=\{similarSection\}>/);
  });

  /**
   * O `once` SAIU em 20/08/2026, e a mudanca e de significado, nao de estilo.
   *
   * Ele existia porque a causa era uma propriedade do DEPLOY — "nao existe
   * dataset de similaridade para a vertical" — identica em TODA serie; uma linha
   * por pageview seria ruido puro. Agora a serie TEM dataset
   * (`title_recommendations`, do append que era descartado), e a ausencia passou
   * a ser uma propriedade DESTA serie. A repeticao voltou a carregar informacao
   * (qual serie), e silenciar apagaria exatamente o que o operador precisa.
   */
  it("NEGATIVO: o log deixou de ser `once` — a repeticao agora diz QUAL serie", () => {
    expect(code).not.toMatch(/decision=\{similarSection\}\s+once/);
  });

  it("a serie RENDERIZA o trilho quando ha recomendacao", () => {
    // Ate 20/08/2026 o `SectionBoundary` desta pagina devolvia `() => null`:
    // nao havia o que renderizar, so o que logar. O sinal chegou.
    expect(code).toMatch(/<SimilarTitles[^>]*view=\{similarView\}/);
  });

  it("a decisao e sobre DADO real, nao sobre `null` literal", () => {
    // O defeito que o enunciado nomeou: "estado vazio NAO prova filtro". Enquanto
    // a pagina passasse `null` fixo, qualquer teste de ausencia passaria sem que
    // houvesse filtro nenhum por tras.
    expect(code).toMatch(/decideSection\(similar,/);
    expect(code).not.toMatch(/decideSection\(null,\s*\{\s*\.\.\.entityRef,\s*section: 'mais-como-este'/);
  });

  it("o motivo continua sendo `no_recommendation_dataset`", () => {
    // O motivo nao mudou porque o que falta, quando falta, continua sendo o
    // DATASET (o TMDB nao recomendou nada, ou nenhum alvo foi ingerido) — e as
    // duas coisas se consertam com ingestao, nao com curadoria deste titulo.
    expect(code).toContain("reason: 'no_recommendation_dataset'");
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
