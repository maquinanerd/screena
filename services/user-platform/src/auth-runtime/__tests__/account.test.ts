/**
 * Testes dos SERVICOS DE CONTA e SESSAO (C7D): cadastro, login, sessao,
 * logout, logout global e troca de senha.
 *
 * Provam as garantias de seguranca que a missao exige, com os dubles que
 * reproduzem as pre-condicoes reais do banco (nada de mock frouxo).
 */

import { describe, expect, it } from "vitest";
import {
  changePassword,
  login,
  logout,
  logoutAll,
  readCurrentSession,
  resolveAuthenticatedContext,
  signup,
} from "../account.js";
import { createTestRuntime, fakeHashPassword, seedUser } from "./fakes.js";

const CTX = { correlationId: "c-1", clientIpHash: "a".repeat(64), userAgent: "test-agent" } as const;
const EMAIL = "pessoa@example.test";
const SENHA = "senha-bem-longa-10";

/** Extrai a entrega de sessao de um login que sabemos ter dado certo. */
async function loginOk(runtime: ReturnType<typeof createTestRuntime>, email = EMAIL, senha = SENHA) {
  const r = await login(runtime.deps, { emailNormalized: email, password: senha }, CTX);
  expect(r.sessionDelivery, "login deveria ter estabelecido sessao").not.toBeNull();
  return r;
}

describe("signup", () => {
  it("(1) cria conta, credencial, consentimentos e envia verificacao", async () => {
    const runtime = createTestRuntime();
    const dto = await signup(
      runtime.deps,
      {
        email: EMAIL,
        emailNormalized: EMAIL,
        password: SENHA,
        displayName: "Pessoa",
        acceptedTerms: true,
        acceptedMarketingEmail: true,
        acceptedAnalytics: false,
      },
      CTX,
    );
    expect(dto).toEqual({
      ok: true,
      status: "accepted",
      message: expect.any(String),
    });
    await runtime.flush();

    // Conta + credencial existem.
    expect(runtime.db.users.get(EMAIL)).toBeDefined();
    const id = runtime.db.users.get(EMAIL)!.id;
    expect(runtime.db.credentials.get(String(id))).toBeDefined();

    // QUATRO consentimentos gravados (2 obrigatorios + 2 opcionais), inclusive
    // o "nao" explicito de analytics.
    const kinds = runtime.db.consents.filter((c) => c.userId === id);
    expect(kinds).toHaveLength(4);
    expect(kinds.find((c) => c.kind === "terms_of_service")!.granted).toBe(true);
    expect(kinds.find((c) => c.kind === "privacy_policy")!.granted).toBe(true);
    expect(kinds.find((c) => c.kind === "marketing_email")!.granted).toBe(true);
    expect(kinds.find((c) => c.kind === "analytics")!.granted).toBe(false);

    // E-mail de verificacao saiu.
    expect(runtime.emails.sent).toHaveLength(1);
  });

  it("(2) e-mail JA registrado responde IDENTICO e NAO grava nada novo", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword("outra") });
    const consentsAntes = runtime.db.consents.length;

    const dto = await signup(
      runtime.deps,
      {
        email: EMAIL,
        emailNormalized: EMAIL,
        password: SENHA,
        displayName: null,
        acceptedTerms: true,
        acceptedMarketingEmail: false,
        acceptedAnalytics: false,
      },
      CTX,
    );
    await runtime.flush();

    // Resposta indistinguivel do cadastro novo (anti-enumeracao).
    expect(dto.status).toBe("accepted");
    // Nada foi gravado; nenhum e-mail saiu.
    expect(runtime.db.consents.length).toBe(consentsAntes);
    expect(runtime.emails.sent).toHaveLength(0);
  });
});

describe("login", () => {
  it("(1) credencial correta estabelece sessao com token novo", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });

    const r = await loginOk(runtime);
    expect(r.publicDto).toMatchObject({ ok: true });
    expect(r.sessionDelivery!.rawSessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(r.sessionDelivery!.rawCsrfToken).toMatch(/^[0-9a-f]{64}$/);
    // Sessao persistida (uma).
    expect(runtime.db.sessions.size).toBe(1);
  });

  it("(2) senha errada e conta inexistente dao a MESMA resposta 401", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });

    const errada = await login(runtime.deps, { emailNormalized: EMAIL, password: "xxxx" }, CTX);
    const inexistente = await login(
      runtime.deps,
      { emailNormalized: "naoexiste@example.test", password: SENHA },
      CTX,
    );
    expect(errada.sessionDelivery).toBeNull();
    expect(inexistente.sessionDelivery).toBeNull();
    // Corpo publico identico.
    expect(errada.publicDto).toEqual(inexistente.publicDto);
  });

  it("(3) SESSION FIXATION: a sessao nasce nova, sem reaproveitar identificador", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });

    const primeiro = await loginOk(runtime);
    const segundo = await loginOk(runtime);
    // Dois logins -> dois tokens distintos e duas sessoes distintas.
    expect(primeiro.sessionDelivery!.rawSessionToken).not.toBe(
      segundo.sessionDelivery!.rawSessionToken,
    );
    expect(runtime.db.sessions.size).toBe(2);
  });

  it("(4) conta nao-active nunca autentica (fail-closed)", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, {
      emailNormalized: EMAIL,
      status: "disabled",
      passwordHash: fakeHashPassword(SENHA),
    });
    const r = await login(runtime.deps, { emailNormalized: EMAIL, password: SENHA }, CTX);
    expect(r.sessionDelivery).toBeNull();
  });
});

describe("resolveAuthenticatedContext", () => {
  it("(1) token valido resolve; revogado e inexistente resolvem null", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const r = await loginOk(runtime);
    const token = r.sessionDelivery!.rawSessionToken;

    const ctx = await resolveAuthenticatedContext(runtime.deps, token);
    expect(ctx).not.toBeNull();
    expect(ctx!.csrfTokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Token inexistente.
    expect(await resolveAuthenticatedContext(runtime.deps, "0".repeat(64))).toBeNull();
    // Nulo.
    expect(await resolveAuthenticatedContext(runtime.deps, null)).toBeNull();
  });

  it("(2) sessao expirada falha fechada", async () => {
    const runtime = createTestRuntime({ sessionTtlHours: 1 });
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const r = await loginOk(runtime);
    const token = r.sessionDelivery!.rawSessionToken;

    runtime.clock.advanceMinutes(120);
    expect(await resolveAuthenticatedContext(runtime.deps, token)).toBeNull();
  });
});

describe("logout", () => {
  it("(1) logout revoga a sessao corrente", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const r = await loginOk(runtime);
    const ctx = (await resolveAuthenticatedContext(runtime.deps, r.sessionDelivery!.rawSessionToken))!;

    await logout(runtime.deps, ctx, CTX);
    expect(await resolveAuthenticatedContext(runtime.deps, r.sessionDelivery!.rawSessionToken)).toBeNull();
  });

  it("(2) logout global derruba TODAS, inclusive a corrente", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const a = await loginOk(runtime);
    const b = await loginOk(runtime);
    const ctx = (await resolveAuthenticatedContext(runtime.deps, a.sessionDelivery!.rawSessionToken))!;

    await logoutAll(runtime.deps, ctx, CTX);
    expect(await resolveAuthenticatedContext(runtime.deps, a.sessionDelivery!.rawSessionToken)).toBeNull();
    expect(await resolveAuthenticatedContext(runtime.deps, b.sessionDelivery!.rawSessionToken)).toBeNull();
  });
});

describe("changePassword", () => {
  it("(1) troca com senha atual correta revoga TODAS as sessoes", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const a = await loginOk(runtime);
    const b = await loginOk(runtime);
    const ctx = (await resolveAuthenticatedContext(runtime.deps, a.sessionDelivery!.rawSessionToken))!;

    const r = await changePassword(
      runtime.deps,
      ctx,
      { currentPassword: SENHA, newPassword: "nova-senha-longa-1" },
      CTX,
    );
    expect(r.ok).toBe(true);
    // AMBAS as sessoes morrem (evento sensivel).
    expect(await resolveAuthenticatedContext(runtime.deps, a.sessionDelivery!.rawSessionToken)).toBeNull();
    expect(await resolveAuthenticatedContext(runtime.deps, b.sessionDelivery!.rawSessionToken)).toBeNull();
    // A senha realmente mudou: login antigo falha, novo funciona.
    expect((await login(runtime.deps, { emailNormalized: EMAIL, password: SENHA }, CTX)).sessionDelivery).toBeNull();
    expect((await login(runtime.deps, { emailNormalized: EMAIL, password: "nova-senha-longa-1" }, CTX)).sessionDelivery).not.toBeNull();
  });

  it("(2) senha atual errada NAO troca e NAO revoga (sessao roubada nao vira posse)", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
    const a = await loginOk(runtime);
    const ctx = (await resolveAuthenticatedContext(runtime.deps, a.sessionDelivery!.rawSessionToken))!;

    const r = await changePassword(
      runtime.deps,
      ctx,
      { currentPassword: "errada", newPassword: "nova-senha-longa-1" },
      CTX,
    );
    expect(r.ok).toBe(false);
    // Sessao segue viva, senha inalterada.
    expect(await resolveAuthenticatedContext(runtime.deps, a.sessionDelivery!.rawSessionToken)).not.toBeNull();
    expect((await login(runtime.deps, { emailNormalized: EMAIL, password: SENHA }, CTX)).sessionDelivery).not.toBeNull();
  });
});

describe("readCurrentSession", () => {
  it("sem contexto => authenticated=false", async () => {
    const runtime = createTestRuntime();
    expect(await readCurrentSession(runtime.deps, null)).toEqual({ authenticated: false, user: null });
  });
});
