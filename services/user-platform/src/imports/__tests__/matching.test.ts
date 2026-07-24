/**
 * Testes do matching e do plano de importacao (C8).
 *
 * A garantia que estes testes existem para travar: uma linha AMBIGUA nunca vira
 * escrita silenciosa, e a data local nunca e sobrescrita pelo arquivo.
 */

import { describe, expect, it } from "vitest";
import { classifyMatch, isAutoApplicable, tallyConfidences } from "../matching.js";
import { buildImportPlan, existingStateKey, type ExistingEntityState } from "../plan.js";
import { dedupeRecords } from "../sources.js";
import type { MatchCandidate, NormalizedImportRecord } from "../types.js";

function record(over: Partial<NormalizedImportRecord> = {}): NormalizedImportRecord {
  return {
    rawRowNumber: 2,
    entityType: "movie",
    title: "Alien",
    titleNormalized: "alien",
    year: 1979,
    tmdbId: null,
    imdbId: null,
    targetState: "watched",
    watchedAt: null,
    listName: null,
    rating: null,
    ...over,
  };
}

const candidato = (id: bigint, year: number | null = 1979): MatchCandidate => ({
  entityType: "movie",
  entityId: id,
  title: "Alien",
  year,
});

describe("classifyMatch", () => {
  it("(1) id externo unico => exact (unico caminho auto-aplicavel)", () => {
    const m = classifyMatch(record({ tmdbId: 348 }), {
      byExternalId: [candidato(1n)],
      byTitle: [],
    });
    expect(m.confidence).toBe("exact");
    expect(m.resolved?.entityId).toBe(1n);
    expect(isAutoApplicable(m.confidence)).toBe(true);
  });

  it("(2) titulo + ano com resultado unico => high_confidence, NAO auto-aplicavel", () => {
    const m = classifyMatch(record(), { byExternalId: [], byTitle: [candidato(1n)] });
    expect(m.confidence).toBe("high_confidence");
    // Sinal forte, porem sem regra formal de desambiguacao: fica para o usuario.
    expect(isAutoApplicable(m.confidence)).toBe(false);
  });

  it("(3) titulo + ano com varios resultados => ambiguous, sem resolved", () => {
    const m = classifyMatch(record(), {
      byExternalId: [],
      byTitle: [candidato(1n), candidato(2n)],
    });
    expect(m.confidence).toBe("ambiguous");
    expect(m.resolved).toBeNull();
    // Nunca "o primeiro": os dois candidatos vao para o relatorio.
    expect(m.candidates).toHaveLength(2);
  });

  it("(4) titulo SEM ano e ambiguo mesmo com resultado unico", () => {
    // Veredito estavel no tempo: o catalogo cresce, e "unico hoje" pode virar
    // "dois amanha" — o resultado da importacao nao pode depender da data.
    const m = classifyMatch(record({ year: null }), {
      byExternalId: [],
      byTitle: [candidato(1n)],
    });
    expect(m.confidence).toBe("ambiguous");
    expect(m.resolved).toBeNull();
  });

  it("(5) nada encontrado => not_found", () => {
    const m = classifyMatch(record(), { byExternalId: [], byTitle: [] });
    expect(m.confidence).toBe("not_found");
  });

  it("(6) id externo com mais de um resultado falha FECHADO (catalogo inconsistente)", () => {
    const m = classifyMatch(record({ tmdbId: 348 }), {
      byExternalId: [candidato(1n), candidato(2n)],
      byTitle: [],
    });
    expect(m.confidence).toBe("ambiguous");
    expect(m.resolved).toBeNull();
  });

  it("(7) tallyConfidences conta os cinco vereditos", () => {
    const t = tallyConfidences([
      classifyMatch(record({ tmdbId: 1 }), { byExternalId: [candidato(1n)], byTitle: [] }),
      classifyMatch(record(), { byExternalId: [], byTitle: [] }),
    ]);
    expect(t.exact).toBe(1);
    expect(t.not_found).toBe(1);
  });
});

describe("buildImportPlan", () => {
  const exato = (over: Partial<NormalizedImportRecord> = {}) =>
    classifyMatch(record({ tmdbId: 348, ...over }), {
      byExternalId: [candidato(10n)],
      byTitle: [],
    });

  it("(1) so `exact` vira acao; o resto fica em unmatched com a linha original", () => {
    const plano = buildImportPlan({
      source: "cinerie_csv",
      matches: [
        exato(),
        classifyMatch(record({ rawRowNumber: 3 }), { byExternalId: [], byTitle: [candidato(2n)] }),
        classifyMatch(record({ rawRowNumber: 4 }), { byExternalId: [], byTitle: [] }),
      ],
      rejected: [],
      duplicateRows: 0,
      totalRows: 3,
      existing: new Map(),
    });
    expect(plano.actions).toHaveLength(1);
    expect(plano.unmatched.map((u) => u.rawRowNumber)).toEqual([3, 4]);
    expect(plano.summary.applicable).toBe(1);
  });

  it("(2) NUNCA sobrescreve data local: divergencia vira conflito relatado", () => {
    const local = new Date("2020-01-01T00:00:00Z");
    const doArquivo = new Date("2024-05-05T00:00:00Z");
    const existing = new Map<string, ExistingEntityState>([
      [
        existingStateKey("movie", 10n),
        { entityId: 10n, status: "watched", watchedAt: local, rating: null },
      ],
    ]);
    const plano = buildImportPlan({
      source: "cinerie_csv",
      matches: [exato({ watchedAt: doArquivo })],
      rejected: [],
      duplicateRows: 0,
      totalRows: 1,
      existing,
    });
    expect(plano.conflicts).toHaveLength(1);
    expect(plano.conflicts[0]!.kind).toBe("watched_at_divergent");
  });

  it("(3) NUNCA rebaixa watched para watchlist", () => {
    const existing = new Map<string, ExistingEntityState>([
      [
        existingStateKey("movie", 10n),
        { entityId: 10n, status: "watched", watchedAt: null, rating: null },
      ],
    ]);
    const plano = buildImportPlan({
      source: "cinerie_csv",
      matches: [exato({ targetState: "watchlist" })],
      rejected: [],
      duplicateRows: 0,
      totalRows: 1,
      existing,
    });
    expect(plano.actions).toHaveLength(0);
    expect(plano.conflicts[0]!.kind).toBe("already_watched");
  });

  it("(4) nota divergente e conflito; nota nova e aplicada", () => {
    const comNota = new Map<string, ExistingEntityState>([
      [existingStateKey("movie", 10n), { entityId: 10n, status: null, watchedAt: null, rating: 3 }],
    ]);
    const conflito = buildImportPlan({
      source: "cinerie_csv",
      matches: [exato({ rating: 5 })],
      rejected: [],
      duplicateRows: 0,
      totalRows: 1,
      existing: comNota,
    });
    expect(conflito.conflicts[0]!.kind).toBe("rating_divergent");
    expect(conflito.actions[0]!.rating).toBeNull();

    const semNota = buildImportPlan({
      source: "cinerie_csv",
      matches: [exato({ rating: 5 })],
      rejected: [],
      duplicateRows: 0,
      totalRows: 1,
      existing: new Map(),
    });
    expect(semNota.actions[0]!.rating).toBe(5);
  });

  it("(5) acoes saem ORDENADAS por linha do arquivo (base da retomada)", () => {
    const plano = buildImportPlan({
      source: "cinerie_csv",
      matches: [exato({ rawRowNumber: 9 }), exato({ rawRowNumber: 2 }), exato({ rawRowNumber: 5 })],
      rejected: [],
      duplicateRows: 0,
      totalRows: 3,
      existing: new Map(),
    });
    expect(plano.actions.map((a) => a.rawRowNumber)).toEqual([2, 5, 9]);
  });

  it("(6) o carimbo aplicado e o do ARQUIVO, nunca `now()`", () => {
    const doArquivo = new Date("1999-12-31T00:00:00Z");
    const plano = buildImportPlan({
      source: "cinerie_csv",
      matches: [exato({ watchedAt: doArquivo })],
      rejected: [],
      duplicateRows: 0,
      totalRows: 1,
      existing: new Map(),
    });
    expect(plano.actions[0]!.watchedAt?.toISOString()).toBe(doArquivo.toISOString());
  });
});

describe("dedupeRecords", () => {
  it("(1) deduplica por id externo e por titulo+ano+estado", () => {
    const r = dedupeRecords([
      record({ rawRowNumber: 2, tmdbId: 1 }),
      record({ rawRowNumber: 3, tmdbId: 1 }),
      record({ rawRowNumber: 4 }),
      record({ rawRowNumber: 5 }),
    ]);
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toBe(2);
    // Mantem a PRIMEIRA ocorrencia (a que o usuario ve primeiro no arquivo).
    expect(r.unique[0]!.rawRowNumber).toBe(2);
  });

  it("(2) estados alvo diferentes NAO sao duplicata", () => {
    const r = dedupeRecords([
      record({ targetState: "watched" }),
      record({ rawRowNumber: 3, targetState: "watchlist" }),
    ]);
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toBe(0);
  });
});
