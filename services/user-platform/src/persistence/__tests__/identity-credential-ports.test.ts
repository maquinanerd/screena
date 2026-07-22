/**
 * Testes de CONTRATO dos ports de identidade e credencial (C7B0).
 *
 * Provam que os contratos sao IMPLEMENTAVEIS e que servem aos fluxos REAIS: os
 * fakes abaixo sao ligados a `decideSignup`, `decideLogin` e
 * `authenticatePassword` de verdade (auth/), nao a copias. Se um port nao
 * bastasse para alimentar o fluxo, estes testes nao compilariam/passariam.
 *
 * Os fakes vivem SO aqui: nao sao implementacao de producao, nao usam Prisma e
 * nao inventam politica. Servem de prova de implementabilidade.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authenticatePassword } from "../../auth/credentials.js";
import { decideLogin, decideSignup } from "../../auth/flows.js";
import { evaluateSessionAccess } from "../../auth/sessions.js";
import {
  applyEmailVerification,
  evaluateVerificationResend,
} from "../../auth/verification.js";
import type { IdentityStore, PasswordCredentialStore } from "../ports.js";
import type {
  CredentialCreateInput,
  EmailVerificationInput,
  CredentialReplaceInput,
  CredentialVerificationMaterial,
  IdentityRecord,
  PersistenceConflict,
  TransactionScope,
} from "../types.js";


/** Le o alvo SO quando a razao o autoriza — prova o acoplamento do contrato. */
function uniqueTarget(conflict: PersistenceConflict): string | undefined {
  return conflict.reason === "unique_violation" ? conflict.target : undefined;
}
function preimageTarget(conflict: PersistenceConflict): string | undefined {
  return conflict.reason === "stale_preimage" ? conflict.target : undefined;
}

const SCOPE: TransactionScope = { transactional: true };
const OK_PASSWORD = { ok: true, errors: [] as string[] };

/** Fake em memoria do IdentityStore. Classifica conflito por alvo semantico. */
function fakeIdentityStore(): IdentityStore {
  const rows: {
    id: bigint;
    email: string;
    emailNormalized: string;
    status: "active";
    emailVerifiedAt: Date | null;
  }[] = [];
  let nextId = 1n;
  return {
    async create(_scope, input) {
      // Ordem determinista: e-mail bruto, depois normalizado (uniques reais).
      for (const row of rows) {
        if (row.email === input.email) {
          return { kind: "conflict", conflict: { reason: "unique_violation", target: "identity.email" } };
        }
        if (row.emailNormalized === input.emailNormalized) {
          return {
            kind: "conflict",
            conflict: { reason: "unique_violation", target: "identity.emailNormalized" },
          };
        }
      }
      const id = nextId;
      nextId += 1n;
      rows.push({
        id,
        email: input.email,
        emailNormalized: input.emailNormalized,
        status: "active",
        emailVerifiedAt: null,
      });
      return {
        kind: "created",
        identity: { id, status: "active" },
      };
    },
    async findByNormalizedEmail(_scope, emailNormalized) {
      const row = rows.find((r) => r.emailNormalized === emailNormalized);
      if (row === undefined) return { kind: "not_found" };
      return {
        kind: "found",
        identity: { id: row.id, status: row.status },
      };
    },
    async findById(_scope, userId) {
      // Mesmo shape da busca por e-mail: os dois consumidores precisam de
      // `{ id, status }`. Sem filtro de status — quem decide e o dominio.
      const row = rows.find((r) => r.id === userId);
      if (row === undefined) return { kind: "not_found" };
      return {
        kind: "found",
        identity: { id: row.id, status: row.status },
      };
    },
    async markEmailVerified(_scope, input) {
      const row = rows.find((r) => r.id === input.userId);
      if (row === undefined) return { kind: "not_found" };
      if (row.emailVerifiedAt !== null) return { kind: "already_verified" };
      row.emailVerifiedAt = input.now;
      return { kind: "verified" };
    },
    async findEmailVerificationStateByNormalizedEmail(_scope, emailNormalized) {
      // Devolve o FATO (carimbo), nunca `alreadyVerified` — a derivacao e do
      // dominio. Sem filtro de status: a persistencia entrega o estado.
      const row = rows.find((r) => r.emailNormalized === emailNormalized);
      if (row === undefined) return { kind: "not_found" };
      return {
        kind: "found",
        state: { userId: row.id, emailVerifiedAt: row.emailVerifiedAt, status: row.status },
      };
    },
  };
}

/** Fake em memoria do PasswordCredentialStore (1:1, sem historico). */
function fakeCredentialStore(knownUserIds: () => readonly bigint[]): PasswordCredentialStore {
  const rows = new Map<string, CredentialVerificationMaterial>();
  return {
    async createInitial(_scope, input) {
      if (!knownUserIds().includes(input.userId)) return { kind: "user_not_found" };
      const key = input.userId.toString();
      if (rows.has(key)) {
        return {
          kind: "already_exists",
          conflict: { reason: "unique_violation", target: "credential.user" },
        };
      }
      rows.set(key, { passwordHash: input.passwordHash });
      return { kind: "created" };
    },
    async findForVerification(_scope, userId) {
      const material = rows.get(userId.toString());
      if (material === undefined) return { kind: "not_found" };
      return { kind: "found", material };
    },
    async replaceByPreimage(_scope, input) {
      const key = input.userId.toString();
      const current = rows.get(key);
      if (current === undefined) return { kind: "not_found" };
      if (current.passwordHash !== input.expectedPasswordHash) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "credential.passwordHash" },
        };
      }
      rows.set(key, { passwordHash: input.nextPasswordHash });
      return { kind: "updated" };
    },
  };
}

describe("C7B0 — port de identidade serve os fluxos reais", () => {
  it("(1) cadastro: findByNormalizedEmail alimenta decideSignup e create devolve a identidade", async () => {
    const identity = fakeIdentityStore();
    const lookup = await identity.findByNormalizedEmail(SCOPE, "ana@example.test");
    const decision = decideSignup({
      emailNormalized: "ana@example.test",
      emailAlreadyRegistered: lookup.kind === "found",
      passwordValidation: OK_PASSWORD,
    });
    expect(decision.ok && decision.value.action).toBe("create_user");

    const created = await identity.create(SCOPE, {
      email: "Ana@Example.test",
      emailNormalized: "ana@example.test",
      displayName: "Ana",
    });
    expect(created.kind).toBe("created");
    if (created.kind === "created") expect(created.identity.id).toBeGreaterThan(0n);
  });

  it("(2) e-mail ja registrado vira notice_existing_email (nao erro)", async () => {
    const identity = fakeIdentityStore();
    await identity.create(SCOPE, {
      email: "ana@example.test",
      emailNormalized: "ana@example.test",
      displayName: null,
    });
    const lookup = await identity.findByNormalizedEmail(SCOPE, "ana@example.test");
    const decision = decideSignup({
      emailNormalized: "ana@example.test",
      emailAlreadyRegistered: lookup.kind === "found",
      passwordValidation: OK_PASSWORD,
    });
    expect(decision.ok && decision.value.action).toBe("notice_existing_email");
  });

  it("(3) conflito distingue e-mail BRUTO de e-mail NORMALIZADO", async () => {
    const identity = fakeIdentityStore();
    await identity.create(SCOPE, {
      email: "ana@example.test",
      emailNormalized: "ana@example.test",
      displayName: null,
    });

    const sameRaw = await identity.create(SCOPE, {
      email: "ana@example.test",
      emailNormalized: "outro@example.test",
      displayName: null,
    });
    expect(sameRaw.kind === "conflict" && uniqueTarget(sameRaw.conflict)).toBe("identity.email");

    const sameNormalized = await identity.create(SCOPE, {
      email: "ANA@example.test",
      emailNormalized: "ana@example.test",
      displayName: null,
    });
    expect(sameNormalized.kind === "conflict" && uniqueTarget(sameNormalized.conflict)).toBe(
      "identity.emailNormalized",
    );
  });

  it("(4) a taxonomia representa os 3 uniques de identidade, lendo a UNIAO REAL", () => {
    // Falsificavel: le a fonte de types.ts. Remover um alvo da uniao reprova.
    // (A versao anterior serializava um literal escrito pelo proprio teste e
    // nenhuma mudanca nos contratos podia reprova-la.)
    const source = readFileSync(
      path.join(process.cwd(), "services", "user-platform", "src", "persistence", "types.ts"),
      "utf8",
    );
    const union = source.slice(
      source.indexOf("export type UniqueConflictTarget"),
      source.indexOf("export type PreimageConflictTarget"),
    );
    expect(union).toContain('"identity.email"');
    expect(union).toContain('"identity.emailNormalized"');
    expect(union).toContain('"identity.handle"');
    expect(union).toContain('"credential.user"');
    // Nenhum nome de constraint/indice/tabela vaza pela taxonomia.
    expect(union).not.toMatch(/users_|_key\b|constraint|pg_|sql/i);

    // Ligacao de TIPO: se `identity.handle` sair da uniao, isto nao compila.
    const handleConflict: PersistenceConflict = {
      reason: "unique_violation",
      target: "identity.handle",
    };
    expect(handleConflict.target).toBe("identity.handle");
  });

  it("(5) login: o port alimenta decideLogin (existencia + status)", async () => {
    const identity = fakeIdentityStore();
    await identity.create(SCOPE, {
      email: "ana@example.test",
      emailNormalized: "ana@example.test",
      displayName: null,
    });
    const found = await identity.findByNormalizedEmail(SCOPE, "ana@example.test");
    const decision = decideLogin({
      throttleLocked: false,
      userExists: found.kind === "found",
      userStatus: found.kind === "found" ? found.identity.status : null,
      passwordMatches: true,
    });
    expect(decision.publicResult.ok).toBe(true);
    expect(decision.internalReason).toBe("ok");

    const missing = await identity.findByNormalizedEmail(SCOPE, "ninguem@example.test");
    expect(missing.kind).toBe("not_found");
    const denied = decideLogin({
      throttleLocked: false,
      userExists: missing.kind === "found",
      userStatus: null,
      passwordMatches: false,
    });
    expect(denied.publicResult.ok).toBe(false);
    expect(denied.internalReason).toBe("user_not_found");
  });

  it("(6) o registro de identidade NAO carrega hash nem algoritmo", async () => {
    const identity = fakeIdentityStore();
    const created = await identity.create(SCOPE, {
      email: "ana@example.test",
      emailNormalized: "ana@example.test",
      displayName: null,
    });
    expect(created.kind).toBe("created");
    if (created.kind === "created") {
      const record: IdentityRecord = created.identity;
      const keys = Object.keys(record);
      expect(keys.sort()).toEqual(["id", "status"]);
      const serialized = JSON.stringify(record, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      expect(serialized).not.toMatch(/hash|scrypt|algorithm|credential|@/i);
    }
  });
});

describe("C7B0 — port de credencial: hash opaco, 1:1 e compare-and-swap", () => {
  const HASH_A = "scrypt$N=32768,r=8,p=1$aaaa$bbbb";
  const HASH_B = "scrypt$N=32768,r=8,p=1$cccc$dddd";

  async function seeded() {
    const identity = fakeIdentityStore();
    const created = await identity.create(SCOPE, {
      email: "ana@example.test",
      emailNormalized: "ana@example.test",
      displayName: null,
    });
    const userId = created.kind === "created" ? created.identity.id : 0n;
    const credential = fakeCredentialStore(() => [userId]);
    return { identity, credential, userId };
  }

  it("(1) cadastro compoe os DOIS ports: identidade criada -> credencial inicial", async () => {
    const { credential, userId } = await seeded();
    const result = await credential.createInitial(SCOPE, {
      userId,
      passwordHash: HASH_A,
      algorithm: "scrypt",
    });
    expect(result.kind).toBe("created");
  });

  it("(2) credencial e 1:1 — a segunda criacao e already_exists (alvo credential.user)", async () => {
    const { credential, userId } = await seeded();
    await credential.createInitial(SCOPE, { userId, passwordHash: HASH_A, algorithm: "scrypt" });
    const again = await credential.createInitial(SCOPE, {
      userId,
      passwordHash: HASH_B,
      algorithm: "scrypt",
    });
    expect(again.kind).toBe("already_exists");
    if (again.kind === "already_exists") expect(uniqueTarget(again.conflict)).toBe("credential.user");
  });

  it("(3) usuario inexistente e distinguivel (FK)", async () => {
    const { credential } = await seeded();
    const result = await credential.createInitial(SCOPE, {
      userId: 9999n,
      passwordHash: HASH_A,
      algorithm: "scrypt",
    });
    expect(result.kind).toBe("user_not_found");
  });

  it("(4) findForVerification e o UNICO a devolver hash, e alimenta authenticatePassword real", async () => {
    const { credential, userId } = await seeded();
    await credential.createInitial(SCOPE, { userId, passwordHash: HASH_A, algorithm: "scrypt" });

    const found = await credential.findForVerification(SCOPE, userId);
    expect(found.kind).toBe("found");
    if (found.kind === "found") {
      // Porta de verificacao REAL do dominio; o port so entrega o material.
      const matched = authenticatePassword({
        password: "qualquer",
        storedHash: found.material.passwordHash,
        verify: (password, storedHash) => storedHash === HASH_A && password === "qualquer",
      });
      expect(matched).toBe(true);
    }

    const missing = await credential.findForVerification(SCOPE, 4242n);
    expect(missing.kind).toBe("not_found");
  });

  it("(5) credencial ausente => authenticatePassword false (sem distincao publica)", async () => {
    const { credential, userId } = await seeded();
    const lookup = await credential.findForVerification(SCOPE, userId);
    const storedHash = lookup.kind === "found" ? lookup.material.passwordHash : null;
    expect(
      authenticatePassword({ password: "x", storedHash, verify: () => true }),
    ).toBe(false);
  });

  it("(6) CAS: pre-imagem correta atualiza; divergente vira conflict (sem last-write-wins)", async () => {
    const { credential, userId } = await seeded();
    await credential.createInitial(SCOPE, { userId, passwordHash: HASH_A, algorithm: "scrypt" });

    const stale = await credential.replaceByPreimage(SCOPE, {
      userId,
      expectedPasswordHash: "scrypt$N=32768,r=8,p=1$zzzz$zzzz",
      nextPasswordHash: HASH_B,
      nextAlgorithm: "scrypt",
    });
    expect(stale.kind).toBe("conflict");
    if (stale.kind === "conflict") {
      expect(stale.conflict.reason).toBe("stale_preimage");
      expect(preimageTarget(stale.conflict)).toBe("credential.passwordHash");
      // Acoplamento: o alvo de pre-imagem NAO e legivel como alvo de unicidade.
      expect(uniqueTarget(stale.conflict)).toBeUndefined();
    }
    // A escrita divergente NAO pode ter alterado nada.
    const afterStale = await credential.findForVerification(SCOPE, userId);
    expect(afterStale.kind === "found" && afterStale.material.passwordHash).toBe(HASH_A);

    const okSwap = await credential.replaceByPreimage(SCOPE, {
      userId,
      expectedPasswordHash: HASH_A,
      nextPasswordHash: HASH_B,
      nextAlgorithm: "scrypt",
    });
    expect(okSwap.kind).toBe("updated");
    const afterSwap = await credential.findForVerification(SCOPE, userId);
    expect(afterSwap.kind === "found" && afterSwap.material.passwordHash).toBe(HASH_B);
  });

  it("(7) replace sem credencial e not_found (distinto de conflict)", async () => {
    const { credential, userId } = await seeded();
    const result = await credential.replaceByPreimage(SCOPE, {
      userId,
      expectedPasswordHash: HASH_A,
      nextPasswordHash: HASH_B,
      nextAlgorithm: "scrypt",
    });
    expect(result.kind).toBe("not_found");
  });

  it("(8) nenhuma entrada do port aceita senha em texto claro", async () => {
    const { credential, userId } = await seeded();
    // Literais TIPADOS e efetivamente passados ao port: o excess-property check
    // do TypeScript liga o teste ao contrato. Se alguem acrescentar
    // `plainPassword` a CredentialCreateInput, a chave aparece aqui e reprova.
    // (A versao anterior montava objetos soltos, desligados dos tipos.)
    const createInput: CredentialCreateInput = {
      userId,
      passwordHash: HASH_A,
      algorithm: "scrypt",
    };
    const replaceInput: CredentialReplaceInput = {
      userId,
      expectedPasswordHash: HASH_A,
      nextPasswordHash: HASH_B,
      nextAlgorithm: "scrypt",
    };
    expect((await credential.createInitial(SCOPE, createInput)).kind).toBe("created");
    expect((await credential.replaceByPreimage(SCOPE, replaceInput)).kind).toBe("updated");

    for (const key of [...Object.keys(createInput), ...Object.keys(replaceInput)]) {
      expect(key, `campo suspeito: ${key}`).not.toMatch(/password$/i);
    }
  });
});

describe("C7B2.1 — identidade fecha autenticacao por sessao e verificacao", () => {
  const SCOPE: TransactionScope = { transactional: true };
  const AGORA = new Date("2026-07-22T12:00:00.000Z");

  async function comUsuario(): Promise<{ store: IdentityStore; userId: bigint }> {
    const store = fakeIdentityStore();
    const criado = await store.create(SCOPE, {
      email: "c7b21@example.test",
      emailNormalized: "c7b21@example.test",
      displayName: null,
    });
    if (criado.kind !== "created") throw new Error("setup falhou");
    return { store, userId: criado.identity.id };
  }

  it("(1) findById alimenta evaluateSessionAccess — a composicao FECHA", async () => {
    // Este e o gap que o C7B2 registrou: `SessionAccessRecord.userId` existia
    // para chegar ao status, e nenhum metodo o obtinha por id.
    const { store, userId } = await comUsuario();
    const lookup = await store.findById(SCOPE, userId);
    const status = lookup.kind === "found" ? lookup.identity.status : null;

    const acesso = evaluateSessionAccess({
      now: AGORA,
      session: { expiresAt: new Date(AGORA.getTime() + 60_000), revokedAt: null },
      userStatus: status,
    });
    expect(acesso.publicResult.ok).toBe(true);
  });

  it("(2) usuario ausente => status null => fail-closed", async () => {
    const { store } = await comUsuario();
    const lookup = await store.findById(SCOPE, 999n);
    expect(lookup.kind).toBe("not_found");
    const status = lookup.kind === "found" ? lookup.identity.status : null;
    const acesso = evaluateSessionAccess({
      now: AGORA,
      session: { expiresAt: new Date(AGORA.getTime() + 60_000), revokedAt: null },
      userStatus: status,
    });
    expect(acesso.publicResult.ok).toBe(false);
    expect(acesso.internalReason).toBe("account_ineligible");
  });

  it("(3) o registro de findById nao carrega segredo nem PII", async () => {
    const { store, userId } = await comUsuario();
    const lookup = await store.findById(SCOPE, userId);
    expect(lookup.kind).toBe("found");
    if (lookup.kind !== "found") return;
    expect(Object.keys(lookup.identity).sort()).toEqual(["id", "status"]);
    const serializado = JSON.stringify(lookup.identity, (_k, v) =>
      typeof v === "bigint" ? "0" : v,
    );
    expect(serializado).not.toMatch(/hash|token|@|verified/i);
  });

  it("(4) markEmailVerified concorda com applyEmailVerification", async () => {
    // A taxonomia do port nao foi inventada: `verified`/`already_verified` sao
    // exatamente o `changed` do dominio, com o carimbo original preservado.
    const { store, userId } = await comUsuario();

    const primeira = await store.markEmailVerified(SCOPE, { userId, now: AGORA });
    expect(primeira.kind).toBe("verified");
    const aplicadoPrimeiro = applyEmailVerification({
      now: AGORA,
      userStatus: "active",
      currentEmailVerifiedAt: null,
    });
    expect(aplicadoPrimeiro.internalReason).toBe("verified");

    const depois = new Date(AGORA.getTime() + 60_000);
    const segunda = await store.markEmailVerified(SCOPE, { userId, now: depois });
    expect(segunda.kind).toBe("already_verified");
    const aplicado = applyEmailVerification({
      now: depois,
      userStatus: "active",
      currentEmailVerifiedAt: AGORA,
    });
    expect(aplicado.internalReason).toBe("already_verified");
    expect(aplicado.publicResult.ok).toBe(true);
    if (!aplicado.publicResult.ok) return;
    expect(aplicado.publicResult.value.changed).toBe(false);
    // O carimbo preservado e o PRIMEIRO, nunca o novo.
    expect(aplicado.publicResult.value.emailVerifiedAt).toEqual(AGORA);
  });

  it("(5) marcar conta inexistente e not_found", async () => {
    const { store } = await comUsuario();
    const r = await store.markEmailVerified(SCOPE, { userId: 999n, now: AGORA });
    expect(r.kind).toBe("not_found");
  });

  it("(6) e-mail verificado NAO e entrada de decideLogin (login nao exige)", async () => {
    // Controle negativo de politica: se alguem acrescentar verificacao ao login,
    // este teste continua verde mas o de baixo (chave declarada) reprova.
    const decisao = decideLogin({
      throttleLocked: false,
      userExists: true,
      userStatus: "active",
      passwordMatches: true,
    });
    expect(decisao.publicResult.ok).toBe(true);

    const fonte = readFileSync(
      path.join(process.cwd(), "services", "user-platform", "src", "auth", "flows.ts"),
      "utf8",
    );
    const bloco = fonte.slice(
      fonte.indexOf("export function decideLogin"),
      fonte.indexOf("}", fonte.indexOf("export function decideLogin")),
    );
    expect(bloco).not.toMatch(/emailVerified|verificad/i);
  });

  it("(7) `now` e OBRIGATORIO na marcacao (tempo nunca vem do adapter)", () => {
    // Literal TIPADO: remover `now` do comando para de compilar. E a unica forma
    // de travar isso — em runtime, um `undefined` viraria uma data invalida.
    const comando: EmailVerificationInput = { userId: 1n, now: AGORA };
    expect(Object.keys(comando).sort()).toEqual(["now", "userId"]);
  });
});

describe("C7B2.2 — leitura do estado de verificacao alimenta o reenvio", () => {
  const SCOPE: TransactionScope = { transactional: true };
  const AGORA = new Date("2026-07-22T12:00:00.000Z");

  /** A derivacao que o CONSUMIDOR faz — nunca o adapter. */
  function decidirReenvio(
    lookup: Awaited<ReturnType<IdentityStore["findEmailVerificationStateByNormalizedEmail"]>>,
  ) {
    return evaluateVerificationResend({
      userExists: lookup.kind === "found",
      userStatus: lookup.kind === "found" ? lookup.state.status : null,
      alreadyVerified: lookup.kind === "found" && lookup.state.emailVerifiedAt !== null,
    });
  }

  async function comConta(): Promise<{ store: IdentityStore; userId: bigint }> {
    const store = fakeIdentityStore();
    const criado = await store.create(SCOPE, {
      email: "resend@example.test",
      emailNormalized: "resend@example.test",
      displayName: null,
    });
    if (criado.kind !== "created") throw new Error("setup falhou");
    return { store, userId: criado.identity.id };
  }

  it("(1) conta NAO verificada => issue_token, e o userId permite emitir", async () => {
    const { store, userId } = await comConta();
    const lookup = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "resend@example.test",
    );
    expect(lookup.kind).toBe("found");
    if (lookup.kind !== "found") return;
    // O `userId` existe porque `buildEmailVerificationIssue` precisa dele.
    expect(lookup.state.userId).toBe(userId);
    expect(decidirReenvio(lookup).internalReason).toBe("issue_token");
  });

  it("(2) conta JA verificada => already_verified (idempotente, nao reemite)", async () => {
    const { store, userId } = await comConta();
    await store.markEmailVerified(SCOPE, { userId, now: AGORA });
    const lookup = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "resend@example.test",
    );
    expect(lookup.kind === "found" && lookup.state.emailVerifiedAt).toEqual(AGORA);
    expect(decidirReenvio(lookup).internalReason).toBe("already_verified");
  });

  it("(3) e-mail inexistente => user_not_found INTERNO", async () => {
    const { store } = await comConta();
    const lookup = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "ninguem@example.test",
    );
    expect(lookup.kind).toBe("not_found");
    expect(decidirReenvio(lookup).internalReason).toBe("user_not_found");
  });

  it("(4) ANTI-ENUMERACAO: os tres casos dao a MESMA resposta publica", async () => {
    // Este e o ponto que a leitura nao pode quebrar. A persistencia distingue os
    // tres estados; a borda nao.
    const { store, userId } = await comConta();
    const naoVerificada = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "resend@example.test",
    );
    const inexistente = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "ninguem@example.test",
    );
    await store.markEmailVerified(SCOPE, { userId, now: AGORA });
    const jaVerificada = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "resend@example.test",
    );

    const publicos = [naoVerificada, inexistente, jaVerificada].map(
      (l) => decidirReenvio(l).publicResult,
    );
    expect(publicos.every((p) => p.ok)).toBe(true);
    // Serializados IDENTICOS: nada distingue os casos para quem esta fora.
    const serializados = publicos.map((p) => JSON.stringify(p));
    expect(new Set(serializados).size).toBe(1);

    // E os motivos INTERNOS sao, esses sim, distintos.
    const internos = [naoVerificada, inexistente, jaVerificada].map(
      (l) => decidirReenvio(l).internalReason,
    );
    expect(new Set(internos).size).toBe(3);
  });

  it("(5) o resultado carrega o FATO, nunca a politica nem PII", async () => {
    const { store } = await comConta();
    const lookup = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "resend@example.test",
    );
    expect(lookup.kind).toBe("found");
    if (lookup.kind !== "found") return;
    // Exatamente tres campos: sem `alreadyVerified` (politica), sem `email`.
    // `status` entrou quando ganhou consumidor real (`accountCanHoldSession`).
    expect(Object.keys(lookup.state).sort()).toEqual(["emailVerifiedAt", "status", "userId"]);
    const serializado = JSON.stringify(lookup.state, (_k, v) =>
      typeof v === "bigint" ? "0" : v,
    );
    expect(serializado).not.toMatch(/@|hash|token|alreadyVerified/i);
  });

  it("(6) o carimbo e um Date, nao um booleano (fato != decisao)", async () => {
    const { store, userId } = await comConta();
    await store.markEmailVerified(SCOPE, { userId, now: AGORA });
    const lookup = await store.findEmailVerificationStateByNormalizedEmail(
      SCOPE,
      "resend@example.test",
    );
    if (lookup.kind !== "found") throw new Error("esperava found");
    // Controle negativo do desenho: se o adapter tivesse devolvido
    // `alreadyVerified: boolean`, o QUANDO teria sido descartado e este
    // `toBeInstanceOf` reprovaria.
    expect(lookup.state.emailVerifiedAt).toBeInstanceOf(Date);
    expect(typeof lookup.state.emailVerifiedAt).not.toBe("boolean");
  });
});
