/**
 * Testes dos helpers de id do contrato de produto (contracts/payloads.ts):
 * round-trip byte a byte de serializeEntityId/parseEntityId e rejeicao
 * fail-closed de ids invalidos (a mensagem nunca ecoa conteudo sensivel).
 */

import { describe, expect, it } from "vitest";
import { parseEntityId, serializeEntityId } from "../payloads.js";

describe("serializeEntityId / parseEntityId", () => {
  it("(1) round-trip byte a byte para valores validos", () => {
    for (const id of [1n, 42n, 9223372036854775807n]) {
      const s = serializeEntityId(id);
      const back = parseEntityId(s);
      expect(back.ok).toBe(true);
      if (back.ok) expect(back.value).toBe(id);
    }
  });

  it("(2) rejeita vazio, zero, zeros a esquerda, sinal e nao-decimal", () => {
    for (const bad of ["", "0", "01", "-1", "1.5", "abc", "1e3", " 1"]) {
      expect(parseEntityId(bad).ok, bad).toBe(false);
    }
  });

  it("(3) rejeita valor acima do int8 do Postgres", () => {
    expect(parseEntityId("9223372036854775808").ok).toBe(false);
  });

  it("(4) mensagem de erro nunca ecoa o valor recebido", () => {
    const r = parseEntityId("segredo-vazando-123");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toContain("segredo-vazando");
      expect(JSON.stringify(r.error)).not.toContain("segredo-vazando");
    }
  });
});
