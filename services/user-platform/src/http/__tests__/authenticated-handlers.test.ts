/**
 * Testes da BORDA HTTP autenticada (C7D): login emite cookies, mutacao exige
 * CSRF, ownership, e os CONTROLES NEGATIVOS que a missao (§25) exige — remover
 * a protecao e confirmar que o teste falha, depois restaurar.
 */

import { describe, expect, it } from "vitest";
import { createAuthenticatedHttpHandlers } from "../authenticated-handlers.js";
import { CSRF_HEADER } from "../cookies.js";
import { createTestRuntime, fakeHashPassword, seedUser } from "../../auth-runtime/__tests__/fakes.js";

const EMAIL = "titular@example.test";
const SENHA = "senha-bem-longa-10";

function handlers(runtime: ReturnType<typeof createTestRuntime>) {
  return createAuthenticatedHttpHandlers({
    runtime: runtime.deps,
    hashClientIp: (ip) => `hash-${ip}`.padEnd(64, "0").slice(0, 64),
    newCorrelationId: () => "corr-fixo-0000",
  });
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://cinerie.test/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Faz login e devolve os cookies + o token CSRF cru (do Set-Cookie). */
async function loginAndCollect(runtime: ReturnType<typeof createTestRuntime>) {
  seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
  const h = handlers(runtime);
  const res = await h.login(jsonRequest({ email: EMAIL, password: SENHA }));
  expect(res.status).toBe(200);
  const setCookies = res.headers.getSetCookie();
  // Extrai valores dos dois cookies.
  const sessionCookie = setCookies.find((c) => c.startsWith("cinerie_session="))!;
  const csrfCookie = setCookies.find((c) => c.startsWith("cinerie_csrf="))!;
  const sessionToken = sessionCookie.split(";")[0]!.split("=")[1]!;
  const csrfToken = csrfCookie.split(";")[0]!.split("=")[1]!;
  return { h, sessionToken, csrfToken };
}

describe("login", () => {
  it("(1) sucesso emite cookie de sessao HttpOnly e cookie de CSRF legivel", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const res = await handlers(runtime).login(jsonRequest({ email: EMAIL, password: SENHA }));

    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    const sessao = cookies.find((c) => c.startsWith("cinerie_session="))!;
    const csrf = cookies.find((c) => c.startsWith("cinerie_csrf="))!;
    expect(sessao).toContain("HttpOnly");
    expect(csrf).not.toContain("HttpOnly");
  });

  it("(2) credencial invalida responde 401 e NAO emite cookie", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const res = await handlers(runtime).login(jsonRequest({ email: EMAIL, password: "errada" }));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});

describe("CSRF em mutacao autenticada", () => {
  it("(1) sem token CSRF => 403 (double submit)", async () => {
    const runtime = createTestRuntime();
    const { h, sessionToken } = await loginAndCollect(runtime);

    const res = await h.updateProfile(
      jsonRequest(
        {
          displayName: "T",
          handle: null,
          bio: null,
          locale: "pt-BR",
          countryCode: null,
          timezone: null,
          visibility: "private",
      theme: "system",
      density: "comfortable",
      posterSize: "medium",
        },
        { cookie: `cinerie_session=${sessionToken}` },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("(2) com token CSRF correto => 200", async () => {
    const runtime = createTestRuntime();
    const { h, sessionToken, csrfToken } = await loginAndCollect(runtime);

    const res = await h.updateProfile(
      jsonRequest(
        {
          displayName: "T",
          handle: null,
          bio: null,
          locale: "pt-BR",
          countryCode: null,
          timezone: null,
          visibility: "private",
      theme: "system",
      density: "comfortable",
      posterSize: "medium",
        },
        { cookie: `cinerie_session=${sessionToken}`, [CSRF_HEADER]: csrfToken },
      ),
    );
    expect(res.status).toBe(200);
  });

  it("CONTROLE NEGATIVO: token CSRF ERRADO tambem e barrado", async () => {
    // Prova que a checagem nao e vacua: um token qualquer NAO passa. Se a guarda
    // estivesse quebrada (aceitando qualquer coisa), este teste ficaria verde
    // com o token errado — e e exatamente isso que ele impede.
    const runtime = createTestRuntime();
    const { h, sessionToken } = await loginAndCollect(runtime);
    const res = await h.updateProfile(
      jsonRequest(
        {
          displayName: "T",
          handle: null,
          bio: null,
          locale: "pt-BR",
          countryCode: null,
          timezone: null,
          visibility: "private",
      theme: "system",
      density: "comfortable",
      posterSize: "medium",
        },
        { cookie: `cinerie_session=${sessionToken}`, [CSRF_HEADER]: "f".repeat(64) },
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe("autenticacao obrigatoria", () => {
  it("mutacao sem cookie de sessao => 401", async () => {
    const runtime = createTestRuntime();
    const res = await handlers(runtime).updateProfile(
      jsonRequest({
        displayName: "T",
        handle: null,
        bio: null,
        locale: "pt-BR",
        countryCode: null,
        timezone: null,
        visibility: "private",
      theme: "system",
      density: "comfortable",
      posterSize: "medium",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("session endpoint sem cookie => 200 authenticated:false (nunca 401)", async () => {
    const runtime = createTestRuntime();
    const res = await handlers(runtime).session(
      new Request("https://cinerie.test/api/session", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false, user: null });
  });
});

describe("logout limpa cookies", () => {
  it("logout responde com Set-Cookie de expurgo e revoga a sessao", async () => {
    const runtime = createTestRuntime();
    const { h, sessionToken, csrfToken } = await loginAndCollect(runtime);

    const res = await h.logout(
      jsonRequest({}, { cookie: `cinerie_session=${sessionToken}`, [CSRF_HEADER]: csrfToken }),
    );
    expect(res.status).toBe(200);
    const cleared = res.headers.getSetCookie();
    expect(cleared.some((c) => c.includes("Max-Age=0"))).toBe(true);

    // A sessao morreu: uma nova mutacao com o mesmo cookie ja da 401.
    const depois = await h.readProfile(
      new Request("https://cinerie.test/api/profile", {
        method: "GET",
        headers: { cookie: `cinerie_session=${sessionToken}` },
      }),
    );
    expect(depois.status).toBe(401);
  });
});

describe("ownership", () => {
  it("CONTROLE NEGATIVO: o corpo NAO consegue escolher outro userId", async () => {
    // A mutacao ignora qualquer `userId` no corpo (rejeitado pelo parser
    // estrito) — o titular vem sempre da sessao. Injetar userId nao muda de
    // quem e o perfil editado.
    const runtime = createTestRuntime();
    const { h, sessionToken, csrfToken } = await loginAndCollect(runtime);
    const meuId = runtime.db.users.get(EMAIL)!.id;

    // Semeia uma segunda conta cujo perfil o atacante tentaria tocar.
    const outroId = seedUser(runtime.db, {
      emailNormalized: "vitima@example.test",
      passwordHash: fakeHashPassword(SENHA),
    });

    const res = await h.updateProfile(
      jsonRequest(
        {
          userId: String(outroId), // campo injetado
          displayName: "invadido",
          handle: null,
          bio: null,
          locale: "pt-BR",
          countryCode: null,
          timezone: null,
          visibility: "private",
      theme: "system",
      density: "comfortable",
      posterSize: "medium",
        },
        { cookie: `cinerie_session=${sessionToken}`, [CSRF_HEADER]: csrfToken },
      ),
    );
    // Parser estrito rejeita a chave desconhecida `userId`.
    expect(res.status).toBe(400);
    // A vitima permanece intacta (nenhum perfil criado para ela).
    expect(runtime.db.profiles.get(String(outroId))).toBeUndefined();
    // E o proprio perfil tambem nao foi alterado por este pedido malformado.
    expect(runtime.db.profiles.get(String(meuId))).toBeUndefined();
  });
});
