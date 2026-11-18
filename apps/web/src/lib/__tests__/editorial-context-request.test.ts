/**
 * editorial-context-request.test.ts — o pedido ao Cinerie Context Service.
 *
 * O que importa provar: cada item aponta UMA obra por UM caminho, o teto vale,
 * e um item mal montado derruba o pedido inteiro com a lista de problemas (o
 * consumidor e um robo; erro de montagem tem de aparecer na primeira chamada).
 */

import { describe, expect, it } from "vitest";

import {
  acceptedKeys,
  authenticateInternalRequest,
  parseKeyList,
  readCredentialList,
  readResolveCredentials,
} from "../entity-resolve-auth";
import { readPositiveLimit, readRateLimitPerMinute } from "../entity-resolve-rate-limit";
import {
  MAX_CONTEXT_ITEMS,
  MAX_CONTEXT_REQUEST_BYTES,
  parseEditorialContextRequest,
} from "../editorial-context-request";

function parse(body: unknown) {
  return parseEditorialContextRequest(body, JSON.stringify(body ?? null).length);
}

describe("parseEditorialContextRequest", () => {
  it("aceita os quatro caminhos de identidade, na ordem de preferencia", () => {
    const result = parse({
      requestId: "mn-prime:evento.123",
      items: [
        { kind: "movie", entityId: "42", tmdbId: 603, title: "Ignorado" },
        { kind: "tv", tmdbId: 1399 },
        { kind: "movie", slug: "duna-parte-dois" },
        { kind: "tv", title: "  A Casa do Dragão ", year: 2022 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.requestId).toBe("mn-prime:evento.123");
    expect(result.request.items).toEqual([
      { index: 0, kind: "movie", by: "entity_id", entityId: "42" },
      { index: 1, kind: "tv", by: "tmdb_id", tmdbId: 1399 },
      { index: 2, kind: "movie", by: "slug", slug: "duna-parte-dois" },
      { index: 3, kind: "tv", by: "title", folded: "a casa do dragao", year: 2022 },
    ]);
  });

  it("aceita entityId numerico e titulo sem ano", () => {
    const result = parse({ items: [{ kind: "movie", entityId: 7 }, { kind: "movie", title: "Oppenheimer" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.requestId).toBeNull();
    expect(result.request.items[0]).toEqual({ index: 0, kind: "movie", by: "entity_id", entityId: "7" });
    expect(result.request.items[1]).toEqual({ index: 1, kind: "movie", by: "title", folded: "oppenheimer", year: null });
  });

  it("recusa pessoa, temporada e tipo ausente", () => {
    for (const kind of ["person", "season", undefined]) {
      const result = parse({ items: [{ kind, title: "X" }] });
      expect(result.ok).toBe(false);
    }
  });

  it("um item ruim derruba o pedido inteiro, com o motivo de cada um", () => {
    const result = parse({
      items: [
        { kind: "movie", title: "Ok" },
        { kind: "movie", entityId: "0" },
        { kind: "tv", slug: "Com Espaco" },
        { kind: "movie", title: "Ano ruim", year: 1700 },
        { kind: "movie" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.status).toBe(422);
    expect(result.rejection.issues).toHaveLength(4);
  });

  it("respeita o teto de itens e o de bytes", () => {
    const many = Array.from({ length: MAX_CONTEXT_ITEMS + 1 }, () => ({ kind: "movie", tmdbId: 1 }));
    const tooMany = parse({ items: many });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.rejection.code).toBe("too_many_items");

    const tooBig = parseEditorialContextRequest({ items: [] }, MAX_CONTEXT_REQUEST_BYTES + 1);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.rejection.status).toBe(413);
  });

  it("so serve pt-BR e recusa requestId fora do formato", () => {
    expect(parse({ language: "en", items: [{ kind: "movie", tmdbId: 1 }] }).ok).toBe(false);
    expect(parse({ requestId: "com espaco", items: [{ kind: "movie", tmdbId: 1 }] }).ok).toBe(false);
    expect(parse({ language: "pt-BR", items: [{ kind: "movie", tmdbId: 1 }] }).ok).toBe(true);
  });

  it("corpo que nao e objeto e lista vazia sao recusados", () => {
    expect(parse([]).ok).toBe(false);
    expect(parse({ items: [] }).ok).toBe(false);
    expect(parse(null).ok).toBe(false);
  });
});

describe("chaves e teto por variavel propria", () => {
  const KEY = "chave-de-teste-contexto-aaaaaaaa";

  it("o leitor generico e o do resolve dao o mesmo resultado para o mesmo valor", () => {
    expect(readCredentialList(KEY)).toEqual(readResolveCredentials({ CINERIE_CATALOG_RESOLVE_API_KEYS: KEY }));
  });

  it("a chave do resolve NAO e lida como chave do contexto", () => {
    // O escopo e o NOME da variavel: o contexto so le a propria.
    expect(readCredentialList(undefined).credentials).toHaveLength(0);
    expect(parseKeyList(" a , ,b ")).toEqual(["a", "b"]);
  });

  it("chave curta ao lado de uma valida NAO autentica (e e contada para o aviso)", () => {
    const raw = `changeme,${KEY}`;
    expect(acceptedKeys(raw)).toEqual([KEY]);
    expect(authenticateInternalRequest(raw, "Bearer changeme")).toEqual({ state: "unauthenticated", rejected: 1 });
    expect(authenticateInternalRequest(raw, `Bearer ${KEY}`)).toMatchObject({ state: "ok", rejected: 1 });
    expect(authenticateInternalRequest(raw, `API-Key ${KEY}`)).toMatchObject({ state: "ok" });
  });

  it("so chave curta: a rota fica desligada, nunca aberta", () => {
    expect(authenticateInternalRequest("changeme", "Bearer changeme")).toEqual({ state: "disabled", rejected: 1 });
    expect(authenticateInternalRequest(undefined, `Bearer ${KEY}`)).toEqual({ state: "disabled", rejected: 0 });
    expect(authenticateInternalRequest(KEY, null)).toEqual({ state: "unauthenticated", rejected: 0 });
  });

  it("o teto generico cai no default com valor invalido", () => {
    expect(readPositiveLimit(undefined, 300)).toBe(300);
    expect(readPositiveLimit("0", 300)).toBe(300);
    expect(readPositiveLimit("abc", 300)).toBe(300);
    expect(readPositiveLimit("120", 300)).toBe(120);
    expect(readRateLimitPerMinute({ CINERIE_CATALOG_RESOLVE_RATE_LIMIT_PER_MINUTE: "10" })).toBe(10);
  });
});
