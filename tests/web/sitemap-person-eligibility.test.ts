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
 *
 * ONDE O PORTAO MORA (mudou em 22/09/2026, sem afrouxar nada). Ele era uma
 * subconsulta CORRELACIONADA dentro do WHERE, refeita para cada pessoa; o index
 * do sitemap chegou a 31,7 s em producao. Passou a ser DUAS CTEs materializadas
 * — `obra_no_indice` e `obras_por_pessoa` — calculadas uma vez e reusadas. As
 * asercoes foram REAPONTADAS para as CTEs; nenhuma foi removida, e a exigencia
 * de texto identico entre contagem, pagina e listagem ficou MAIOR (agora cobre
 * as CTEs tambem).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY,
  PERSON_ELIGIBILITY_CONTRACT,
} from "@screena/seo";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Fim de linha normalizado: o checkout do Windows traz CRLF, e o teste compara
// blocos de dois arquivos.
const source = readFileSync(
  path.join(repoRoot, "apps", "web", "src", "server", "seo", "sitemap-index.ts"),
  "utf8",
).replace(/\r\n/g, "\n");
const listingSource = readFileSync(
  path.join(repoRoot, "apps", "web", "src", "server", "entity-indexes.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

/** Inicio e fim do PORTAO DE PESSOA dentro de um bloco de consulta. */
const GATE_START = "-- PORTAO DE PESSOA (decisao do dono D2";
const GATE_END =
  "AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d\n          WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id";

/** Inicio e fim das CTEs que computam a filmografia no indice. */
const CTE_START = "obra_no_indice AS MATERIALIZED (";
const CTE_END = "GROUP BY c.person_id\n      )";

/**
 * O portao de pessoa de um trecho de SQL, entre a primeira linha do comentario e
 * a decisao da PROPRIA pessoa. Se uma ancora deixar de casar, as asercoes
 * reprovam — o teste nunca compara strings vazias e conclui "iguais".
 */
function extractGate(block: string): string {
  const start = block.indexOf(GATE_START);
  const end = block.indexOf(GATE_END, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return block.slice(start, end).trim();
}

/**
 * As CTEs da filmografia. Mesma disciplina do `extractGate`: ancora que nao casa
 * REPROVA, em vez de devolver vazio e deixar a comparacao passar por vacuidade.
 */
function extractCtes(block: string): string {
  const start = block.indexOf(CTE_START);
  const end = block.indexOf(CTE_END, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return block.slice(start, end + CTE_END.length).trim();
}

/**
 * Isola os dois blocos de consulta de pessoa. `aggregateEntity` conta;
 * `pageEntity` devolve a pagina. Cada um tem a sua propria copia do SQL — CTEs
 * e WHERE.
 */
function personQueryBlocks(): string[] {
  const blocks = source.split('if (type === "people") {');
  // O primeiro pedaco e o que vem ANTES da primeira consulta de pessoa.
  return blocks.slice(1);
}

describe("sitemap — gate de elegibilidade de pessoa", () => {
  it("(1) existem exatamente DUAS consultas de pessoa (contagem + pagina)", () => {
    expect(personQueryBlocks()).toHaveLength(2);
  });

  it("(2) AMBAS exigem credito em obra publicavel (cast_members + crew_members)", () => {
    for (const block of personQueryBlocks()) {
      const ctes = extractCtes(block);
      for (const table of PERSON_ELIGIBILITY_CONTRACT.creditTables) {
        expect(ctes).toContain(table);
      }
    }
  });

  it("(3) AMBAS restringem o credito a filme/serie — episodio nao qualifica sozinho", () => {
    for (const block of personQueryBlocks()) {
      const ctes = extractCtes(block);
      expect(ctes).toContain("IN ('movie','tv')");
      expect(ctes).not.toContain("'episode'");
    }
  });

  it("(4) AMBAS exigem que a OBRA tenha slug canonico no mesmo idioma", () => {
    for (const block of personQueryBlocks()) {
      expect(extractCtes(block)).toContain("ws.is_canonical = true");
    }
  });

  it("(5) contagem e pagina usam o MESMO gate e as MESMAS CTEs, caractere a caractere", () => {
    const blocks = personQueryBlocks();
    expect(extractGate(blocks[0] ?? "")).toBe(extractGate(blocks[1] ?? ""));
    // A filmografia saiu do WHERE para as CTEs: sem esta linha, metade da regra
    // deixaria de ser comparada e duas redacoes diferentes passariam.
    expect(extractCtes(blocks[0] ?? "")).toBe(extractCtes(blocks[1] ?? ""));
  });

  it("(6) o gate continua PARAMETRIZADO — idioma nunca concatenado em SQL", () => {
    for (const block of personQueryBlocks()) {
      const ctes = extractCtes(block);
      expect(ctes).toContain("ws.language_code = ${language}");
      expect(ctes).not.toMatch(/language_code\s*=\s*'/);
    }
  });

  it("(7) D2, leitura de 22/09/2026: foto obrigatoria, biografia OPCIONAL, piso de obras", () => {
    for (const block of personQueryBlocks()) {
      const gate = extractGate(block);
      expect(gate).toContain("AND BTRIM(COALESCE(p.profile_path, '')) <> ''");
      // A biografia nao e mais um AND solto: ela so escolhe o piso (1 ou o minimo).
      expect(gate).not.toMatch(/\n\s*AND BTRIM\(COALESCE\(p\.biography, ''\)\) <> ''\n/);
      expect(gate).toContain("THEN 1");
      expect(gate).toContain("ELSE ${MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY}");
      // O piso e comparado contra a filmografia ja contada nas CTEs.
      expect(gate).toContain("AND COALESCE(opp.obras, 0) >= CASE");
    }
    expect(MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY).toBe(5);
  });

  it("(8) conta OBRA distinta, nao linha de credito", () => {
    for (const block of personQueryBlocks()) {
      const ctes = extractCtes(block);
      // O `UNION` que deduplicava POR PESSOA virou `UNION ALL` + `COUNT(DISTINCT)`:
      // o mesmo resultado sem deduplicar o universo inteiro de creditos. Contar
      // LINHA (sem o DISTINCT) faria a pessoa creditada no elenco e na equipe do
      // mesmo titulo valer por duas obras.
      expect(ctes).toContain("COUNT(DISTINCT (c.entity_type, c.entity_id))");
      expect(ctes).toContain("UNION ALL");
    }
  });

  it("(9) a obra so conta se estiver NO INDICE: titulo, portao D3 e decisao efetiva", () => {
    for (const block of personQueryBlocks()) {
      const ctes = extractCtes(block);
      expect(ctes).toContain("BTRIM(COALESCE(wm.title_original, wt.name_original, '')) <> ''");
      expect(ctes).toContain("ws.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}");
      expect(ctes).toContain("et.language_code = ANY(${PUBLISHED_LOCALE_CODES})");
      expect(ctes).toContain(
        "CASE ws.entity_type::text WHEN 'movie' THEN ${absentMovie} ELSE ${absentTv} END) = 'index'",
      );
    }
  });

  it("(10) a LISTAGEM /pt/pessoas/ aplica o MESMO portao, caractere a caractere", () => {
    // Quem abre a listagem tem de ser quem o sitemap oferece ao indice. Uma
    // terceira redacao da regra voltaria a divergir em silencio.
    const listing = listingSource.slice(listingSource.indexOf("async function readFeaturedPeople("));
    expect(listing.length).toBeGreaterThan(0);
    expect(extractGate(listing)).toBe(extractGate(personQueryBlocks()[0] ?? ""));
    expect(extractCtes(listing)).toBe(extractCtes(personQueryBlocks()[0] ?? ""));
    // E a decisao persistida da PROPRIA pessoa tambem, como no sitemap.
    expect(listing).toContain("LIMIT 1), ${absentPerson}) = 'index'");
  });

  it("(11) CONTROLE: os extratores reprovam quando o portao ou as CTEs somem", () => {
    // Sem este controle, um portao apagado das duas consultas passaria no (5)
    // comparando nada com nada.
    expect(() => extractGate("SELECT 1 FROM people p")).toThrow();
    expect(() => extractCtes("SELECT 1 FROM people p")).toThrow();
  });
});
