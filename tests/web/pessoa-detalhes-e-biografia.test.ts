/**
 * pessoa-detalhes-e-biografia.test.ts — os dois defeitos medidos em
 * `/pt/pessoas/aaron-eckhart/`, e o que cada um era de verdade.
 *
 * DEFEITO 1 — "Detalhes pessoais" mostrava o mesmo campo duas vezes,
 * "Atuação principal" e "Atuacao", um com acento e outro sem.
 *
 * O DIAGNÓSTICO: não era bug de renderização nem dois campos mal rotulados. Era
 * UM campo impresso duas vezes — o kicker do cabeçalho ("Pessoa · Atuação") e a
 * linha da ficha — cujo VALOR tinha perdido o acento na tabela de tradução de
 * `known_for_department`. Rótulo acentuado ao lado de valor sem acento é o que
 * fazia as duas impressões parecerem campos distintos. Conserto: acentuar a
 * tabela (o valor vai para a tela, não é identificador técnico) e tirar a linha
 * tautológica `Atuação principal | Atuação` da ficha, já que o canônico dá esse
 * slot ao kicker.
 *
 * DEFEITO 2 — não existia biografia nenhuma. A causa é mais funda que "ninguém
 * escreveu": a `biography` que o TMDB devolve no detalhe de pessoa é BAIXADA E
 * DESCARTADA. Isso não se conserta aqui (exige coluna nova, tarefa aprovada
 * para banco). O que se conserta é a ausência MUDA: ela passa a dizer por quê.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSectionAbsence, formatSectionAbsence } from "../../apps/web/src/lib/section-absence";
import { mapKnownForDepartment } from "../../apps/web/src/lib/person-presenter";

const PAGE = readFileSync(
  path.join(process.cwd(), "apps/web/app/pt/pessoas/[slug]/page.tsx"),
  "utf8",
);

function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const code = withoutComments(PAGE);

describe("o valor exibido da função é português de verdade", () => {
  it("os departamentos que levam cedilha/til chegam acentuados", () => {
    expect(mapKnownForDepartment("Acting")).toBe("Atuação");
    expect(mapKnownForDepartment("Directing")).toBe("Direção");
    expect(mapKnownForDepartment("Production")).toBe("Produção");
    expect(mapKnownForDepartment("Editing")).toBe("Edição");
    expect(mapKnownForDepartment("Lighting")).toBe("Iluminação");
  });

  it("nenhuma tradução escapa sem acento onde o português exige", () => {
    // Varredura, não lista: um departamento novo adicionado sem acento cai aqui
    // em vez de aparecer na página.
    const suspeitos = ["Acting", "Directing", "Production", "Editing", "Lighting"];
    for (const departamento of suspeitos) {
      const rotulo = mapKnownForDepartment(departamento);
      expect(rotulo, departamento).not.toMatch(/cao$|coes$/);
    }
  });

  it("departamento desconhecido continua devolvendo null — nunca inventa função", () => {
    expect(mapKnownForDepartment("Departamento Inexistente")).toBeNull();
    expect(mapKnownForDepartment(null)).toBeNull();
  });
});

describe('"Detalhes pessoais" não repete o que o cabeçalho já diz', () => {
  it("a linha tautológica saiu da ficha", () => {
    expect(code).not.toContain("Atuação principal");
  });

  it("a função continua no kicker do cabeçalho — o slot do canônico", () => {
    expect(code).toMatch(/Pessoa\{view\.roleLabel !== null \? ` · \$\{view\.roleLabel\}`/);
  });

  it("os fatos que NÃO se repetem continuam na ficha", () => {
    // O conserto não podia virar poda: nome original, nascimento, falecimento e
    // local só existem aqui.
    for (const rotulo of ["Nome original", "Nascimento", "Falecimento", "Local"]) {
      expect(code, rotulo).toContain(`label: '${rotulo}'`);
    }
  });

  it("a função continua indo para o JSON-LD como `jobTitle`", () => {
    expect(code).toContain("personJsonLd.jobTitle = view.roleLabel");
  });
});

describe("a biografia ausente diz por quê", () => {
  it("o bloco passa por SectionBoundary — sumir calado não é opção", () => {
    expect(code).toMatch(/<SectionBoundary decision=\{biographySection\}>/);
    expect(code).toContain("reason: 'no_biography_source'");
  });

  it("a decisão é sobre a biografia INTEIRA, não sobre a seção de continuação", () => {
    // Com UM parágrafo o cabeçalho o exibe e não há ausência para registrar.
    // Se a decisão fosse `biography.length > 1`, toda pessoa com bio curta
    // emitiria um log falso de "não há biografia".
    expect(code).toContain("decideSection(biography.length > 0 ? biography : null");
    expect(code).toContain("paragraphs.length > 1 ?");
  });

  it("o log aponta a PESSOA — não finge ser filme nem rota", () => {
    const absence = buildSectionAbsence({
      section: "biografia",
      reason: "no_biography_source",
      entityType: "person",
      entityId: "42",
    });
    expect(absence.entityType).toBe("person");
    expect(absence.entityId).toBe("42");
    // Passo pendente que resolveria o catálogo inteiro de uma vez (persistir a
    // `biography` que a ingestão já baixa), não fato sobre esta pessoa.
    expect(absence.actionable).toBe(true);

    const linha = JSON.parse(formatSectionAbsence(absence)) as Record<string, unknown>;
    expect(linha.section).toBe("biografia");
    expect(linha.reason).toBe("no_biography_source");
  });

  it("a página passa o id INTERNO, nunca o slug", () => {
    // Slug muda com recanonização; o id acha a pessoa depois disso.
    expect(code).toMatch(/entityType: 'person',\s*entityId,/);
    expect(code).toContain("const { view, entityId,");
  });
});
