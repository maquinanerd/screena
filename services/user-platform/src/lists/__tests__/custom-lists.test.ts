/**
 * Testes — listas customizadas (@screena/user-platform lists).
 *
 * Garantem: slugify ascii kebab (com diacriticos), limites antiabuso de
 * criacao/itens, visibilidade dentro do enum e a regra de produto de que
 * lista public/unlisted exige email verificado (tudo nasce privado).
 */

import { describe, expect, it } from "vitest";

import {
  LIST_LIMITS,
  canPublishList,
  slugifyListTitle,
  validateListCreate,
  validateListItemAdd,
  type ListCreateInput,
  type ListItemAddInput,
} from "../custom-lists.js";

function baseCreateInput(overrides: Partial<ListCreateInput> = {}): ListCreateInput {
  return {
    title: "Maratona de terror",
    description: "Filmes para outubro.",
    visibility: "private",
    ordered: true,
    ...overrides,
  };
}

function baseItemInput(overrides: Partial<ListItemAddInput> = {}): ListItemAddInput {
  return {
    entityType: "movie",
    note: "rever antes da sequencia",
    ...overrides,
  };
}

describe("slugifyListTitle", () => {
  it('(1) remove diacriticos e pontuacao: "Ação & Aventura!" -> "acao-aventura"', () => {
    expect(slugifyListTitle("Ação & Aventura!")).toBe("acao-aventura");
  });

  it("(2) colapsa sequencias nao-alfanumericas em um unico hifen e apara as pontas", () => {
    expect(slugifyListTitle("  Top --- 10  (2026)!! ")).toBe("top-10-2026");
  });

  it('(3) devolve "lista" quando o titulo nao tem nada aproveitavel', () => {
    expect(slugifyListTitle("!!! ??? ***")).toBe("lista");
    expect(slugifyListTitle("")).toBe("lista");
  });
});

describe("validateListCreate", () => {
  it("(4) passa no caminho feliz com contexto abaixo do limite", () => {
    const result = validateListCreate(baseCreateInput(), { currentCustomListCount: 0 });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("(5) falha quando o titulo e vazio ou so espacos", () => {
    const result = validateListCreate(baseCreateInput({ title: "   " }), {
      currentCustomListCount: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("titulo"))).toBe(true);
  });

  it("(6) falha quando o titulo excede o limite", () => {
    const result = validateListCreate(
      baseCreateInput({ title: "a".repeat(LIST_LIMITS.maxTitleLength + 1) }),
      { currentCustomListCount: 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("no maximo"))).toBe(true);
  });

  it("(7) falha quando a descricao excede o limite", () => {
    const result = validateListCreate(
      baseCreateInput({ description: "d".repeat(LIST_LIMITS.maxDescriptionLength + 1) }),
      { currentCustomListCount: 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("descricao"))).toBe(true);
  });

  it("(8) falha quando a visibilidade nao pertence ao enum", () => {
    const result = validateListCreate(baseCreateInput({ visibility: "secret" }), {
      currentCustomListCount: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("visibilidade"))).toBe(true);
  });

  it("(9) falha por antiabuso quando o usuario ja atingiu o limite de listas", () => {
    const result = validateListCreate(baseCreateInput(), {
      currentCustomListCount: LIST_LIMITS.maxCustomListsPerUser,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("limite"))).toBe(true);
  });

  it("(10) acumula multiplas violacoes de uma vez", () => {
    const result = validateListCreate(
      baseCreateInput({ title: "", visibility: "secret" }),
      { currentCustomListCount: LIST_LIMITS.maxCustomListsPerUser },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("canPublishList", () => {
  it("(11) permite lista privada mesmo sem email verificado", () => {
    const result = canPublishList({ visibility: "private", emailVerifiedAt: null });
    expect(result.ok).toBe(true);
  });

  it("(12) nega public sem email verificado (forbidden, mensagem clara)", () => {
    const result = canPublishList({ visibility: "public", emailVerifiedAt: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("forbidden");
      expect(result.error.message).toContain("verifique seu email");
    }
  });

  it("(13) nega unlisted sem email verificado", () => {
    const result = canPublishList({ visibility: "unlisted", emailVerifiedAt: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("forbidden");
    }
  });

  it("(14) permite public e unlisted com email verificado", () => {
    const verifiedAt = new Date("2026-07-01T12:00:00Z");
    expect(canPublishList({ visibility: "public", emailVerifiedAt: verifiedAt }).ok).toBe(true);
    expect(canPublishList({ visibility: "unlisted", emailVerifiedAt: verifiedAt }).ok).toBe(true);
  });
});

describe("validateListItemAdd", () => {
  it("(15) passa no caminho feliz para os quatro tipos avaliaveis", () => {
    for (const entityType of ["movie", "tv", "season", "episode"]) {
      const result = validateListItemAdd(baseItemInput({ entityType }), {
        currentItemCount: 0,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('(16) falha para entityType fora de RATABLE_ENTITY_TYPES (ex.: "person")', () => {
    const result = validateListItemAdd(baseItemInput({ entityType: "person" }), {
      currentItemCount: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("entityType"))).toBe(true);
  });

  it("(17) falha quando a nota excede o limite", () => {
    const result = validateListItemAdd(
      baseItemInput({ note: "n".repeat(LIST_LIMITS.maxNoteLength + 1) }),
      { currentItemCount: 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("nota"))).toBe(true);
  });

  it("(18) falha por antiabuso quando a lista ja atingiu o limite de itens", () => {
    const result = validateListItemAdd(baseItemInput(), {
      currentItemCount: LIST_LIMITS.maxItemsPerList,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("limite"))).toBe(true);
  });
});
