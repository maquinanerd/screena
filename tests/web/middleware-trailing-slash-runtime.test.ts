/**
 * O middleware EXECUTADO, nao lido.
 *
 * O teste irmao (`trailing-slash.test.ts`) prova a regra que decide. Este prova
 * a RESPOSTA — e existe por causa de um defeito que so aparece quando o codigo
 * roda: a primeira versao montava o destino com `request.nextUrl.clone()`, e o
 * `NextURL`, ao serializar, devolvia a barra que acabara de ser acrescentada. O
 * `Location` saia identico a URL pedida:
 *
 *     GET /pt/filmes  ->  308  Location: /pt/filmes
 *
 * Ou seja, um LACO INFINITO em toda pagina alcancada por link sem barra. O
 * arquivo passava, o tipo passava, o build passava. So um servidor real acusou.
 *
 * `resolvePersistedRedirect` faz um subrequest a `/api/seo/redirect`; aqui ele e
 * curto-circuitado (o middleware ja e fail-closed a esse erro), o que mantem o
 * teste rapido e deterministico.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "../../apps/web/middleware";

const ORIGIN = "https://cinerie.com";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("sem lookup de redirect persistido neste teste");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function run(pathname: string) {
  const response = await middleware(new NextRequest(`${ORIGIN}${pathname}`));
  return {
    status: response.status,
    location: response.headers.get("location"),
    hsts: response.headers.get("strict-transport-security"),
    csp: response.headers.get("content-security-policy-report-only"),
  };
}

describe("middleware executado: o 308 de barra final", () => {
  it("aponta para o caminho COM barra — nunca para o mesmo caminho", async () => {
    for (const [pedido, esperado] of [
      ["/pt/filmes", "/pt/filmes/"],
      ["/pt", "/pt/"],
      ["/pt/series/breaking-bad", "/pt/series/breaking-bad/"],
      ["/pt/filmes?ordenar=ano", "/pt/filmes/?ordenar=ano"],
    ] as const) {
      const r = await run(pedido);
      expect(r.status, pedido).toBe(308);
      expect(r.location, `${pedido}: destino`).toBe(`${ORIGIN}${esperado}`);
      // A asercao que importa: destino DIFERENTE da origem. Igual = laço.
      expect(r.location, `${pedido}: laço`).not.toBe(`${ORIGIN}${pedido}`);
    }
  });

  it("sai por withSecurityHeaders — o motivo de o redirect ter vindo para cá", async () => {
    const r = await run("/pt/filmes");
    // O CSP é o cabeçalho que o MIDDLEWARE escreve, e é o que dá para provar
    // aqui. O HSTS vem dos `headers()` do `next.config.ts`, aplicados pelo
    // servidor: eles alcançam a resposta do middleware e NÃO alcançavam o
    // redirect interno do roteador — que é o defeito inteiro. Isso se prova num
    // servidor real (`next build` + `next start`), não neste nível.
    expect(r.csp).toContain("default-src");
    expect(r.hsts, "HSTS não é escrito pelo middleware").toBeNull();
  });

  it("a raiz continua indo para o locale publicado", async () => {
    const r = await run("/");
    expect(r.status).toBe(308);
    // A barra final DESTE destino depende do `trailingSlash` lido pelo servidor
    // (a raiz usa `nextUrl.clone()`, sensível a config que este nível não tem).
    // O que este teste trava é o LOCALE; a formatação, o servidor real.
    expect(r.location).toMatch(/^https:\/\/cinerie\.com\/pt\/?$/);
    expect(r.csp).toContain("default-src");
  });

  it("não redireciona o que já está normalizado", async () => {
    for (const pathname of ["/pt/", "/pt/filmes/"]) {
      const r = await run(pathname);
      expect(r.status, pathname).toBe(200);
      expect(r.location, pathname).toBeNull();
    }
  });
});
