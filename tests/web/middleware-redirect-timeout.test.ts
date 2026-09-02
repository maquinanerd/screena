/**
 * middleware-redirect-timeout.test.ts — o subrequest do middleware tem PRAZO.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 * `apps/web/middleware.ts` faz um `fetch` para `/api/seo/redirect` em TODA
 * requisicao que casa o `matcher` — ou seja, em toda pagina publica. Ate
 * 2026-09-01 esse `fetch` ia sem `signal`.
 *
 * O `try/catch` em volta ja era fail-closed, e por isso a falta passava por
 * tratada. Nao era: um `fetch` sem prazo nao desiste sozinho, e o `catch` so
 * age depois que a promessa se resolve de algum jeito. Com o handler lento
 * (Postgres sob carga, pool esgotado, deploy pela metade), a requisicao do
 * LEITOR ficava pendurada pelo tempo que fosse.
 *
 * Fail-closed sem prazo nao e protecao — e espera indefinida com tratamento de
 * erro no fim.
 *
 * ============================================================================
 * O QUE ESTE TESTE PROVA, E COMO
 * ============================================================================
 * O teste central usa um `fetch` que NUNCA se resolve por conta propria e so
 * termina se alguem abortar. Se o prazo sumir, ele nao falha por assercao — ele
 * PENDURA, e o vitest o mata por timeout. Os dois desfechos reprovam, que e o
 * que se quer: a propriedade sob teste e literalmente "isto nao pendura".
 *
 * O controle negativo fecha o outro lado: um lookup RAPIDO continua produzindo
 * o redirect. Sem ele, remover o `fetch` inteiro passaria em todo o resto.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  middleware,
  REDIRECT_LOOKUP_TIMEOUT_MS,
} from "../../apps/web/middleware";

const ORIGIN = "https://cinerie.com";

/**
 * Request minimo com a superficie que o middleware consome. Diferente do fake
 * de `root-locale-redirect.test.ts`, este PRECISA de `nextUrl.origin`: sem ele
 * o `new URL('/api/seo/redirect', undefined)` lanca antes do `fetch`, e o teste
 * nunca exercitaria o caminho de rede que ele existe para medir.
 */
function createRequest(pathname: string): Parameters<typeof middleware>[0] {
  const url = new URL(`${ORIGIN}${pathname}`);
  return {
    nextUrl: {
      pathname: url.pathname,
      origin: url.origin,
      clone: () => new URL(url.toString()),
    },
    headers: new Headers(),
  } as unknown as Parameters<typeof middleware>[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("o subrequest de redirect nao pendura a requisicao publica", () => {
  it("passa um AbortSignal para o fetch", async () => {
    let seenSignal: unknown = "NAO CHAMADO";

    vi.stubGlobal("fetch", (_url: unknown, init?: { signal?: unknown }) => {
      seenSignal = init?.signal;
      return Promise.resolve({ ok: false });
    });

    await middleware(createRequest("/pt/filmes/a-odisseia/"));

    // A REGRESSAO QUE ISTO PEGA: antes, `init.signal` era `undefined`.
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("um lookup que NUNCA responde e abandonado, e a pagina responde", async () => {
    // Honra o abort e nada mais. Sem prazo no middleware, esta promessa fica
    // pendente para sempre e o teste morre por timeout do vitest.
    vi.stubGlobal("fetch", (_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("abortado pelo prazo"));
        });
      });
    });

    const startedAt = Date.now();
    const response = await middleware(createRequest("/pt/filmes/a-odisseia/"));
    const elapsed = Date.now() - startedAt;

    // Degradacao explicita: segue o fluxo, sem redirect.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-screena-locale")).toBe("pt");

    // Desistiu por PRAZO, e nao por acaso: perto do teto, nunca muito acima.
    expect(elapsed).toBeGreaterThanOrEqual(REDIRECT_LOOKUP_TIMEOUT_MS - 100);
    expect(elapsed).toBeLessThan(REDIRECT_LOOKUP_TIMEOUT_MS + 1500);
  });

  it("CONTROLE NEGATIVO: lookup RAPIDO continua redirecionando", async () => {
    // Sem isto, apagar o `fetch` inteiro passaria nos dois testes acima — e o
    // redirect persistido morreria em silencio, que e pior do que a lentidao.
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "resolved",
            location: "/pt/filmes/o-destino/",
            statusCode: 301,
          }),
      }),
    );

    const response = await middleware(createRequest("/pt/filmes/antigo/"));

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/pt/filmes/o-destino/`,
    );
  });

  it("o prazo e curto o bastante para nao parecer pagina travada", () => {
    // Um teto de 30 s satisfaria "tem signal" e nao resolveria nada para quem
    // esta esperando. O numero e parte do contrato, entao ele fica travado.
    expect(REDIRECT_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    expect(REDIRECT_LOOKUP_TIMEOUT_MS).toBeGreaterThanOrEqual(500);
  });
});
