/**
 * Links de acao: a URL certa, com o token e SEM nada alem dele.
 */

import { describe, expect, it } from "vitest";

import {
  buildEmailVerificationUrl,
  buildPasswordResetUrl,
  EMAIL_VERIFICATION_PATH,
  PASSWORD_RESET_PATH,
  TOKEN_QUERY_PARAM,
} from "../links.js";

const BASE = new URL("https://cinerie.com");
const TOKEN = "a".repeat(64);

describe("links de acao dos e-mails de autenticacao", () => {
  it("(1) verificacao aponta para a rota pt-BR canonica, com barra final", () => {
    const url = new URL(buildEmailVerificationUrl({ publicAppUrl: BASE, rawToken: TOKEN }));
    expect(url.origin).toBe("https://cinerie.com");
    expect(url.pathname).toBe(EMAIL_VERIFICATION_PATH);
    // Barra final: o app roda com `trailingSlash: true`. Sem ela o Next
    // responderia 308 e o token daria um salto a mais de graca.
    expect(url.pathname.endsWith("/")).toBe(true);
    expect(url.searchParams.get(TOKEN_QUERY_PARAM)).toBe(TOKEN);
  });

  it("(2) recuperacao aponta para a rota pt-BR canonica, com barra final", () => {
    const url = new URL(buildPasswordResetUrl({ publicAppUrl: BASE, rawToken: TOKEN }));
    expect(url.pathname).toBe(PASSWORD_RESET_PATH);
    expect(url.pathname.endsWith("/")).toBe(true);
    expect(url.searchParams.get(TOKEN_QUERY_PARAM)).toBe(TOKEN);
  });

  it("(3) os dois fluxos usam paginas DIFERENTES", () => {
    // Uma pagina so obrigaria o cliente a adivinhar qual endpoint chamar, e um
    // token de reset acabaria postado no confirm de verificacao.
    expect(EMAIL_VERIFICATION_PATH).not.toBe(PASSWORD_RESET_PATH);
  });

  it("(4) o UNICO parametro e o token — nada de e-mail, id, status ou hash", () => {
    for (const build of [buildEmailVerificationUrl, buildPasswordResetUrl]) {
      const url = new URL(build({ publicAppUrl: BASE, rawToken: TOKEN }));
      expect([...url.searchParams.keys()]).toEqual([TOKEN_QUERY_PARAM]);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(url.hash).toBe("");
    }
  });

  it("(5) token com caracteres especiais e ESCAPADO (nao quebra a URL)", () => {
    // Controle negativo do risco que a concatenacao manual criaria: um token com
    // `&`/`#`/espaco injetaria parametros ou cortaria a query.
    const hostil = "abc&admin=1#frag ment";
    const url = new URL(buildPasswordResetUrl({ publicAppUrl: BASE, rawToken: hostil }));
    expect(url.searchParams.get(TOKEN_QUERY_PARAM)).toBe(hostil);
    expect([...url.searchParams.keys()]).toEqual([TOKEN_QUERY_PARAM]);
    expect(url.hash).toBe("");
    // A forma serializada nao carrega o `&` cru.
    expect(url.toString()).not.toContain("&admin=1");
  });

  it("(6) a porta e o host da base sao preservados (staging/dev)", () => {
    const staging = new URL("http://localhost:3000");
    const url = new URL(buildEmailVerificationUrl({ publicAppUrl: staging, rawToken: TOKEN }));
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe(EMAIL_VERIFICATION_PATH);
  });
});
