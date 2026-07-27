/**
 * Testes do mapeamento por fonte e da normalizacao (C8).
 */

import { describe, expect, it } from "vitest";
import { parseCsv } from "../csv.js";
import { parseSourceRows, validateSourceHeader } from "../sources.js";
import {
  neutralizeSpreadsheetFormula,
  normalizeTitleForMatch,
  parseImdbId,
  parseImportDate,
  parseRating,
  parseTmdbId,
  parseYear,
} from "../normalize.js";

function table(csv: string) {
  const r = parseCsv(csv);
  if (!r.ok) throw new Error(`csv invalido no teste: ${r.error.message}`);
  return r.value;
}

describe("validateSourceHeader", () => {
  it("(1) aceita cabecalho correto e recusa o da fonte errada", () => {
    expect(validateSourceHeader("cinerie_csv", table("title,year\nA,2000")).ok).toBe(true);
    expect(validateSourceHeader("letterboxd_csv", table("Name,Year\nA,2000")).ok).toBe(true);
    // Arquivo do Letterboxd enviado como cinerie_csv: falta `title`.
    const r = validateSourceHeader("cinerie_csv", table("Name,Year\nA,2000"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details?.join(" ")).toContain("title");
  });
});

describe("parseSourceRows — cinerie_csv", () => {
  it("(1) le id externo, estado, data e nota", () => {
    const t = table(
      "entity_type,tmdb_id,imdb_id,title,year,state,watched_at,list,rating\n" +
        "movie,348,tt0078748,Alien,1979,watched,2024-05-05,,4.5",
    );
    const { records, rejected } = parseSourceRows("cinerie_csv", t, "watched");
    expect(rejected).toHaveLength(0);
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.tmdbId).toBe(348);
    expect(r.imdbId).toBe("tt0078748");
    expect(r.year).toBe(1979);
    expect(r.targetState).toBe("watched");
    expect(r.watchedAt?.toISOString()).toBe("2024-05-05T00:00:00.000Z");
    expect(r.rating).toBe(4.5);
    expect(r.rawRowNumber).toBe(2);
  });

  it("(2) linha sem titulo E sem id externo e REJEITADA com motivo", () => {
    const t = table("title,tmdb_id\n,\nAlien,");
    const { records, rejected } = parseSourceRows("cinerie_csv", t, "watched");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.rawRowNumber).toBe(2);
    expect(records).toHaveLength(1);
  });

  it("(3) item de lista sem nome de lista e rejeitado", () => {
    const t = table("title,state,list\nAlien,list_item,");
    const { rejected } = parseSourceRows("cinerie_csv", t, "watched");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain("lista");
  });
});

describe("parseSourceRows — letterboxd_csv", () => {
  it("(1) le Name/Year/Rating e NAO inventa id externo", () => {
    const t = table("Date,Name,Year,Letterboxd URI,Rating\n2024-05-05,Alien,1979,https://boxd.it/x,4.5");
    const { records } = parseSourceRows("letterboxd_csv", t, "watched");
    const r = records[0]!;
    expect(r.title).toBe("Alien");
    expect(r.year).toBe(1979);
    expect(r.rating).toBe(4.5);
    // O export do Letterboxd NAO traz TMDB/IMDb: por isso nunca casa `exact`.
    expect(r.tmdbId).toBeNull();
    expect(r.imdbId).toBeNull();
    expect(r.entityType).toBe("movie");
  });

  it("(2) o estado alvo vem do ARQUIVO escolhido, nao de uma coluna", () => {
    const t = table("Date,Name,Year\n2024-05-05,Alien,1979");
    expect(parseSourceRows("letterboxd_csv", t, "watchlist").records[0]!.targetState).toBe("watchlist");
    expect(parseSourceRows("letterboxd_csv", t, "watched").records[0]!.targetState).toBe("watched");
  });

  it("(3) watchlist nao carrega carimbo de assistido", () => {
    const t = table("Date,Name,Year\n2024-05-05,Alien,1979");
    expect(parseSourceRows("letterboxd_csv", t, "watchlist").records[0]!.watchedAt).toBeNull();
  });
});

describe("normalizacao", () => {
  it("(1) titulo normalizado ignora acento e pontuacao", () => {
    expect(normalizeTitleForMatch("WALL·E")).toBe("wall e");
    expect(normalizeTitleForMatch("Amélie")).toBe("amelie");
    expect(normalizeTitleForMatch("  Alien:  o 8º  ")).toBe("alien o 8");
  });

  it("(2) neutraliza formula de planilha (CSV injection)", () => {
    expect(neutralizeSpreadsheetFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    // Hifen NAO e neutralizado: titulos legitimos comecam com hifen.
    expect(neutralizeSpreadsheetFormula("-30-")).toBe("-30-");
  });

  it("(3) ano fora da faixa plausivel e descartado", () => {
    expect(parseYear("1979")).toBe(1979);
    expect(parseYear("(2021)")).toBe(2021);
    expect(parseYear("1000")).toBeNull();
    expect(parseYear("abc")).toBeNull();
    expect(parseYear(null)).toBeNull();
  });

  it("(4) data invalida vira null (nunca `now()`)", () => {
    expect(parseImportDate("2024-05-05")?.toISOString()).toBe("2024-05-05T00:00:00.000Z");
    expect(parseImportDate("2024-02-31")).toBeNull();
    expect(parseImportDate("nao e data")).toBeNull();
    expect(parseImportDate(null)).toBeNull();
  });

  it("(5) nota converte a escala de ORIGEM explicitamente", () => {
    expect(parseRating("4.5", 5)).toBe(4.5);
    // Escala 10 (IMDb) vira 5 — a conversao exige saber a origem.
    expect(parseRating("9", 10)).toBe(4.5);
    expect(parseRating("10", 10)).toBe(5);
    expect(parseRating("0", 5)).toBeNull();
    expect(parseRating("abc", 5)).toBeNull();
  });

  it("(6) ids externos sao validados quanto a forma", () => {
    expect(parseTmdbId("348")).toBe(348);
    expect(parseTmdbId("tt123")).toBeNull();
    expect(parseImdbId("tt0078748")).toBe("tt0078748");
    expect(parseImdbId("0078748")).toBeNull();
  });
});
