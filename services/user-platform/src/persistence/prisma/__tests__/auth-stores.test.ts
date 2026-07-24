/**
 * Adapters de sessao e de token de uso unico contra um executor FALSO (C7B2).
 *
 * Papel desta suite: provar a FORMA das chamadas (o que exatamente e gravado, o
 * que exatamente e lido, quais pre-condicoes entram no WHERE) e os ramos que o
 * PostgreSQL real nao produz. Os ramos reais sao provados em PostgreSQL 16 pelo
 * validador; um fake nunca substitui aquilo.
 *
 * Todos os hashes aqui sao FICTICIOS mas respeitam a forma sha256 hex que o
 * CHECK do banco exige, para que o mesmo valor sirva ao validador real.
 */

import { describe, expect, it } from "vitest";
import type { SessionRecord, VerificationTokenRecord } from "../../../auth/types.js";
import { createPrismaAuthTokenStore } from "../auth-token-store.js";
import type { PrismaExecutor } from "../executor.js";
import { createPrismaSessionStore } from "../session-store.js";
import type { TransactionScope } from "../../types.js";

const SCOPE: TransactionScope = { transactional: true };

/** Hashes FICTICIOS com forma sha256 hex (64 chars), como o CHECK exige. */
const HASH_SESSAO = "a".repeat(64);
const HASH_CSRF = "b".repeat(64);
const HASH_TOKEN = "c".repeat(64);

const AGORA = new Date("2026-07-22T12:00:00.000Z");

interface Call {
  readonly method: string;
  readonly args: Record<string, unknown>;
}

type Handler = (args: Record<string, unknown>) => unknown;

/**
 * Executor falso. O `as unknown as` acontece UMA vez, aqui, e e inevitavel:
 * `PrismaExecutor` e um `Pick` das delegacoes REAIS do Prisma, cujas assinaturas
 * sao genericas e sobrecarregadas. Nenhum arquivo de producao contem cast, e a
 * guarda de fronteira prova isso varrendo a fonte.
 */
function fakeExecutor(handlers: Record<string, Record<string, Handler>>): {
  executor: PrismaExecutor;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fake: Record<string, unknown> = {};
  for (const model of ["user", "passwordCredential", "userSession", "verificationToken"]) {
    const table = handlers[model] ?? {};
    const delegate: Record<string, unknown> = {};
    for (const [method, handler] of Object.entries(table)) {
      delegate[method] = (args: Record<string, unknown>) => {
        calls.push({ method: `${model}.${method}`, args });
        return Promise.resolve(handler(args));
      };
    }
    fake[model] = delegate;
  }
  return { executor: fake as unknown as PrismaExecutor, calls };
}

const sessao: SessionRecord = {
  userId: 5n,
  tokenHash: HASH_SESSAO,
  csrfTokenHash: HASH_CSRF,
  expiresAt: new Date("2026-07-23T12:00:00.000Z"),
  rotatedFromSessionId: null,
  ipHash: null,
  userAgent: null,
};

const token: VerificationTokenRecord = {
  userId: 5n,
  purpose: "email_verification",
  tokenHash: HASH_TOKEN,
  expiresAt: new Date("2026-07-23T12:00:00.000Z"),
};

describe("SessionStore.create", () => {
  it("(1) grava SO hashes e os campos que o dominio produziu", async () => {
    const { executor, calls } = fakeExecutor({
      userSession: { createManyAndReturn: () => [{ id: 9n }] },
    });
    const r = await createPrismaSessionStore(executor).create(SCOPE, sessao);
    expect(r).toEqual({ kind: "created", sessionId: 9n });

    const linhas = calls[0]!.args["data"] as Record<string, unknown>[];
    expect(linhas[0]).toEqual({
      userId: 5n,
      tokenHash: HASH_SESSAO,
      csrfTokenHash: HASH_CSRF,
      expiresAt: sessao.expiresAt,
      rotatedFromId: null,
      ipHash: null,
      userAgent: null,
    });
    // Nada de `lastUsedAt`/`revokedReason`: colunas existem, mas nenhuma funcao
    // pura as produz — nao se preenche campo so porque a tabela o tem.
    expect(Object.keys(linhas[0]!)).not.toContain("lastUsedAt");
    expect(Object.keys(linhas[0]!)).not.toContain("revokedReason");
  });

  it("(2) a insercao e NAO-ABORTIVA (skipDuplicates)", async () => {
    const { executor, calls } = fakeExecutor({
      userSession: { createManyAndReturn: () => [{ id: 9n }] },
    });
    await createPrismaSessionStore(executor).create(SCOPE, sessao);
    expect(calls[0]!.method).toBe("userSession.createManyAndReturn");
    expect(calls[0]!.args["skipDuplicates"]).toBe(true);
    expect(calls[0]!.args["select"]).toEqual({ id: true });
  });

  it("(3) colisao de tokenHash e CONFIRMADA por leitura antes de ser afirmada", async () => {
    const { executor, calls } = fakeExecutor({
      userSession: {
        createManyAndReturn: () => [],
        findUnique: () => ({ id: 1n }),
      },
    });
    const r = await createPrismaSessionStore(executor).create(SCOPE, sessao);
    expect(r).toEqual({
      kind: "conflict",
      conflict: { reason: "unique_violation", target: "session.tokenHash" },
    });
    expect(calls[1]!.args["where"]).toEqual({ tokenHash: HASH_SESSAO });
  });

  it("(4) zero linhas SEM colisao de tokenHash falha FECHADO", async () => {
    // A tabela tem outra unique (`rotated_from_id`) alem da PK: presumir
    // `session.tokenHash` diria ao chamador que houve colisao de token quando a
    // causa — e a correcao — seria outra.
    const { executor } = fakeExecutor({
      userSession: { createManyAndReturn: () => [], findUnique: () => null },
    });
    await expect(createPrismaSessionStore(executor).create(SCOPE, sessao)).rejects.toThrow(
      /unique nao prevista pelo contrato/i,
    );
  });
});

describe("SessionStore.findByTokenHash", () => {
  it("(1) devolve o material de decisao SEM filtrar vigencia", async () => {
    // Expirada E revogada continuam `found`: quem decide e
    // `evaluateSessionAccess`, que separa expirada de revogada para a auditoria.
    const { executor, calls } = fakeExecutor({
      userSession: {
        findUnique: () => ({
          id: 9n,
          userId: 5n,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          revokedAt: new Date("2020-01-01T00:00:00.000Z"),
        }),
      },
    });
    const r = await createPrismaSessionStore(executor).findByTokenHash(SCOPE, HASH_SESSAO);
    expect(r.kind).toBe("found");
    expect(calls[0]!.args["where"]).toEqual({ tokenHash: HASH_SESSAO });
    // Sem `revokedAt: null`, sem `expiresAt: { gt: ... }` no WHERE.
    expect(JSON.stringify(calls[0]!.args["where"])).not.toContain("expiresAt");
  });

  it("(2) o registro devolvido NAO carrega o hash do TOKEN DE SESSAO", async () => {
    const { executor, calls } = fakeExecutor({
      userSession: {
        findUnique: () => ({
          id: 9n,
          userId: 5n,
          expiresAt: AGORA,
          revokedAt: null,
          csrfTokenHash: HASH_CSRF,
        }),
      },
    });
    const r = await createPrismaSessionStore(executor).findByTokenHash(SCOPE, HASH_SESSAO);
    expect(calls[0]!.args["select"]).toEqual({
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      // C7D: insumo do double submit. E um segredo DIFERENTE do token de
      // sessao, apresentado em outro canal (cabecalho `X-CSRF-Token`), que o
      // chamador nao tem como derivar — sem ele `requireCsrf` e inchamavel.
      csrfTokenHash: true,
    });
    const serializado = JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? "0" : v));
    // O hash do token de SESSAO continua proibido: a busca e por ele, entao
    // quem consultou ja o tem e devolve-lo so ampliaria a superficie.
    expect(serializado).not.toContain(HASH_SESSAO);
    // O CSRF sai — e a excecao provada, para a guarda nao virar vacua.
    expect(serializado).toContain(HASH_CSRF);
  });

  it("(3) ausencia e resultado normal", async () => {
    const { executor } = fakeExecutor({ userSession: { findUnique: () => null } });
    const r = await createPrismaSessionStore(executor).findByTokenHash(SCOPE, HASH_SESSAO);
    expect(r).toEqual({ kind: "not_found" });
  });
});

describe("SessionStore.revoke", () => {
  it("(1) revoga em lote com `revokedAt: null` na PRE-CONDICAO (idempotente)", async () => {
    const { executor, calls } = fakeExecutor({
      userSession: { updateMany: () => ({ count: 2 }) },
    });
    const r = await createPrismaSessionStore(executor).revoke(SCOPE, {
      sessionIds: [1n, 2n],
      now: AGORA,
    });
    expect(r).toEqual({ revokedCount: 2 });
    expect(calls[0]!.args["where"]).toEqual({ id: { in: [1n, 2n] }, revokedAt: null });
    expect(calls[0]!.args["data"]).toEqual({ revokedAt: AGORA });
  });

  it("(2) lista vazia nao toca no banco", async () => {
    const { executor, calls } = fakeExecutor({ userSession: {} });
    const r = await createPrismaSessionStore(executor).revoke(SCOPE, {
      sessionIds: [],
      now: AGORA,
    });
    expect(r).toEqual({ revokedCount: 0 });
    expect(calls).toEqual([]);
  });

  it("(3) o `now` vem do chamador — o adapter nao le relogio", async () => {
    const outroAgora = new Date("2030-01-01T00:00:00.000Z");
    const { executor, calls } = fakeExecutor({
      userSession: { updateMany: () => ({ count: 1 }) },
    });
    await createPrismaSessionStore(executor).revoke(SCOPE, { sessionIds: [1n], now: outroAgora });
    expect(calls[0]!.args["data"]).toEqual({ revokedAt: outroAgora });
  });
});

describe("SessionStore.listActiveIds", () => {
  it("(1) filtra por nao-revogada E ainda vigente em `now`", async () => {
    const { executor, calls } = fakeExecutor({
      userSession: { findMany: () => [{ id: 3n }, { id: 7n }] },
    });
    const ids = await createPrismaSessionStore(executor).listActiveIds(SCOPE, {
      userId: 5n,
      now: AGORA,
    });
    expect(ids).toEqual([3n, 7n]);
    expect(calls[0]!.args["where"]).toEqual({
      userId: 5n,
      revokedAt: null,
      expiresAt: { gt: AGORA },
    });
    expect(calls[0]!.args["select"]).toEqual({ id: true });
  });

  it("(2) usa `gt`, nao `gte` — no instante do vencimento ja nao e ativa", async () => {
    // Espelha `evaluateSessionAccess`, onde `now >= expiresAt` ja e expirado.
    const { executor, calls } = fakeExecutor({ userSession: { findMany: () => [] } });
    await createPrismaSessionStore(executor).listActiveIds(SCOPE, { userId: 5n, now: AGORA });
    const where = calls[0]!.args["where"] as Record<string, unknown>;
    expect(where["expiresAt"]).toEqual({ gt: AGORA });
  });
});

describe("AuthTokenStore.issue", () => {
  it("(1) grava userId, purpose, hash e expiracao — e nada mais", async () => {
    const { executor, calls } = fakeExecutor({
      verificationToken: { createManyAndReturn: () => [{ id: 4n }] },
    });
    const r = await createPrismaAuthTokenStore(executor).issue(SCOPE, token);
    expect(r).toEqual({ kind: "issued", tokenId: 4n });
    const linhas = calls[0]!.args["data"] as Record<string, unknown>[];
    expect(linhas[0]).toEqual({
      userId: 5n,
      purpose: "email_verification",
      tokenHash: HASH_TOKEN,
      expiresAt: token.expiresAt,
    });
    expect(calls[0]!.args["skipDuplicates"]).toBe(true);
  });

  it("(2) NAO invalida tokens anteriores (politica do dominio, nao do adapter)", async () => {
    // `evaluateVerificationResend` autoriza emitir sem olhar pendentes, e o
    // schema nao tem unique por (user, purpose). Queimar aqui inventaria
    // politica; para reset a queima existe e e explicita (`invalidatePending`).
    const { executor, calls } = fakeExecutor({
      verificationToken: { createManyAndReturn: () => [{ id: 4n }] },
    });
    await createPrismaAuthTokenStore(executor).issue(SCOPE, token);
    expect(calls.map((c) => c.method)).toEqual(["verificationToken.createManyAndReturn"]);
  });

  it("(3) colisao confirmada por leitura; sem colisao falha FECHADO", async () => {
    const comColisao = fakeExecutor({
      verificationToken: { createManyAndReturn: () => [], findUnique: () => ({ id: 1n }) },
    });
    await expect(
      createPrismaAuthTokenStore(comColisao.executor).issue(SCOPE, token),
    ).resolves.toEqual({
      kind: "conflict",
      conflict: { reason: "unique_violation", target: "authToken.tokenHash" },
    });

    const semColisao = fakeExecutor({
      verificationToken: { createManyAndReturn: () => [], findUnique: () => null },
    });
    await expect(
      createPrismaAuthTokenStore(semColisao.executor).issue(SCOPE, token),
    ).rejects.toThrow(/unique nao prevista pelo contrato/i);
  });
});

describe("AuthTokenStore.consume", () => {
  const entrada = { tokenHash: HASH_TOKEN, purpose: "email_verification" as const, now: AGORA };

  it("(1) as QUATRO pre-condicoes entram no WHERE (consumo atomico)", async () => {
    const { executor, calls } = fakeExecutor({
      verificationToken: {
        updateMany: () => ({ count: 1 }),
        findUnique: () => ({ userId: 5n }),
      },
    });
    const r = await createPrismaAuthTokenStore(executor).consume(SCOPE, entrada);
    expect(r).toEqual({ kind: "consumed", userId: 5n });
    // Esta e a prova de ausencia de replay: hash, proposito, nao-consumido e
    // nao-expirado sao avaliados pelo banco no MESMO comando que grava.
    expect(calls[0]!.args["where"]).toEqual({
      tokenHash: HASH_TOKEN,
      purpose: "email_verification",
      consumedAt: null,
      expiresAt: { gt: AGORA },
    });
    expect(calls[0]!.args["data"]).toEqual({ consumedAt: AGORA });
  });

  it("(2) classifica os quatro motivos na ordem do dominio", async () => {
    const casos = [
      { linha: null, esperado: "not_found" },
      {
        linha: { purpose: "password_reset", expiresAt: AGORA, consumedAt: null },
        esperado: "wrong_purpose",
      },
      {
        linha: { purpose: "email_verification", expiresAt: AGORA, consumedAt: AGORA },
        esperado: "already_consumed",
      },
      {
        linha: { purpose: "email_verification", expiresAt: AGORA, consumedAt: null },
        esperado: "expired",
      },
    ];
    for (const caso of casos) {
      const { executor } = fakeExecutor({
        verificationToken: { updateMany: () => ({ count: 0 }), findUnique: () => caso.linha },
      });
      const r = await createPrismaAuthTokenStore(executor).consume(SCOPE, entrada);
      expect(r.kind, JSON.stringify(caso.linha)).toBe(caso.esperado);
    }
  });

  it("(3) purpose errado NUNCA consome (verificacao nao troca senha)", async () => {
    const { executor, calls } = fakeExecutor({
      verificationToken: {
        updateMany: () => ({ count: 0 }),
        findUnique: () => ({ purpose: "password_reset", expiresAt: AGORA, consumedAt: null }),
      },
    });
    const r = await createPrismaAuthTokenStore(executor).consume(SCOPE, entrada);
    expect(r).toEqual({ kind: "wrong_purpose" });
    // O proposito estava no WHERE: o UPDATE nem chegou a tocar a linha.
    expect((calls[0]!.args["where"] as Record<string, unknown>)["purpose"]).toBe(
      "email_verification",
    );
  });

  it("(4) mais de uma linha e defeito IMPOSSIVEL: falha fechado sem vazar segredo", async () => {
    const { executor } = fakeExecutor({
      verificationToken: { updateMany: () => ({ count: 2 }) },
    });
    const store = createPrismaAuthTokenStore(executor);
    await expect(store.consume(SCOPE, entrada)).rejects.toThrow(/invariante/i);
    await store.consume(SCOPE, entrada).catch((e: unknown) => {
      expect((e as Error).message).not.toContain(HASH_TOKEN);
    });
  });

  it("(5) nenhum resultado carrega o hash", async () => {
    const { executor } = fakeExecutor({
      verificationToken: {
        updateMany: () => ({ count: 1 }),
        findUnique: () => ({ userId: 5n }),
      },
    });
    const r = await createPrismaAuthTokenStore(executor).consume(SCOPE, entrada);
    const serializado = JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? "0" : v));
    expect(serializado).not.toContain(HASH_TOKEN);
  });
});

describe("AuthTokenStore.invalidatePending", () => {
  it("(1) queima so os PENDENTES do proposito, preservando carimbo dos consumidos", async () => {
    const { executor, calls } = fakeExecutor({
      verificationToken: { updateMany: () => ({ count: 3 }) },
    });
    const r = await createPrismaAuthTokenStore(executor).invalidatePending(SCOPE, {
      userId: 5n,
      purpose: "password_reset",
      now: AGORA,
    });
    expect(r).toEqual({ invalidatedCount: 3 });
    expect(calls[0]!.args["where"]).toEqual({
      userId: 5n,
      purpose: "password_reset",
      consumedAt: null,
    });
    expect(calls[0]!.args["data"]).toEqual({ consumedAt: AGORA });
  });
});

describe("injecao do executor (C7B2)", () => {
  it("(1) os stores usam SO as delegacoes recebidas — nao criam client", async () => {
    const { executor, calls } = fakeExecutor({
      userSession: { findUnique: () => null },
      verificationToken: { updateMany: () => ({ count: 0 }), findUnique: () => null },
    });
    await createPrismaSessionStore(executor).findByTokenHash(SCOPE, HASH_SESSAO);
    await createPrismaAuthTokenStore(executor).consume(SCOPE, {
      tokenHash: HASH_TOKEN,
      purpose: "email_verification",
      now: AGORA,
    });
    expect(calls.map((c) => c.method)).toEqual([
      "userSession.findUnique",
      "verificationToken.updateMany",
      "verificationToken.findUnique",
    ]);
  });
});
