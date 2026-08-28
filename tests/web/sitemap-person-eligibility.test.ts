/**
 * Governanca: o gate de ELEGIBILIDADE DE PESSOA no sitemap.
 *
 * Este teste le o SQL do runtime como TEXTO. Nao e um teste de banco (esse vive
 * nos validadores PostgreSQL) — e uma trava estrutural contra dois erros que o
 * typecheck nao pega e que so apareceriam em producao:
 *
 *  1. o gate sumir de uma das consultas (voltando a publicar stubs de elenco);
 *  2. a consulta de CONTAGEM e a de PAGINA divergirem — o index anunciaria N
 *     shards que a pagina nao consegue preencher, gerando shards vazios.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERSON_ELIGIBILITY_CONTRACT } from "@screena/seo";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(
  path.join(repoRoot, "apps", "web", "src", "server", "seo", "sitemap-index.ts"),
  "utf8",
);

/**
 * Isola os dois blocos de consulta de pessoa. `aggregateEntity` conta;
 * `pageEntity` devolve a pagina. Cada um tem a sua propria copia do WHERE.
 */
function personQueryBlocks(): string[] {
  const blocks = source.split("FROM slugs s JOIN people p ON p.id = s.entity_id");
  // O primeiro pedaco e o que vem ANTES da primeira consulta de pessoa.
  return blocks.slice(1);
}

describe("sitemap — gate de elegibilidade de pessoa", () => {
  it("(1) existem exatamente DUAS consultas de pessoa (contagem + pagina)", () => {
    expect(personQueryBlocks()).toHaveLength(2);
  });

  it("(2) AMBAS exigem credito em obra publicavel (cast_members + crew_members)", () => {
    for (const block of personQueryBlocks()) {
      const gate = block.slice(0, block.indexOf("`"));
      for (const table of PERSON_ELIGIBILITY_CONTRACT.creditTables) {
        expect(gate).toContain(table);
      }
    }
  });

  it("(3) AMBAS restringem o credito a filme/serie — episodio nao qualifica sozinho", () => {
    for (const block of personQueryBlocks()) {
      const gate = block.slice(0, block.indexOf("`"));
      expect(gate).toContain("IN ('movie','tv')");
      expect(gate).not.toContain("'episode'");
    }
  });

  it("(4) AMBAS exigem que a OBRA tenha slug canonico no mesmo idioma", () => {
    for (const block of personQueryBlocks()) {
      const gate = block.slice(0, block.indexOf("`"));
      expect(gate).toContain("ws.is_canonical = true");
    }
  });

  it("(5) contagem e pagina usam o MESMO gate, caractere a caractere", () => {
    const blocks = personQueryBlocks();
    const aggregate = blocks[0] ?? "";
    const page = blocks[1] ?? "";
    const extract = (block: string): string => {
      const start = block.indexOf("AND EXISTS (");
      // A ancora do FIM e a clausula de decisao DA PROPRIA PESSOA, logo depois
      // do gate de credito. Ela mudou de forma quando o sitemap inverteu a regra
      // (`NOT EXISTS ... <> 'index'` -> `COALESCE(...) = 'index'`, 2026-08-27):
      // a ancora foi REAPONTADA, nao a mudanca revertida. Se ela deixar de casar,
      // `start`/`end` viram -1 e as duas asercoes abaixo reprovam — o teste nunca
      // compara strings vazias e conclui "iguais".
      const end = block.indexOf(
        "AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d",
      );
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return block.slice(start, end).trim();
    };
    expect(extract(aggregate)).toBe(extract(page));
  });

  it("(6) o gate continua PARAMETRIZADO — idioma nunca concatenado em SQL", () => {
    for (const block of personQueryBlocks()) {
      const gate = block.slice(0, block.indexOf("`"));
      expect(gate).toContain("ws.language_code = ${language}");
      expect(gate).not.toMatch(/language_code\s*=\s*'/);
    }
  });
});
