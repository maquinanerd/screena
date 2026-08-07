/**
 * entity-resolve.test.ts — o tradutor "nome -> id interno do catalogo".
 *
 * Estes testes medem, quase todos, o que a rota NAO devolve. A assimetria e o
 * ponto: um `null` faz o MNScr nao citar a entidade; um id errado publica a obra
 * errada com cara de certo. As duas falhas nao tem o mesmo custo, e o codigo nao
 * as trata como se tivessem.
 */

import { describe, expect, it } from "vitest";

import {
  CONFIDENCE_BY_MATCH,
  MAX_RESOLVE_ITEMS,
  MAX_RESOLVE_REQUEST_BYTES,
  foldEntityText,
  parseEntityResolveRequest,
  resolveAll,
  resolveOne,
  type ResolveCandidate,
  type ResolveQuery,
} from "../entity-resolve";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function candidate(overrides: Partial<ResolveCandidate> = {}): ResolveCandidate {
  return {
    kind: "movie",
    entityId: "4210",
    tmdbId: 550,
    folded: "clube da luta",
    foldedAliases: ["fight club"],
    year: 1999,
    canonicalTitle: "Clube da Luta",
    canonicalSlug: "clube-da-luta",
    ...overrides,
  };
}

function query(overrides: Partial<ResolveQuery> = {}): ResolveQuery {
  return { index: 0, kind: "movie", tmdbId: null, folded: null, year: null, ...overrides };
}

function parse(body: unknown) {
  return parseEntityResolveRequest(body, JSON.stringify(body ?? "").length);
}

/* ------------------------------------------------------------------ */
/* Dobra                                                               */
/* ------------------------------------------------------------------ */

describe("dobra de texto", () => {
  it("remove acento, minusculiza e colapsa espaco", () => {
    expect(foldEntityText("  A Viagem   de CHIHIRO ")).toBe("a viagem de chihiro");
    expect(foldEntityText("Cidade de Deus")).toBe("cidade de deus");
    expect(foldEntityText("Amélie")).toBe("amelie");
    expect(foldEntityText("CORAÇÃO")).toBe("coracao");
  });

  it("NAO remove pontuacao — a projecao tambem nao remove", () => {
    // Se removesse aqui e nao la, o casamento exato deixaria de casar. A dobra
    // dos dois lados tem de ser a MESMA transformacao, nao uma "parecida".
    expect(foldEntityText("Homem-Aranha: Sem Volta Para Casa")).toBe(
      "homem-aranha: sem volta para casa",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Pedido                                                              */
/* ------------------------------------------------------------------ */

describe("forma do pedido", () => {
  it("aceita a forma canonica e preserva a ordem", () => {
    const result = parse({
      items: [
        { kind: "movie", tmdbId: 550 },
        { kind: "tv", title: "Ruptura", year: 2022 },
        { kind: "person", name: "Morgan Freeman" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queries.map((q) => [q.index, q.kind])).toEqual([
      [0, "movie"],
      [1, "tv"],
      [2, "person"],
    ]);
    expect(result.queries[1]?.folded).toBe("ruptura");
  });

  it("`title` e `name` sao o mesmo campo com dois nomes", () => {
    // Obra tem titulo, pessoa tem nome. Obrigar o emissor a saber qual usar
    // produziria `no_input` por vocabulario, nao por falta de dado.
    const byTitle = parse({ items: [{ kind: "person", title: "Morgan Freeman" }] });
    const byName = parse({ items: [{ kind: "person", name: "Morgan Freeman" }] });
    expect(byTitle.ok && byTitle.queries[0]?.folded).toBe("morgan freeman");
    expect(byName.ok && byName.queries[0]?.folded).toBe("morgan freeman");
  });

  it("item INVALIDO nao e descartado: ele vira resultado nulo na mesma posicao", () => {
    // Pular mudaria o tamanho do array de resposta e desalinharia, em silencio,
    // a correspondencia posicional que o cliente usa.
    const result = parse({
      items: [{ kind: "movie", tmdbId: 550 }, { kind: "planeta" }, null, { kind: "tv" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queries).toHaveLength(4);
    expect(result.queries[1]?.kind).toBeNull();
    expect(result.queries[2]?.kind).toBeNull();
  });

  it("envelope torto recusa o pedido INTEIRO", () => {
    for (const body of [null, "texto", 42, [], { items: "x" }, { items: [] }, {}]) {
      expect(parse(body).ok, JSON.stringify(body)).toBe(false);
    }
  });

  it("itens demais: recusa, nunca truncamento", () => {
    // Truncar devolveria menos resultados do que itens enviados, e o cliente
    // alinharia os resultados errados aos itens errados.
    const items = Array.from({ length: MAX_RESOLVE_ITEMS + 1 }, () => ({ kind: "movie", tmdbId: 1 }));
    const result = parse({ items });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("too_many_items");
  });

  it("corpo acima do teto: 413 antes de qualquer parse", () => {
    const result = parseEntityResolveRequest({ items: [] }, MAX_RESOLVE_REQUEST_BYTES + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.status).toBe(413);
  });

  it("ano fora da faixa e tmdbId nao positivo viram ausencia, nao erro de tipo", () => {
    const result = parse({
      items: [{ kind: "movie", title: "X", year: 12, tmdbId: 0 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queries[0]?.year).toBeNull();
    expect(result.queries[0]?.tmdbId).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Casamento por tmdb_id                                               */
/* ------------------------------------------------------------------ */

describe("tmdb_id: exato e preferencial", () => {
  it("casa e devolve id interno, caminho e confianca 1", () => {
    const result = resolveOne(query({ tmdbId: 550 }), [candidate()]);
    expect(result).toEqual({
      index: 0,
      entityKind: "movie",
      entityId: "4210",
      matchedBy: "tmdb_id",
      confidence: 1,
      canonicalTitle: "Clube da Luta",
      path: "/pt/filmes/clube-da-luta/",
      reason: null,
    });
  });

  it("tmdbId de OUTRO tipo nao casa — o kind faz parte da chave", () => {
    // O mesmo numero e um filme no TMDB e uma serie no TMDB. Ignorar o `kind`
    // devolveria a obra errada com toda a aparencia de estar certa.
    const result = resolveOne(query({ kind: "tv", tmdbId: 550 }), [candidate()]);
    expect(result.entityId).toBeNull();
    expect(result.reason).toBe("tmdb_id_not_in_catalog");
  });

  it("tmdbId ausente do catalogo NAO cai para busca por titulo", () => {
    // Cair para o titulo seria "tente o outro" — e tentar o outro e como se
    // publica a obra errada quando os dois campos divergem.
    const result = resolveOne(
      query({ tmdbId: 999999, folded: "clube da luta", year: 1999 }),
      [candidate()],
    );
    expect(result.entityId).toBeNull();
    expect(result.reason).toBe("tmdb_id_not_in_catalog");
  });
});

/* ------------------------------------------------------------------ */
/* Casamento por titulo + ano                                          */
/* ------------------------------------------------------------------ */

describe("titulo + ano + kind: os tres, ou nada", () => {
  it("casa pelo titulo principal", () => {
    const result = resolveOne(query({ folded: "clube da luta", year: 1999 }), [candidate()]);
    expect(result.matchedBy).toBe("exact_title_year");
    expect(result.confidence).toBe(CONFIDENCE_BY_MATCH.exact_title_year);
    expect(result.entityId).toBe("4210");
  });

  it("casa por ALIAS — e como o MNScr costuma citar a obra", () => {
    const result = resolveOne(query({ folded: "fight club", year: 1999 }), [candidate()]);
    expect(result.matchedBy).toBe("exact_title_year");
    expect(result.entityId).toBe("4210");
  });

  it("titulo SEM ano nao casa, mesmo quando so ha um candidato", () => {
    // "Superman" sem ano casa com meia duzia de filmes. Aceitar quando por acaso
    // ha um so ensinaria o emissor a omitir o ano — e a regra quebraria no dia
    // em que o catalogo ganhasse o segundo.
    const result = resolveOne(query({ folded: "clube da luta" }), [candidate()]);
    expect(result.entityId).toBeNull();
    expect(result.reason).toBe("title_requires_year");
  });

  it("ano DIFERENTE nao casa — remake nao e o original", () => {
    const result = resolveOne(query({ folded: "clube da luta", year: 2024 }), [candidate()]);
    expect(result.entityId).toBeNull();
    expect(result.reason).toBe("not_found");
  });

  it("titulo e ano batendo em DUAS obras vira null, nunca escolha", () => {
    const result = resolveOne(query({ folded: "gemeas", year: 1998 }), [
      candidate({ entityId: "1", folded: "gemeas", foldedAliases: [], year: 1998, tmdbId: 1 }),
      candidate({ entityId: "2", folded: "gemeas", foldedAliases: [], year: 1998, tmdbId: 2 }),
    ]);
    expect(result.entityId).toBeNull();
    expect(result.reason).toBe("ambiguous_title");
  });

  it("nao ha fuzzy: quase-igual nao casa", () => {
    for (const folded of ["clube de luta", "clube da lutas", "clube", "o clube da luta"]) {
      const result = resolveOne(query({ folded, year: 1999 }), [candidate()]);
      expect(result.entityId, folded).toBeNull();
      expect(result.reason, folded).toBe("not_found");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Pessoa                                                              */
/* ------------------------------------------------------------------ */

describe("pessoa: nome exato e UNICO", () => {
  const freeman = candidate({
    kind: "person",
    entityId: "77",
    tmdbId: 192,
    folded: "morgan freeman",
    foldedAliases: [],
    year: null,
    canonicalTitle: "Morgan Freeman",
    canonicalSlug: "morgan-freeman",
  });

  it("nome unico casa, com a confianca mais baixa das tres", () => {
    // Pessoa nao tem ano: o sinal e mais fraco do que titulo+ano, e a confianca
    // devolvida diz isso ao cliente em vez de esconder.
    const result = resolveOne(query({ kind: "person", folded: "morgan freeman" }), [freeman]);
    expect(result.matchedBy).toBe("exact_name");
    expect(result.confidence).toBe(CONFIDENCE_BY_MATCH.exact_name);
    expect(result.confidence).toBeLessThan(CONFIDENCE_BY_MATCH.exact_title_year);
    expect(result.path).toBe("/pt/pessoas/morgan-freeman/");
  });

  it("HOMONIMOS derrubam para null, nunca para o mais popular", () => {
    // E esta trava que sustenta o casamento por nome. Sem ela, "Chris Evans"
    // (ator) e "Chris Evans" (apresentador) seriam a mesma pessoa na materia.
    const result = resolveOne(query({ kind: "person", folded: "chris evans" }), [
      candidate({ kind: "person", entityId: "1", tmdbId: 1, folded: "chris evans", foldedAliases: [], year: null, canonicalSlug: "chris-evans" }),
      candidate({ kind: "person", entityId: "2", tmdbId: 2, folded: "chris evans", foldedAliases: [], year: null, canonicalSlug: "chris-evans-2" }),
    ]);
    expect(result.entityId).toBeNull();
    expect(result.reason).toBe("ambiguous_name");
  });

  it("o ano enviado para pessoa e ignorado, nao vira recusa", () => {
    const result = resolveOne(query({ kind: "person", folded: "morgan freeman", year: 1937 }), [
      freeman,
    ]);
    expect(result.entityId).toBe("77");
  });
});

/* ------------------------------------------------------------------ */
/* O portao final                                                      */
/* ------------------------------------------------------------------ */

describe("entidade sem slug canonico pt-BR nao e devolvida", () => {
  it("casamento CERTO e recusado quando a entidade nao tem pagina", () => {
    // Este e o ponto que fecha o circuito. Sem slug canonico pt-BR a entidade
    // nao tem pagina, e o `entityCard` apontando para ela sumiria do corpo
    // exatamente como sumiria um id inexistente. Devolver o id aqui trocaria um
    // modo de falha silenciosa por outro.
    const result = resolveOne(query({ tmdbId: 550 }), [candidate({ canonicalSlug: null })]);
    expect(result.entityId).toBeNull();
    expect(result.path).toBeNull();
    expect(result.reason).toBe("no_canonical_slug");
  });

  it("slug que quebraria a URL tambem e recusado", () => {
    for (const slug of ["../etc", "a/b", "com espaco", "x?y", ""]) {
      const result = resolveOne(query({ tmdbId: 550 }), [candidate({ canonicalSlug: slug })]);
      expect(result.path, slug).toBeNull();
      expect(result.reason, slug).toBe("no_canonical_slug");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Entradas que nao dao para resolver                                  */
/* ------------------------------------------------------------------ */

describe("motivo NOMEADO em todo resultado sem id", () => {
  it("kind desconhecido, season e episode: unsupported_kind", () => {
    const result = resolveOne(query({ kind: null, tmdbId: 550 }), [candidate()]);
    expect(result.reason).toBe("unsupported_kind");
    expect(result.entityKind).toBeNull();
  });

  it("sem tmdbId e sem titulo: no_input", () => {
    expect(resolveOne(query({}), [candidate()]).reason).toBe("no_input");
  });

  it("todo resultado sem id carrega reason, e todo resultado com id NAO carrega", () => {
    // Um `null` mudo devolveria o emissor ao ponto de partida.
    const results = resolveAll(
      [
        query({ index: 0, tmdbId: 550 }),
        query({ index: 1, kind: null }),
        query({ index: 2, folded: "inexistente", year: 2000 }),
      ],
      [candidate()],
    );
    for (const result of results) {
      expect(result.entityId === null).toBe(result.reason !== null);
      expect(result.entityId === null).toBe(result.matchedBy === null);
      expect(result.entityId === null ? result.confidence : 1).toBeGreaterThan(-1);
    }
  });

  it("o lote devolve UM resultado por item, na ordem do pedido", () => {
    const queries = [query({ index: 0, tmdbId: 550 }), query({ index: 1, kind: null })];
    const results = resolveAll(queries, [candidate()]);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.index)).toEqual([0, 1]);
  });
});
