/**
 * Testes da serializacao/leitura de cookies (C7D) e dos atributos de seguranca.
 */

import { describe, expect, it } from "vitest";
import {
  buildClearedSessionCookies,
  buildSessionCookies,
  readCookie,
  readPresentedCsrfToken,
  readSessionToken,
  serializeCookie,
  CSRF_HEADER,
} from "../cookies.js";
import {
  buildSessionCookieSpec,
  buildCsrfCookieSpec,
} from "../../core/request-guards.js";

const NOW = new Date("2026-07-22T12:00:00Z");
const EXPIRES = new Date(NOW.getTime() + 3_600_000);

describe("atributos de seguranca dos cookies", () => {
  it("(1) sessao e HttpOnly + Secure + SameSite=Lax + Path=/", () => {
    const spec = buildSessionCookieSpec({ token: "t", maxAgeSeconds: 3600, production: true });
    expect(spec.attributes).toContain("HttpOnly");
    expect(spec.attributes).toContain("Secure");
    expect(spec.attributes).toContain("SameSite=Lax");
    expect(spec.attributes).toContain("Path=/");
    // Prefixo __Host- em producao.
    expect(spec.name).toBe("__Host-cinerie_session");
  });

  it("(2) CSRF NAO e HttpOnly (o cliente precisa le-lo) mas e Secure", () => {
    const spec = buildCsrfCookieSpec({ token: "t", maxAgeSeconds: 3600, production: true });
    expect(spec.attributes).not.toContain("HttpOnly");
    expect(spec.attributes).toContain("Secure");
    expect(spec.attributes).toContain("SameSite=Lax");
  });

  it("(3) o token de sessao NUNCA e legivel por script — so o de CSRF", () => {
    // Prova de contrato: a diferenca de HttpOnly entre os dois cookies e o que
    // torna o double submit possivel sem expor a sessao.
    const sessao = buildSessionCookieSpec({ token: "s", maxAgeSeconds: 3600, production: false });
    const csrf = buildCsrfCookieSpec({ token: "c", maxAgeSeconds: 3600, production: false });
    expect(sessao.attributes.includes("HttpOnly")).toBe(true);
    expect(csrf.attributes.includes("HttpOnly")).toBe(false);
  });
});

describe("readCookie", () => {
  it("(1) le o cookie certo e nao se confunde com valores que contem '='", () => {
    const req = new Request("https://x.test", {
      headers: { cookie: "a=1; cinerie_session=abc==def; b=2" },
    });
    expect(readCookie(req, "cinerie_session")).toBe("abc==def");
    expect(readCookie(req, "a")).toBe("1");
    expect(readCookie(req, "ausente")).toBeNull();
  });

  it("(2) readSessionToken aceita os dois nomes (com e sem __Host-)", () => {
    const prod = new Request("https://x.test", {
      headers: { cookie: "__Host-cinerie_session=tok-prod" },
    });
    const dev = new Request("https://x.test", { headers: { cookie: "cinerie_session=tok-dev" } });
    expect(readSessionToken(prod)).toBe("tok-prod");
    expect(readSessionToken(dev)).toBe("tok-dev");
  });
});

describe("readPresentedCsrfToken", () => {
  it("le do CABECALHO, nunca do cookie", () => {
    const req = new Request("https://x.test", {
      method: "POST",
      headers: { [CSRF_HEADER]: "csrf-apresentado", cookie: "cinerie_csrf=outro" },
    });
    expect(readPresentedCsrfToken(req)).toBe("csrf-apresentado");
  });
});

describe("buildSessionCookies / clear", () => {
  it("(1) login emite DOIS cookies com Max-Age derivado da expiracao real", () => {
    const cookies = buildSessionCookies({
      rawSessionToken: "s",
      rawCsrfToken: "c",
      expiresAt: EXPIRES,
      now: NOW,
      production: false,
    });
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("Max-Age=3600");
    expect(cookies.join("\n")).toMatch(/cinerie_session=s/);
    expect(cookies.join("\n")).toMatch(/cinerie_csrf=c/);
  });

  it("(2) logout expurga os QUATRO nomes com Max-Age=0", () => {
    const cleared = buildClearedSessionCookies();
    expect(cleared).toHaveLength(4);
    for (const c of cleared) {
      expect(c).toContain("Max-Age=0");
    }
    // Cobre com e sem prefixo, sessao e CSRF.
    const joined = cleared.join("\n");
    expect(joined).toMatch(/__Host-cinerie_session=;/);
    expect(joined).toMatch(/cinerie_session=;/);
    expect(joined).toMatch(/__Host-cinerie_csrf=;/);
    expect(joined).toMatch(/cinerie_csrf=;/);
  });
});

describe("serializeCookie", () => {
  it("monta nome=valor; Attr; Attr", () => {
    expect(serializeCookie({ name: "n", value: "v", attributes: ["HttpOnly", "Path=/"] })).toBe(
      "n=v; HttpOnly; Path=/",
    );
  });
});
