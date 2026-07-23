/**
 * Testes — listas de sistema (@screena/user-platform lists).
 *
 * Garantem o catalogo canonico (titulos pt-BR + slugs) e o plano
 * idempotente de criacao das listas faltantes na ordem canonica.
 */

import { describe, expect, it } from "vitest";

import { SYSTEM_LIST_KEYS, type SystemListKey } from "../../core/types.js";
import { SYSTEM_LISTS, planEnsureSystemLists } from "../system-lists.js";

describe("SYSTEM_LISTS", () => {
  it("(1) cobre exatamente as chaves canonicas com titulos e slugs esperados", () => {
    expect(Object.keys(SYSTEM_LISTS).sort()).toEqual([...SYSTEM_LIST_KEYS].sort());
    expect(SYSTEM_LISTS.watchlist).toEqual({ titlePt: "Quero assistir", slug: "quero-assistir" });
    expect(SYSTEM_LISTS.favorites).toEqual({ titlePt: "Favoritos", slug: "favoritos" });
    expect(SYSTEM_LISTS.watching).toEqual({ titlePt: "Assistindo", slug: "assistindo" });
    expect(SYSTEM_LISTS.watched).toEqual({ titlePt: "Assistidos", slug: "assistidos" });
  });
});

describe("planEnsureSystemLists", () => {
  it("(2) devolve todas as listas na ordem canonica quando nada existe", () => {
    expect(planEnsureSystemLists([])).toEqual(["watchlist", "favorites", "watching", "watched"]);
  });

  it("(3) devolve apenas as faltantes, na ordem canonica, ignorando a ordem da entrada", () => {
    const existing: SystemListKey[] = ["watched", "watchlist"];
    expect(planEnsureSystemLists(existing)).toEqual(["favorites", "watching"]);
  });

  it("(4) devolve vazio quando todas ja existem (idempotente)", () => {
    expect(planEnsureSystemLists([...SYSTEM_LIST_KEYS])).toEqual([]);
  });

  it("(5) tolera duplicatas na entrada sem duplicar o plano", () => {
    const existing: SystemListKey[] = ["favorites", "favorites"];
    expect(planEnsureSystemLists(existing)).toEqual(["watchlist", "watching", "watched"]);
  });
});
