/**
 * watch-browse-foryou-absence.test.ts — "Para você" não vira caixa vazia, e a
 * ausência não é muda.
 *
 * O QUE ESTAVA ERRADO. A seção renderizava SEMPRE, com um `EmptyState` dizendo
 * "recomendações personalizadas ainda não estão disponíveis". Não é um trilho
 * vazio à espera de dado: não existe, em lugar nenhum, quem produza a
 * recomendação — nem para visitante logado. Uma seção que NUNCA pode ter
 * sucesso gasta a atenção do leitor à toa e faz a página parecer quebrada. É a
 * mesma decisão já tomada na faixa de newsletter, pelo mesmo motivo.
 *
 * O QUE ESTE ARQUIVO GUARDA. As duas metades juntas: a seção sai do DOM **e** o
 * motivo vai para o log. Um teste que provasse só a primeira deixaria voltar
 * exatamente o defeito que `section-absence.ts` existe para impedir.
 *
 * A asserção de fonte roda sobre o arquivo SEM COMENTÁRIOS — neste repositório
 * uma guarda que varre texto já aprovou e reprovou pelo motivo errado por causa
 * de comentário.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildRouteSectionAbsence,
  decideRouteSection,
  formatSectionAbsence,
} from "../../apps/web/src/lib/section-absence";

const PAGE = readFileSync(
  path.join(process.cwd(), "apps/web/app/pt/onde-assistir/page.tsx"),
  "utf8",
);

function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const code = withoutComments(PAGE);

describe('"Para você" não renderiza', () => {
  it("a promessa vazia saiu da página", () => {
    // O texto que a caixa exibia. Se ele voltar, a caixa voltou.
    expect(code).not.toContain("Recomendações personalizadas");
  });

  it("o bloco passa por SectionBoundary — sumir calado não é opção", () => {
    expect(code).toMatch(/<SectionBoundary decision=\{forYouSection\} once>/);
  });

  it("a decisão é de ROTA e nomeia a causa", () => {
    expect(code).toContain("section: 'para-voce'");
    expect(code).toContain("reason: 'no_recommendation_service'");
  });

  it("o EmptyState continua servindo o caso que PODE mudar (sem oferta ainda)", () => {
    // A distinção importa: "nenhuma oferta licenciada ainda" é um estado que o
    // catálogo resolve sozinho quando a licença entrar. "Não existe serviço de
    // recomendação" não é — e por isso um vira caixa e o outro vira ausência.
    expect(code).toContain("Ainda não há disponibilidade de streaming licenciada");
  });
});

describe("a ausência carrega o que o operador precisa", () => {
  const context = {
    section: "para-voce",
    reason: "no_recommendation_service",
    route: "/pt/onde-assistir/",
    vertical: "mixed",
  } as const;

  it("é passo pendente (alguém constrói o serviço), não fato sobre o catálogo", () => {
    expect(buildRouteSectionAbsence(context).actionable).toBe(true);
  });

  it("aponta a ROTA, não um id de título que não existiria", () => {
    const absence = buildRouteSectionAbsence(context);
    expect(absence.route).toBe("/pt/onde-assistir/");
    expect(absence).not.toHaveProperty("entityId");
  });

  it("a linha de log é JSON filtrável, não prosa", () => {
    const line = JSON.parse(formatSectionAbsence(buildRouteSectionAbsence(context))) as Record<
      string,
      unknown
    >;
    expect(line.event).toBe("section_absent");
    expect(line.section).toBe("para-voce");
    expect(line.reason).toBe("no_recommendation_service");
  });

  it("`decideRouteSection(null)` nunca produz decisão renderizável", () => {
    const decision = decideRouteSection<never>(null, context);
    expect(decision.rendered).toBe(false);
    expect(decision.absence).not.toBeNull();
  });
});
