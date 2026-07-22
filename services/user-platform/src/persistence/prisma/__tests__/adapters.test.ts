/**
 * Adapters de identidade e credencial contra um executor FALSO (C7B1).
 *
 * Papel desta suite: provar a FORMA das chamadas (o que exatamente e gravado, o
 * que exatamente e lido) e os ramos que o PostgreSQL real NAO consegue produzir
 * — em especial `count > 1` no compare-and-swap, que so existe se o banco tiver
 * perdido a constraint. Os ramos que o banco produz de verdade sao provados em
 * PostgreSQL 16 por `scripts/validate-user-product-platform-real-postgres.ts`;
 * um fake nunca substitui aquilo, so cobre o que ele nao alcanca.
 *
 * Todos os hashes e e-mails aqui sao FICTICIOS.
 */

import type { PrismaClient } from "@screena/db/server";
import { describe, expect, it } from "vitest";
import type { PrismaExecutor } from "../executor.js";
import { createPrismaIdentityStore } from "../identity-store.js";
import { createPrismaPasswordCredentialStore } from "../password-credential-store.js";
import type { TransactionScope } from "../../types.js";

const SCOPE: TransactionScope = { transactional: true };

/** Hash FICTICIO em formato PHC-like (nenhum segredo real neste arquivo). */
const HASH_ATUAL = "scrypt$N=32768,r=8,p=1$00112233$hash-ficticio-atual";
const HASH_NOVO = "scrypt$N=32768,r=8,p=1$44556677$hash-ficticio-novo";

interface Call {
  readonly method: string;
  readonly args: Record<string, unknown>;
}

type Handler = (args: Record<string, unknown>) => unknown;

/**
 * Executor falso: registra toda chamada e delega a um handler por metodo.
 *
 * O `as unknown as` acontece UMA vez, aqui, e e inevitavel: `PrismaExecutor` e
 * um `Pick` das delegacoes REAIS do Prisma, cujas assinaturas sao genericas e
 * sobrecarregadas (o tipo de retorno e inferido do `select`). Reimplementa-las a
 * mao no teste seria reescrever o driver. O cast esta confinado a este helper —
 * nenhum arquivo de producao do adapter contem cast, e a guarda de fronteira
 * prova isso varrendo a fonte.
 */
function fakeExecutor(handlers: {
  user?: Record<string, Handler>;
  passwordCredential?: Record<string, Handler>;
}): { executor: PrismaExecutor; calls: Call[] } {
  const calls: Call[] = [];
  const build = (model: "user" | "passwordCredential"): Record<string, unknown> => {
    const table = handlers[model] ?? {};
    const delegate: Record<string, unknown> = {};
    for (const [method, handler] of Object.entries(table)) {
      delegate[method] = (args: Record<string, unknown>) => {
        calls.push({ method: `${model}.${method}`, args });
        return Promise.resolve(handler(args));
      };
    }
    return delegate;
  };
  const fake = { user: build("user"), passwordCredential: build("passwordCredential") };
  return { executor: fake as unknown as PrismaExecutor, calls };
}

/**
 * Nao ha mais `driverError` nesta suite, e a ausencia e o ponto: depois do
 * C7B1.1 nenhum adapter inspeciona codigo de erro do Prisma para produzir
 * resultado previsto pelo contrato. Todo outcome esperado vem de operacao
 * nao-abortiva; excecao que aparece aqui e falha de verdade e sobe intacta.
 */

describe("IdentityStore.create", () => {
  /** Insercao que SUCEDE devolve exatamente uma linha. */
  const insercaoOk = () => [{ id: 1n, status: "active" }];
  /** Insercao barrada por `ON CONFLICT DO NOTHING` devolve ZERO linhas. */
  const insercaoBarrada = () => [];

  it("(1) grava e-mail BRUTO, NORMALIZADO e displayName — e nada alem disso", async () => {
    const { executor, calls } = fakeExecutor({
      user: { createManyAndReturn: insercaoOk },
    });
    const result = await createPrismaIdentityStore(executor).create(SCOPE, {
      email: "Alice@Example.Test",
      emailNormalized: "alice@example.test",
      displayName: "Alice",
    });
    expect(result.kind).toBe("created");
    const linhas = calls[0]!.args["data"] as Record<string, unknown>[];
    const data = linhas[0]!;
    // As duas colunas tem uniques DISTINTOS: o adapter grava os dois valores
    // que recebeu e nao reconstroi um do outro.
    expect(data["email"]).toBe("Alice@Example.Test");
    expect(data["emailNormalized"]).toBe("alice@example.test");
    expect(data["displayName"]).toBe("Alice");
    // Sem `status`, sem `role`, sem `handle`: os defaults sao do banco e
    // defini-los aqui criaria operacao administrativa que nenhum fluxo pede.
    expect(Object.keys(data).sort()).toEqual(["displayName", "email", "emailNormalized"]);
  });

  it("(2) a insercao e NAO-ABORTIVA (skipDuplicates), nunca um create que lanca", async () => {
    // Esta e a assercao central do C7B1.1. `create` levanta P2002 em colisao, e
    // uma violacao de constraint aborta a transacao do Postgres mesmo quando a
    // excecao e capturada. `skipDuplicates` emite ON CONFLICT DO NOTHING: nao ha
    // erro para capturar, entao a transacao sobrevive.
    const { executor, calls } = fakeExecutor({
      user: { createManyAndReturn: insercaoOk },
    });
    await createPrismaIdentityStore(executor).create(SCOPE, {
      email: "a@example.test",
      emailNormalized: "a@example.test",
      displayName: null,
    });
    expect(calls[0]!.method).toBe("user.createManyAndReturn");
    expect(calls[0]!.args["skipDuplicates"]).toBe(true);
  });

  it("(3) NAO normaliza o e-mail (a normalizacao e do dominio)", async () => {
    const { executor, calls } = fakeExecutor({
      user: { createManyAndReturn: insercaoOk },
    });
    // Entrada deliberadamente incoerente: se o adapter normalizasse, o valor
    // gravado em `email` mudaria.
    await createPrismaIdentityStore(executor).create(SCOPE, {
      email: "  MAIUSCULA@Example.Test  ",
      emailNormalized: "ja-normalizado@example.test",
      displayName: null,
    });
    const linhas = calls[0]!.args["data"] as Record<string, unknown>[];
    expect(linhas[0]!["email"]).toBe("  MAIUSCULA@Example.Test  ");
    expect(linhas[0]!["emailNormalized"]).toBe("ja-normalizado@example.test");
  });

  it("(4) le SO id e status de volta", async () => {
    const { executor, calls } = fakeExecutor({
      user: { createManyAndReturn: insercaoOk },
    });
    await createPrismaIdentityStore(executor).create(SCOPE, {
      email: "a@example.test",
      emailNormalized: "a@example.test",
      displayName: null,
    });
    expect(calls[0]!.args["select"]).toEqual({ id: true, status: true });
  });

  it("(5) conflito de e-mail NORMALIZADO e classificado por leitura", async () => {
    const { executor, calls } = fakeExecutor({
      user: {
        createManyAndReturn: insercaoBarrada,
        // A primeira sonda (normalizado) encontra.
        findUnique: () => ({ id: 7n }),
      },
    });
    const result = await createPrismaIdentityStore(executor).create(SCOPE, {
      email: "Alice@Example.Test",
      emailNormalized: "alice@example.test",
      displayName: null,
    });
    expect(result).toEqual({
      kind: "conflict",
      conflict: { reason: "unique_violation", target: "identity.emailNormalized" },
    });
    // A sonda le APENAS existencia — nenhuma PII volta.
    expect(calls[1]!.args["where"]).toEqual({ emailNormalized: "alice@example.test" });
    expect(calls[1]!.args["select"]).toEqual({ id: true });
  });

  it("(6) conflito SO de e-mail bruto cai na segunda sonda", async () => {
    let chamada = 0;
    const { executor, calls } = fakeExecutor({
      user: {
        createManyAndReturn: insercaoBarrada,
        findUnique: () => {
          chamada += 1;
          // 1a sonda (normalizado) nao acha; 2a (bruto) acha.
          return chamada === 1 ? null : { id: 7n };
        },
      },
    });
    const result = await createPrismaIdentityStore(executor).create(SCOPE, {
      email: "Dup@Example.Test",
      emailNormalized: "outro@example.test",
      displayName: null,
    });
    expect(result).toEqual({
      kind: "conflict",
      conflict: { reason: "unique_violation", target: "identity.email" },
    });
    expect(calls[2]!.args["where"]).toEqual({ email: "Dup@Example.Test" });
  });

  it("(7) nenhuma sonda encontra => FALHA FECHADO (nunca 'e-mail ja registrado')", async () => {
    // Os dois e-mails estao LIVRES e mesmo assim o INSERT foi barrado: a colisao
    // veio de outra unique (na pratica a PK, com a sequence dessincronizada).
    // Devolver `unique_violation` faria `decideSignup` dizer ao usuario que o
    // e-mail dele ja esta registrado quando esta livre — e nenhuma retentativa
    // corrigiria. Sem resultado tipado possivel, o silencio seria a mentira.
    const { executor } = fakeExecutor({
      user: { createManyAndReturn: insercaoBarrada, findUnique: () => null },
    });
    await expect(
      createPrismaIdentityStore(executor).create(SCOPE, {
        email: "livre@example.test",
        emailNormalized: "livre@example.test",
        displayName: null,
      }),
    ).rejects.toThrow(/unique nao prevista pelo contrato/i);
  });

  it("(8) erro do banco sobe INTACTO (nunca vira resultado de negocio)", async () => {
    const falha = new Error("falha de infraestrutura");
    const { executor } = fakeExecutor({
      user: {
        createManyAndReturn: () => {
          throw falha;
        },
      },
    });
    await expect(
      createPrismaIdentityStore(executor).create(SCOPE, {
        email: "a@example.test",
        emailNormalized: "a@example.test",
        displayName: null,
      }),
    ).rejects.toBe(falha);
  });
});

describe("IdentityStore.findByNormalizedEmail", () => {
  it("(1) busca SO por email_normalized, sem filtro de status", async () => {
    const { executor, calls } = fakeExecutor({
      user: { findUnique: () => ({ id: 9n, status: "pending_deletion" }) },
    });
    const result = await createPrismaIdentityStore(executor).findByNormalizedEmail(
      SCOPE,
      "alice@example.test",
    );
    // O `where` tem UMA chave: nem e-mail bruto como fallback, nem `deletedAt`.
    // Esconder conta em exclusao devolveria `not_found` para uma linha que ainda
    // ocupa o unique — e o cadastro seguinte falharia com conflito "impossivel".
    expect(calls[0]!.args["where"]).toEqual({ emailNormalized: "alice@example.test" });
    expect(calls[0]!.args["select"]).toEqual({ id: true, status: true });
    expect(result).toEqual({ kind: "found", identity: { id: 9n, status: "pending_deletion" } });
  });

  it("(2) ausencia e resultado NORMAL, nao erro", async () => {
    const { executor } = fakeExecutor({ user: { findUnique: () => null } });
    const result = await createPrismaIdentityStore(executor).findByNormalizedEmail(
      SCOPE,
      "ninguem@example.test",
    );
    expect(result).toEqual({ kind: "not_found" });
  });

  it("(3) o retorno nunca carrega hash", async () => {
    const { executor } = fakeExecutor({
      user: { findUnique: () => ({ id: 9n, status: "active" }) },
    });
    const result = await createPrismaIdentityStore(executor).findByNormalizedEmail(
      SCOPE,
      "a@example.test",
    );
    const serialized = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? "0" : v));
    expect(serialized).not.toMatch(/hash|scrypt|algorithm/i);
  });
});

describe("IdentityStore.findById (C7B2.1)", () => {
  it("(1) busca pela PK com o MESMO select minimo da busca por e-mail", async () => {
    const { executor, calls } = fakeExecutor({
      user: { findUnique: () => ({ id: 9n, status: "active" }) },
    });
    const r = await createPrismaIdentityStore(executor).findById(SCOPE, 9n);
    expect(r).toEqual({ kind: "found", identity: { id: 9n, status: "active" } });
    expect(calls[0]!.args["where"]).toEqual({ id: 9n });
    expect(calls[0]!.args["select"]).toEqual({ id: true, status: true });
  });

  it("(2) NAO filtra conta desativada — quem decide elegibilidade e o dominio", async () => {
    // Devolver `not_found` aqui mentiria sobre a existencia da conta e apagaria a
    // distincao `account_ineligible` != `not_found` do motivo interno.
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const { executor, calls } = fakeExecutor({
        user: { findUnique: () => ({ id: 9n, status }) },
      });
      const r = await createPrismaIdentityStore(executor).findById(SCOPE, 9n);
      expect(r.kind, status).toBe("found");
      // Nenhum filtro de status no WHERE.
      expect(Object.keys(calls[0]!.args["where"] as object)).toEqual(["id"]);
    }
  });

  it("(3) ausencia e resultado tipado", async () => {
    const { executor } = fakeExecutor({ user: { findUnique: () => null } });
    const r = await createPrismaIdentityStore(executor).findById(SCOPE, 404n);
    expect(r).toEqual({ kind: "not_found" });
  });

  it("(4) nao devolve segredo nem PII", async () => {
    const { executor } = fakeExecutor({
      user: {
        findUnique: () => ({
          id: 9n,
          status: "active",
          email: "vazamento@example.test",
          passwordHash: "scrypt$N=1,r=1,p=1$0000$ficticio",
        }),
      },
    });
    const r = await createPrismaIdentityStore(executor).findById(SCOPE, 9n);
    const serializado = JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? "0" : v));
    expect(serializado).not.toMatch(/hash|scrypt|@/i);
  });
});

describe("IdentityStore.markEmailVerified (C7B2.1)", () => {
  const AGORA_V = new Date("2026-07-22T12:00:00.000Z");

  it("(1) a pre-condicao `emailVerifiedAt: null` esta no WHERE (atomico)", async () => {
    const { executor, calls } = fakeExecutor({
      user: { updateMany: () => ({ count: 1 }) },
    });
    const r = await createPrismaIdentityStore(executor).markEmailVerified(SCOPE, {
      userId: 5n,
      now: AGORA_V,
    });
    expect(r).toEqual({ kind: "verified" });
    // Esta pre-condicao E a prova de que o primeiro carimbo nunca e sobrescrito.
    expect(calls[0]!.args["where"]).toEqual({ id: 5n, emailVerifiedAt: null });
    expect(calls[0]!.args["data"]).toEqual({ emailVerifiedAt: AGORA_V });
  });

  it("(2) sucesso NAO dispara leitura extra", async () => {
    const { executor, calls } = fakeExecutor({
      user: { updateMany: () => ({ count: 1 }) },
    });
    await createPrismaIdentityStore(executor).markEmailVerified(SCOPE, {
      userId: 5n,
      now: AGORA_V,
    });
    expect(calls.map((c) => c.method)).toEqual(["user.updateMany"]);
  });

  it("(3) ja verificada e idempotente (carimbo original preservado)", async () => {
    const { executor, calls } = fakeExecutor({
      user: { updateMany: () => ({ count: 0 }), findUnique: () => ({ id: 5n }) },
    });
    const r = await createPrismaIdentityStore(executor).markEmailVerified(SCOPE, {
      userId: 5n,
      now: AGORA_V,
    });
    expect(r).toEqual({ kind: "already_verified" });
    // A sonda le APENAS existencia — nenhum carimbo, nenhuma PII.
    expect(calls[1]!.args["select"]).toEqual({ id: true });
  });

  it("(4) conta inexistente e distinta de ja verificada", async () => {
    const { executor } = fakeExecutor({
      user: { updateMany: () => ({ count: 0 }), findUnique: () => null },
    });
    const r = await createPrismaIdentityStore(executor).markEmailVerified(SCOPE, {
      userId: 404n,
      now: AGORA_V,
    });
    expect(r).toEqual({ kind: "not_found" });
  });

  it("(5) o `now` vem do chamador — o adapter nao le relogio", async () => {
    const outro = new Date("2030-01-01T00:00:00.000Z");
    const { executor, calls } = fakeExecutor({
      user: { updateMany: () => ({ count: 1 }) },
    });
    await createPrismaIdentityStore(executor).markEmailVerified(SCOPE, {
      userId: 5n,
      now: outro,
    });
    expect(calls[0]!.args["data"]).toEqual({ emailVerifiedAt: outro });
  });

  it("(6) mais de uma linha e defeito IMPOSSIVEL (id e PK): falha fechado", async () => {
    const { executor } = fakeExecutor({ user: { updateMany: () => ({ count: 2 }) } });
    await expect(
      createPrismaIdentityStore(executor).markEmailVerified(SCOPE, { userId: 5n, now: AGORA_V }),
    ).rejects.toThrow(/invariante/i);
  });
});

describe("PasswordCredentialStore.createInitial", () => {
  /** Dono existe: a sonda de FK encontra a linha. */
  const donoExiste = () => ({ id: 5n });
  const insercaoOk = () => [{ id: 1n }];
  const insercaoBarrada = () => [];

  it("(1) grava userId, hash e algoritmo VINDO DO PORT — e nao devolve o hash", async () => {
    const { executor, calls } = fakeExecutor({
      user: { findUnique: donoExiste },
      passwordCredential: { createManyAndReturn: insercaoOk },
    });
    const result = await createPrismaPasswordCredentialStore(executor).createInitial(SCOPE, {
      userId: 5n,
      passwordHash: HASH_ATUAL,
      algorithm: "scrypt",
    });
    expect(result).toEqual({ kind: "created" });
    const linhas = calls[1]!.args["data"] as Record<string, unknown>[];
    expect(linhas[0]).toEqual({ userId: 5n, passwordHash: HASH_ATUAL, algorithm: "scrypt" });
    // A insercao devolveria a linha inteira (com o hash) sem este select.
    expect(calls[1]!.args["select"]).toEqual({ id: true });
  });

  it("(2) a insercao e NAO-ABORTIVA (skipDuplicates)", async () => {
    const { executor, calls } = fakeExecutor({
      user: { findUnique: donoExiste },
      passwordCredential: { createManyAndReturn: insercaoOk },
    });
    await createPrismaPasswordCredentialStore(executor).createInitial(SCOPE, {
      userId: 5n,
      passwordHash: HASH_ATUAL,
      algorithm: "scrypt",
    });
    expect(calls[1]!.method).toBe("passwordCredential.createManyAndReturn");
    expect(calls[1]!.args["skipDuplicates"]).toBe(true);
  });

  it("(3) NAO infere o algoritmo a partir do hash", async () => {
    const { executor, calls } = fakeExecutor({
      user: { findUnique: donoExiste },
      passwordCredential: { createManyAndReturn: insercaoOk },
    });
    // Hash cujo prefixo (`scrypt`) diverge do rotulo enviado: se o adapter
    // interpretasse o PHC, gravaria "scrypt" em vez do valor recebido.
    await createPrismaPasswordCredentialStore(executor).createInitial(SCOPE, {
      userId: 5n,
      passwordHash: HASH_ATUAL,
      algorithm: "rotulo-vindo-do-dominio",
    });
    const linhas = calls[1]!.args["data"] as Record<string, unknown>[];
    expect(linhas[0]!["algorithm"]).toBe("rotulo-vindo-do-dominio");
  });

  it("(4) segunda credencial do mesmo usuario e already_exists (1:1), nunca sobrescreve", async () => {
    const { executor, calls } = fakeExecutor({
      user: { findUnique: donoExiste },
      passwordCredential: {
        createManyAndReturn: insercaoBarrada,
        // A credencial REALMENTE existe — o alvo e confirmado, nao presumido.
        findUnique: () => ({ id: 1n }),
      },
    });
    const result = await createPrismaPasswordCredentialStore(executor).createInitial(SCOPE, {
      userId: 5n,
      passwordHash: HASH_NOVO,
      algorithm: "scrypt",
    });
    expect(result).toEqual({
      kind: "already_exists",
      conflict: { reason: "unique_violation", target: "credential.user" },
    });
    // Sonda de dono + insercao + confirmacao do alvo. Nenhum update/upsert.
    expect(calls.map((c) => c.method)).toEqual([
      "user.findUnique",
      "passwordCredential.createManyAndReturn",
      "passwordCredential.findUnique",
    ]);
  });

  it("(4b) zero linhas SEM credencial existente FALHA FECHADO (unique nao prevista)", async () => {
    // `ON CONFLICT DO NOTHING` sem alvo absorve TODA unique — inclusive a PK.
    // Afirmar `already_exists` aqui diria "este usuario ja tem credencial"
    // quando ele NAO tem: ele ficaria com identidade e sem credencial, sem
    // conseguir logar, e toda retentativa repetiria o diagnostico errado.
    const { executor } = fakeExecutor({
      user: { findUnique: donoExiste },
      passwordCredential: {
        createManyAndReturn: insercaoBarrada,
        findUnique: () => null,
      },
    });
    await expect(
      createPrismaPasswordCredentialStore(executor).createInitial(SCOPE, {
        userId: 5n,
        passwordHash: HASH_ATUAL,
        algorithm: "scrypt",
      }),
    ).rejects.toThrow(/unique nao prevista pelo contrato/i);
  });

  it("(5) usuario inexistente vira user_not_found SEM tocar na tabela de credencial", async () => {
    // O ponto do C7B1.1: `ON CONFLICT DO NOTHING` neutraliza a unicidade, mas
    // NAO a chave estrangeira. Deixar o INSERT acontecer produziria P2003 e
    // abortaria a transacao. A sonda de existencia produz o resultado tipado
    // sem que nenhuma violacao chegue ao banco.
    const { executor, calls } = fakeExecutor({
      user: { findUnique: () => null },
      passwordCredential: { createManyAndReturn: insercaoOk },
    });
    const result = await createPrismaPasswordCredentialStore(executor).createInitial(SCOPE, {
      userId: 404n,
      passwordHash: HASH_ATUAL,
      algorithm: "scrypt",
    });
    expect(result).toEqual({ kind: "user_not_found" });
    expect(calls.map((c) => c.method)).toEqual(["user.findUnique"]);
    expect(calls[0]!.args["select"]).toEqual({ id: true });
  });

  it("(6) erro do banco sobe INTACTO (nunca vira resultado de negocio)", async () => {
    const falha = new Error("falha de infraestrutura");
    const { executor } = fakeExecutor({
      user: { findUnique: donoExiste },
      passwordCredential: {
        createManyAndReturn: () => {
          throw falha;
        },
      },
    });
    await expect(
      createPrismaPasswordCredentialStore(executor).createInitial(SCOPE, {
        userId: 5n,
        passwordHash: HASH_ATUAL,
        algorithm: "scrypt",
      }),
    ).rejects.toBe(falha);
  });
});

describe("PasswordCredentialStore.findForVerification", () => {
  it("(1) le SO o hash — nem algoritmo, nem id, nem usuario", async () => {
    const { executor, calls } = fakeExecutor({
      passwordCredential: { findUnique: () => ({ passwordHash: HASH_ATUAL }) },
    });
    const result = await createPrismaPasswordCredentialStore(executor).findForVerification(
      SCOPE,
      5n,
    );
    expect(calls[0]!.args["where"]).toEqual({ userId: 5n });
    expect(calls[0]!.args["select"]).toEqual({ passwordHash: true });
    expect(result).toEqual({ kind: "found", material: { passwordHash: HASH_ATUAL } });
  });

  it("(2) ausencia e tipada", async () => {
    const { executor } = fakeExecutor({ passwordCredential: { findUnique: () => null } });
    const result = await createPrismaPasswordCredentialStore(executor).findForVerification(
      SCOPE,
      5n,
    );
    expect(result).toEqual({ kind: "not_found" });
  });
});

describe("PasswordCredentialStore.replaceByPreimage (compare-and-swap)", () => {
  const input = {
    userId: 5n,
    expectedPasswordHash: HASH_ATUAL,
    nextPasswordHash: HASH_NOVO,
    nextAlgorithm: "scrypt",
  };

  it("(1) a PRE-IMAGEM entra no WHERE (swap atomico, sem ler-comparar-gravar)", async () => {
    const { executor, calls } = fakeExecutor({
      passwordCredential: { updateMany: () => ({ count: 1 }) },
    });
    const result = await createPrismaPasswordCredentialStore(executor).replaceByPreimage(
      SCOPE,
      input,
    );
    expect(result).toEqual({ kind: "updated" });
    // Este `where` E a prova de ausencia de TOCTOU: a condicao e avaliada pelo
    // banco no mesmo comando que grava.
    expect(calls[0]!.method).toBe("passwordCredential.updateMany");
    expect(calls[0]!.args["where"]).toEqual({ userId: 5n, passwordHash: HASH_ATUAL });
    expect(calls[0]!.args["data"]).toEqual({ passwordHash: HASH_NOVO, algorithm: "scrypt" });
  });

  it("(2) sucesso NAO dispara leitura extra (nenhuma sonda desnecessaria)", async () => {
    const { executor, calls } = fakeExecutor({
      passwordCredential: { updateMany: () => ({ count: 1 }) },
    });
    await createPrismaPasswordCredentialStore(executor).replaceByPreimage(SCOPE, input);
    expect(calls.map((c) => c.method)).toEqual(["passwordCredential.updateMany"]);
  });

  it("(3) zero linhas COM credencial existente = stale_preimage (nunca last-write-wins)", async () => {
    const { executor, calls } = fakeExecutor({
      passwordCredential: {
        updateMany: () => ({ count: 0 }),
        findUnique: () => ({ id: 1n }),
      },
    });
    const result = await createPrismaPasswordCredentialStore(executor).replaceByPreimage(
      SCOPE,
      input,
    );
    expect(result).toEqual({
      kind: "conflict",
      conflict: { reason: "stale_preimage", target: "credential.passwordHash" },
    });
    // A sonda le APENAS existencia — jamais o hash.
    expect(calls[1]!.args["select"]).toEqual({ id: true });
  });

  it("(4) zero linhas SEM credencial = not_found (distinto de conflito)", async () => {
    const { executor } = fakeExecutor({
      passwordCredential: {
        updateMany: () => ({ count: 0 }),
        findUnique: () => null,
      },
    });
    const result = await createPrismaPasswordCredentialStore(executor).replaceByPreimage(
      SCOPE,
      input,
    );
    expect(result).toEqual({ kind: "not_found" });
  });

  it("(5) a sonda NUNCA transforma corrida em sucesso", async () => {
    // Mesmo que a credencial volte a existir entre o swap e a sonda, o resultado
    // permitido e apenas conflito ou ausencia.
    for (const sonda of [() => ({ id: 1n }), () => null]) {
      const { executor } = fakeExecutor({
        passwordCredential: { updateMany: () => ({ count: 0 }), findUnique: sonda },
      });
      const result = await createPrismaPasswordCredentialStore(executor).replaceByPreimage(
        SCOPE,
        input,
      );
      expect(result.kind).not.toBe("updated");
    }
  });

  it("(6) mais de uma linha alterada e defeito IMPOSSIVEL: falha fechado, sem vazar segredo", async () => {
    // O banco so produz isto se tiver perdido o unique de `user_id` — por isso
    // este ramo nao tem como ser exercitado em PostgreSQL real.
    const { executor } = fakeExecutor({
      passwordCredential: { updateMany: () => ({ count: 2 }) },
    });
    const store = createPrismaPasswordCredentialStore(executor);
    await expect(store.replaceByPreimage(SCOPE, input)).rejects.toThrow(/invariante/i);
    await store.replaceByPreimage(SCOPE, input).catch((error: unknown) => {
      const message = (error as Error).message;
      expect(message).not.toContain(HASH_ATUAL);
      expect(message).not.toContain(HASH_NOVO);
      expect(message).not.toMatch(/scrypt|user_id|SELECT|UPDATE/i);
    });
  });
});

// ---------------------------------------------------------------------------
// PROVAS DE TIPO (verificadas por `pnpm typecheck`, nao em runtime).
//
// Elas vivem num TESTE, e nao no adapter, de proposito: `$transaction` e
// `$disconnect` sao justamente os membros que o adapter nao pode nomear — a
// guarda de fronteira o proibe. Aqui, fora do escopo varrido, e possivel provar
// o que o adapter garante SEM poder dize-lo.
//
// O validador em PostgreSQL real exercita o mesmo caminho em runtime, mas ele
// mora em `scripts/`, que o `tsconfig.json` EXCLUI do typecheck — sem estas
// linhas, a compatibilidade com o client de transacao nao seria verificada por
// nenhum compilador.
// ---------------------------------------------------------------------------

/** Client de transacao interativa, como o Prisma o entrega ao callback. */
type InteractiveTransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** (a) O client de transacao SATISFAZ o executor — base da composicao de C7C. */
const transactionClientIsExecutor: (tx: InteractiveTransactionClient) => PrismaExecutor = (tx) =>
  tx;

/** (b) O client completo tambem satisfaz — o mesmo adapter serve os dois escopos. */
const fullClientIsExecutor: (prisma: PrismaClient) => PrismaExecutor = (prisma) => prisma;

/**
 * (c) O executor NAO expoe ciclo de vida. `HasMember` resolve para `false`, e so
 * um `false` e atribuivel a `false`: se `$connect`/`$disconnect` voltassem ao
 * tipo, estas linhas parariam de compilar. E uma trava estrutural, nao textual —
 * indirecao nenhuma a contorna.
 */
type HasMember<T, K extends string> = K extends keyof T ? true : false;
const executorHasNoConnect: HasMember<PrismaExecutor, "$connect"> = false;
const executorHasNoDisconnect: HasMember<PrismaExecutor, "$disconnect"> = false;
const executorHasNoTransaction: HasMember<PrismaExecutor, "$transaction"> = false;
/** Controle positivo: o `Pick` de fato manteve as delegacoes que usamos. */
const executorHasUser: HasMember<PrismaExecutor, "user"> = true;

describe("provas de tipo (compiladas, nao executadas)", () => {
  it("(1) as afirmacoes de tipo existem e estao coerentes", () => {
    expect(typeof transactionClientIsExecutor).toBe("function");
    expect(typeof fullClientIsExecutor).toBe("function");
    expect([
      executorHasNoConnect,
      executorHasNoDisconnect,
      executorHasNoTransaction,
      executorHasUser,
    ]).toEqual([false, false, false, true]);
  });
});

describe("injecao do executor", () => {
  it("(1) os stores usam SO as duas delegacoes recebidas — nao criam client", async () => {
    // O fake nao expoe `$connect`, `$disconnect` nem `$transaction`; se o
    // adapter tentasse usa-los, a chamada explodiria aqui. A garantia primaria,
    // porem, e do TIPO: `PrismaExecutor` e um `Pick` de duas delegacoes, entao
    // esses membros nem existem para serem chamados.
    const { executor, calls } = fakeExecutor({
      user: { findUnique: () => null },
      passwordCredential: { findUnique: () => null },
    });
    await createPrismaIdentityStore(executor).findByNormalizedEmail(SCOPE, "a@example.test");
    await createPrismaPasswordCredentialStore(executor).findForVerification(SCOPE, 1n);
    expect(calls.map((c) => c.method)).toEqual([
      "user.findUnique",
      "passwordCredential.findUnique",
    ]);
  });

  it("(2) o mesmo executor serve os dois stores (base da composicao transacional)", () => {
    const { executor } = fakeExecutor({});
    const identities = createPrismaIdentityStore(executor);
    const credentials = createPrismaPasswordCredentialStore(executor);
    expect(typeof identities.create).toBe("function");
    expect(typeof credentials.createInitial).toBe("function");
  });
});
