/**
 * COOKIES da borda de autenticacao (Backend C, C7D).
 *
 * Serializacao e leitura, e nada mais. A POLITICA (nome, prefixo `__Host-`,
 * `HttpOnly`/`Secure`/`SameSite`) mora em `core/request-guards.ts`, onde e pura
 * e testavel sem `Request`/`Response`. Este arquivo so traduz aquela decisao
 * para o formato do transporte.
 *
 * DOIS COOKIES, com papeis distintos:
 *  - o de SESSAO e `HttpOnly` — script nenhum o le;
 *  - o de CSRF NAO e `HttpOnly`, de proposito: o cliente precisa le-lo para
 *    reapresenta-lo no cabecalho `X-CSRF-Token`. E o "double" do double submit.
 */

import {
  buildClearedCookieSpec,
  buildCsrfCookieSpec,
  buildSessionCookieSpec,
  csrfCookieName,
  sessionCookieName,
  type SessionCookieSpec,
} from "../core/request-guards.js";

/** Cabecalho que o cliente usa para reapresentar o token CSRF. */
export const CSRF_HEADER = "x-csrf-token";

/** `nome=valor; Attr; Attr` — a forma que `Set-Cookie` espera. */
export function serializeCookie(spec: SessionCookieSpec): string {
  return [`${spec.name}=${spec.value}`, ...spec.attributes].join("; ");
}

/**
 * Le UM cookie do cabecalho `Cookie`.
 *
 * Divide em `;` e so no PRIMEIRO `=` de cada par: um valor que contenha `=`
 * (base64, por exemplo) seria truncado por um `split("=")` ingenuo, e o token
 * chegaria mutilado — falha que se manifesta como "sessao invalida"
 * intermitente, dificil de rastrear.
 *
 * Nao decodifica percent-encoding: os dois valores que este modulo le sao hex
 * de 64 chars gerados por `generateOpaqueToken`, que nunca precisam de escape.
 * Decodificar abriria uma normalizacao a mais entre o que o cliente mandou e o
 * que comparamos com o hash.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    if (trimmed.slice(0, separator) === name) {
      const value = trimmed.slice(separator + 1);
      return value.length === 0 ? null : value;
    }
  }
  return null;
}

/**
 * Token de sessao apresentado.
 *
 * Tenta os DOIS nomes (com e sem `__Host-`) porque o prefixo depende do
 * ambiente e a leitura nao tem como saber com certeza em qual esta rodando —
 * um `NODE_ENV` divergente entre build e runtime deslogaria todo mundo em
 * silencio. Aceitar os dois nomes na LEITURA nao enfraquece nada: quem decide
 * os atributos e a ESCRITA, e ela sempre usa o nome correto do ambiente.
 */
export function readSessionToken(request: Request): string | null {
  return readCookie(request, sessionCookieName(true)) ?? readCookie(request, sessionCookieName(false));
}

/** Token CSRF apresentado no CABECALHO (nunca o cookie — esse e o "outro" envio). */
export function readPresentedCsrfToken(request: Request): string | null {
  const value = request.headers.get(CSRF_HEADER);
  return value === null || value.trim().length === 0 ? null : value.trim();
}

/** Os dois `Set-Cookie` de um login bem-sucedido. */
export function buildSessionCookies(input: {
  readonly rawSessionToken: string;
  readonly rawCsrfToken: string;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly production: boolean;
}): readonly string[] {
  // `Max-Age` derivado da expiracao REAL da sessao no banco, nao de uma
  // constante paralela: se as duas divergissem, o cookie sobreviveria a sessao
  // (usuario "logado" que falha em toda acao) ou morreria antes dela.
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((input.expiresAt.getTime() - input.now.getTime()) / 1000),
  );
  return [
    serializeCookie(
      buildSessionCookieSpec({
        token: input.rawSessionToken,
        maxAgeSeconds,
        production: input.production,
      }),
    ),
    serializeCookie(
      buildCsrfCookieSpec({
        token: input.rawCsrfToken,
        maxAgeSeconds,
        production: input.production,
      }),
    ),
  ];
}

/**
 * Os `Set-Cookie` de EXPURGO do logout.
 *
 * Emite os QUATRO nomes possiveis (com e sem `__Host-`, sessao e CSRF) pela
 * mesma razao da leitura tolerante: se o cookie foi escrito sob um prefixo e o
 * processo agora acha que esta no outro ambiente, limpar so um nome deixaria o
 * outro vivo no navegador — um cookie orfao que continuaria sendo enviado.
 */
export function buildClearedSessionCookies(): readonly string[] {
  return [
    serializeCookie(buildClearedCookieSpec({ name: sessionCookieName(true), httpOnly: true })),
    serializeCookie(buildClearedCookieSpec({ name: sessionCookieName(false), httpOnly: true })),
    serializeCookie(buildClearedCookieSpec({ name: csrfCookieName(true), httpOnly: false })),
    serializeCookie(buildClearedCookieSpec({ name: csrfCookieName(false), httpOnly: false })),
  ];
}
