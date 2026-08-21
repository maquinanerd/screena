/**
 * Testes dos SERVICOS DE PRIVACIDADE (C7D): perfil, consentimento versionado,
 * retirada com efeito real, exportacao sem segredos e encerramento.
 */

import { describe, expect, it } from "vitest";
import {
  anonymizeAccount,
  cancelAccountClosure,
  hasActiveConsent,
  readPrivacyState,
  readProfile,
  requestAccountClosure,
  requestDataExport,
  setConsent,
  updateProfile,
} from "../privacy-services.js";
import { login, resolveAuthenticatedContext } from "../account.js";
import { assertExportContainsNoSecrets } from "../../privacy/export.js";
import { createTestRuntime, fakeHashPassword, seedUser } from "./fakes.js";

const CTX = { correlationId: "c-1", clientIpHash: "a".repeat(64), userAgent: "ua" } as const;
const EMAIL = "titular@example.test";
const SENHA = "senha-bem-longa-10";

/** Semeia um titular ativo com credencial e devolve o contexto autenticado. */
async function authenticated(runtime: ReturnType<typeof createTestRuntime>) {
  seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: fakeHashPassword(SENHA) });
  const r = await login(runtime.deps, { emailNormalized: EMAIL, password: SENHA }, CTX);
  const ctx = await resolveAuthenticatedContext(runtime.deps, r.sessionDelivery!.rawSessionToken);
  return { ctx: ctx!, sessionToken: r.sessionDelivery!.rawSessionToken };
}

describe("perfil", () => {
  it("(1) atualiza e le de volta; handle duplicado e conflito", async () => {
    const runtime = createTestRuntime();
    const { ctx } = await authenticated(runtime);

    const r = await updateProfile(
      runtime.deps,
      ctx,
      {
        displayName: "Titular",
        handle: "titular",
        bio: "bio de teste",
        locale: "pt-BR",
        countryCode: "BR",
        timezone: "America/Sao_Paulo",
        visibility: "public",
        density: "comfortable",
        posterSize: "medium",
      },
      CTX,
    );
    expect(r.ok).toBe(true);

    const lido = await readProfile(runtime.deps, ctx);
    expect(lido).toMatchObject({ displayName: "Titular", handle: "titular", visibility: "public" });

    // Outra conta tenta o mesmo handle.
    const outro = seedUser(runtime.db, {
      emailNormalized: "outro@example.test",
      passwordHash: fakeHashPassword(SENHA),
    });
    const rOutro = await updateProfile(
      runtime.deps,
      {
        userId: outro,
        sessionId: 999n,
        userStatus: "active",
        csrfTokenHash: "x",
        emailVerifiedAt: null,
      },
      {
        displayName: null,
        handle: "titular",
        bio: null,
        locale: "pt-BR",
        countryCode: null,
        timezone: null,
        visibility: "private",
        density: "comfortable",
        posterSize: "medium",
      },
      CTX,
    );
    expect(rOutro.ok).toBe(false);
  });
});

describe("consentimento", () => {
  it("(1) conceder e retirar tem efeito REAL e imediato no gate", async () => {
    const runtime = createTestRuntime();
    const { ctx } = await authenticated(runtime);

    // Concede analytics.
    expect((await setConsent(runtime.deps, ctx, { kind: "analytics", granted: true }, CTX)).ok).toBe(true);
    expect(await hasActiveConsent(runtime.deps, ctx.userId, "analytics")).toBe(true);

    // Retira: o gate passa a negar na consulta SEGUINTE (sem cache/job).
    expect((await setConsent(runtime.deps, ctx, { kind: "analytics", granted: false }, CTX)).ok).toBe(true);
    expect(await hasActiveConsent(runtime.deps, ctx.userId, "analytics")).toBe(false);
  });

  it("(2) finalidade nao-revogavel (termos) recusa retirada", async () => {
    const runtime = createTestRuntime();
    const { ctx } = await authenticated(runtime);
    const r = await setConsent(runtime.deps, ctx, { kind: "terms_of_service", granted: false }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("forbidden");
  });

  it("(3) versao de politica divergente NAO autoriza (fail-closed)", async () => {
    const runtime = createTestRuntime({ privacyPolicyVersion: "2026-07" });
    const { ctx } = await authenticated(runtime);
    await setConsent(runtime.deps, ctx, { kind: "analytics", granted: true }, CTX);
    expect(await hasActiveConsent(runtime.deps, ctx.userId, "analytics")).toBe(true);

    // Nova versao do documento: o aceite antigo deixa de valer sem ser apagado.
    const runtime2 = createTestRuntime({ db: runtime.db, privacyPolicyVersion: "2026-08" });
    expect(await hasActiveConsent(runtime2.deps, ctx.userId, "analytics")).toBe(false);
  });

  it("(4) ausencia de registro nunca equivale a granted", async () => {
    const runtime = createTestRuntime();
    const { ctx } = await authenticated(runtime);
    expect(await hasActiveConsent(runtime.deps, ctx.userId, "analytics")).toBe(false);
    const estado = await readPrivacyState(runtime.deps, ctx);
    const analytics = estado.consents.find((c) => c.kind === "analytics")!;
    expect(analytics.granted).toBeNull();
  });
});

describe("exportacao", () => {
  it("(1) exporta dados do titular e NUNCA contem segredo", async () => {
    const runtime = createTestRuntime();
    const { ctx } = await authenticated(runtime);
    await updateProfile(
      runtime.deps,
      ctx,
      {
        displayName: "T",
        handle: null,
        bio: null,
        locale: "pt-BR",
        countryCode: null,
        timezone: null,
        visibility: "private",
        density: "comfortable",
        posterSize: "medium",
      },
      CTX,
    );
    await setConsent(runtime.deps, ctx, { kind: "analytics", granted: true }, CTX);

    const r = await requestDataExport(runtime.deps, ctx, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.format).toBe("cinerie.export.v1");
    expect(r.value.consents.length).toBeGreaterThan(0);
    // A rede de seguranca concorda: nenhuma chave de segredo.
    expect(assertExportContainsNoSecrets(r.value).ok).toBe(true);
    // Prova explicita: nada que pareca hash/token/senha na serializacao.
    const json = JSON.stringify(r.value);
    expect(json).not.toMatch(/passwordHash|csrfTokenHash|tokenHash/i);
  });

  it("(2) pedido duplicado ATIVO e recusado (idempotencia)", async () => {
    const runtime = createTestRuntime();
    const { ctx } = await authenticated(runtime);
    // Primeiro conclui (sincrono); um segundo imediato encontra o anterior ja
    // 'completed', que LIBERA um novo. Para provar o bloqueio, forcamos um
    // pending manual.
    runtime.db.dataRequests.push({
      id: 500n,
      userId: ctx.userId,
      kind: "export",
      status: "pending",
      requestedAt: runtime.clock.now,
      processedAt: null,
    });
    const r = await requestDataExport(runtime.deps, ctx, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("conflict");
  });
});

describe("encerramento", () => {
  it("(1) encerra com senha, revoga TODAS as sessoes e vai a pending_deletion", async () => {
    const runtime = createTestRuntime();
    const { ctx, sessionToken } = await authenticated(runtime);

    const r = await requestAccountClosure(runtime.deps, ctx, { password: SENHA }, CTX);
    expect(r.ok).toBe(true);
    // Conta em encerramento.
    expect(runtime.db.users.get(EMAIL)!.status).toBe("pending_deletion");
    // Sessao derrubada.
    expect(await resolveAuthenticatedContext(runtime.deps, sessionToken)).toBeNull();
    // Pedido de deletion registrado.
    expect(runtime.db.dataRequests.some((d) => d.userId === ctx.userId && d.kind === "deletion")).toBe(true);
  });

  it("(2) senha errada NAO encerra", async () => {
    const runtime = createTestRuntime();
    const { ctx } = await authenticated(runtime);
    const r = await requestAccountClosure(runtime.deps, ctx, { password: "errada" }, CTX);
    expect(r.ok).toBe(false);
    expect(runtime.db.users.get(EMAIL)!.status).toBe("active");
  });

  it("(3) cancelamento assistido volta a active dentro da janela", async () => {
    const runtime = createTestRuntime({ deletionGraceDays: 30 });
    const { ctx } = await authenticated(runtime);
    await requestAccountClosure(runtime.deps, ctx, { password: SENHA }, CTX);
    expect(runtime.db.users.get(EMAIL)!.status).toBe("pending_deletion");

    const cancel = await cancelAccountClosure(
      runtime.deps,
      { userId: ctx.userId, userStatus: "pending_deletion" },
      "operador@cinerie",
    );
    expect(cancel.ok).toBe(true);
    expect(runtime.db.users.get(EMAIL)!.status).toBe("active");
  });

  it("(5) C8: anonimizacao EXECUTA a retencao de product_content", async () => {
    // `DATA_CLASSIFICATION.product_content` prescreve delete. Antes do C8 nao
    // havia store de conteudo de produto e a politica nunca era executada — a
    // conta virava tumba com a biblioteca intacta. Este teste trava a correcao.
    const runtime = createTestRuntime({ deletionGraceDays: 0 });
    const { ctx } = await authenticated(runtime);

    // Semeia biblioteca do titular.
    runtime.db.entities.push({ entityType: "movie", entityId: 77n });
    runtime.db.watchStates.push({
      userId: ctx.userId,
      entityType: "movie",
      entityId: 77n,
      status: "watched",
      startedAt: null,
      completedAt: null,
      lastActivityAt: runtime.clock.now,
      rewatchCount: 0,
      version: 1,
      updatedAt: runtime.clock.now,
    });
    runtime.db.userRatings.push({
      userId: ctx.userId,
      entityType: "movie",
      entityId: 77n,
      value: 4,
      createdAt: runtime.clock.now,
      updatedAt: runtime.clock.now,
    });
    // Prova de consentimento (retain_indefinitely) que NAO pode ser apagada.
    await setConsent(runtime.deps, ctx, { kind: "analytics", granted: true }, CTX);
    const consentimentosAntes = runtime.db.consents.length;
    expect(consentimentosAntes).toBeGreaterThan(0);

    await requestAccountClosure(runtime.deps, ctx, { password: SENHA }, CTX);
    const r = await anonymizeAccount(runtime.deps, ctx.userId, "operador@cinerie");
    expect(r.ok).toBe(true);

    // Conteudo de produto APAGADO...
    expect(runtime.db.watchStates.filter((w) => w.userId === ctx.userId)).toHaveLength(0);
    expect(runtime.db.userRatings.filter((x) => x.userId === ctx.userId)).toHaveLength(0);
    // ...e a prova legal PRESERVADA (retain_indefinitely).
    expect(runtime.db.consents.length).toBe(consentimentosAntes);
  });

  it("(4) anonimizacao vira tumba: linha permanece, PII some", async () => {
    const runtime = createTestRuntime({ deletionGraceDays: 0 });
    const { ctx } = await authenticated(runtime);
    await requestAccountClosure(runtime.deps, ctx, { password: SENHA }, CTX);

    const r = await anonymizeAccount(runtime.deps, ctx.userId, "operador@cinerie");
    expect(r.ok).toBe(true);
    // A linha NAO some — vira tumba com e-mail anonimo e status deleted.
    const tumba = [...runtime.db.users.values()].find((u) => u.id === ctx.userId);
    expect(tumba).toBeDefined();
    expect(tumba!.status).toBe("deleted");
    expect(tumba!.emailNormalized).toContain("anonymized.invalid");
    expect(tumba!.emailNormalized).not.toBe(EMAIL);
  });
});
