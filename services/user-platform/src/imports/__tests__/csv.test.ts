/**
 * Testes do leitor de CSV (C8). Cobrem os casos que exports REAIS produzem:
 * BOM, CRLF, aspas, virgula dentro de campo, acentuacao e arquivos malformados.
 */

import { describe, expect, it } from "vitest";
import { CSV_MAX_ROWS, indexHeader, parseCsv, readColumn, stripBom } from "../csv.js";

const BOM = "﻿";

describe("parseCsv", () => {
  it("(1) le cabecalho e linhas simples", () => {
    const r = parseCsv("title,year\nAlien,1979\nDune,2021");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.header).toEqual(["title", "year"]);
    expect(r.value.rows).toEqual([
      ["Alien", "1979"],
      ["Dune", "2021"],
    ]);
  });

  it("(2) remove BOM e aceita CRLF", () => {
    const r = parseCsv(`${BOM}title,year\r\nAlien,1979\r\n`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.header).toEqual(["title", "year"]);
    expect(r.value.rows).toEqual([["Alien", "1979"]]);
  });

  it("(3) campo citado com virgula, aspas escapadas e quebra de linha", () => {
    const csv = 'title,note\n"Alien, o 8o passageiro","ele disse ""corra"""\n"multi\nlinha",ok';
    const r = parseCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows[0]).toEqual(["Alien, o 8o passageiro", 'ele disse "corra"']);
    expect(r.value.rows[1]).toEqual(["multi\nlinha", "ok"]);
  });

  it("(4) preserva acentuacao e caracteres internacionais", () => {
    const r = parseCsv("title\nAmélie\n千と千尋の神隠し\nCoração");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows.map((row) => row[0])).toEqual(["Amélie", "千と千尋の神隠し", "Coração"]);
  });

  it("(5) arquivo vazio e recusado", () => {
    expect(parseCsv("").ok).toBe(false);
    expect(parseCsv("   \n  ").ok).toBe(false);
  });

  it("(6) aspas nao fechadas sao recusadas (nao engolem o arquivo)", () => {
    const r = parseCsv('title\n"sem fim, o resto do arquivo');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.details?.join(" ")).toContain("aspas");
  });

  it("(7) linha em branco no meio/fim e ignorada", () => {
    const r = parseCsv("title\nAlien\n\nDune\n\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows).toEqual([["Alien"], ["Dune"]]);
  });

  it("(8) arquivo acima do teto de linhas e recusado", () => {
    const linhas = ["title", ...Array.from({ length: CSV_MAX_ROWS + 5 }, (_, i) => `t${i}`)];
    const r = parseCsv(linhas.join("\n"));
    expect(r.ok).toBe(false);
  });

  it("(9) 10.000 linhas sao aceitas (limite operacional real)", () => {
    const linhas = ["title,year", ...Array.from({ length: 10_000 }, (_, i) => `Filme ${i},20${10 + (i % 10)}`)];
    const r = parseCsv(linhas.join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows).toHaveLength(10_000);
  });
});

describe("stripBom / indexHeader / readColumn", () => {
  it("(1) stripBom remove so o BOM inicial", () => {
    expect(stripBom(`${BOM}abc`)).toBe("abc");
    expect(stripBom("abc")).toBe("abc");
  });

  it("(2) indexHeader normaliza e mantem a PRIMEIRA coluna duplicada", () => {
    const idx = indexHeader([" Title ", "Year", "title"]);
    expect(idx.get("title")).toBe(0);
    expect(idx.get("year")).toBe(1);
  });

  it("(3) readColumn devolve null para ausente/vazio", () => {
    const idx = indexHeader(["title", "year"]);
    expect(readColumn(["Alien", "1979"], idx, "title")).toBe("Alien");
    expect(readColumn(["Alien", "  "], idx, "year")).toBeNull();
    expect(readColumn(["Alien"], idx, "year")).toBeNull();
    expect(readColumn(["Alien"], idx, "inexistente")).toBeNull();
  });
});
