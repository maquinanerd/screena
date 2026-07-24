/**
 * Validador dos ADAPTERS e do RUNTIME de identidade/privacidade (Backend C,
 * C7D) contra PostgreSQL 16 REAL, efemero e descartavel.
 *
 * Por que um banco de verdade, e nao os dubles em memoria (que ja provam a
 * LOGICA): os pontos que decidem a corretude desta unidade so existem no
 * Postgres — o CHECK que amarra `status` e `deleted_at`, o TRIGGER append-only
 * de `user_auth_audit_logs`, o unique de `handle`, e o compare-and-swap de
 * status de conta e de pedido LGPD sob concorrencia. Um duble responde o que o
 * autor imaginou; o banco responde o que acontece.
 *
 * Cobre o FLUXO COMPLETO ponta a ponta com a composicao real de stores
 * (createFakeStores nao entra aqui): cadastro -> login -> perfil ->
 * consentimento -> exportacao -> encerramento -> anonimizacao, provando que a
 * exportacao NUNCA carrega segredo e que a tumba preserva a linha.
 *
 * Nada aqui toca banco de producao: sobe um PostgreSQL proprio numa porta livre,
 * aplica TODAS as migrations num database vazio e derruba tudo no fim.
 *
 * Uso: pnpm --filter @screena/user-platform validate:identity-privacy
 *
 * Todos os e-mails e hashes deste arquivo sao FICTICIOS.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

import { createPrismaAccountLifecycleStore } from "../src/persistence/prisma/index.js";
import { createFullAuthRuntimeForTest } from "./_identity-privacy-harness.js";
import type { TransactionScope } from "../src/persistence/types.js";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");

const SCOPE: TransactionScope = { transactional: true };

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.warn(`[cleanup] nao foi possivel remover ${dir} (deixado para o SO limpar).`);
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const runtime = createFullAuthRuntimeForTest(prisma);
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

  try {
    // -----------------------------------------------------------------------
    // CADASTRO — identidade + credencial + consentimentos + auditoria atomicos
    // -----------------------------------------------------------------------
    const ctx = { correlationId: "val-0001", clientIpHash: "a".repeat(64), userAgent: "validator" };
    const signupDto = await runtime.signup(
      {
        email: "Titular@Example.Test",
        emailNormalized: "titular@example.test",
        password: "senha-bem-longa-10",
        displayName: "Titular",
        acceptedTerms: true,
        acceptedMarketingEmail: true,
        acceptedAnalytics: false,
      },
      ctx,
    );
    await runtime.flush();
    record(1, "cadastro responde 202 generico", signupDto.status === "accepted", `status=${signupDto.status}`);

    const [userRow] = await q<{ id: bigint; email: string; email_verified_at: Date | null; status: string }>(
      `SELECT id, email, email_verified_at, status FROM "users" WHERE email_normalized = 'titular@example.test'`,
    );
    record(2, "identidade persistida com e-mail bruto", userRow?.email === "Titular@Example.Test", `email=${userRow?.email}`);
    const userId = userRow!.id;

    const [credRow] = await q<{ c: bigint }>(`SELECT count(*)::int AS c FROM "user_password_credentials" WHERE user_id = ${userId}`);
    record(3, "credencial inicial gravada (1:1)", Number(credRow!.c) === 1, `count=${credRow!.c}`);

    const consentRows = await q<{ kind: string; granted: boolean }>(
      `SELECT kind, granted FROM "user_consent_records" WHERE user_id = ${userId} ORDER BY kind`,
    );
    const marketing = consentRows.find((c) => c.kind === "marketing_email");
    const analytics = consentRows.find((c) => c.kind === "analytics");
    record(
      4,
      "4 consentimentos gravados, inclusive o 'nao' explicito de analytics",
      consentRows.length === 4 && marketing?.granted === true && analytics?.granted === false,
      `count=${consentRows.length} marketing=${marketing?.granted} analytics=${analytics?.granted}`,
    );

    const [auditSignup] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_auth_audit_logs" WHERE user_id = ${userId} AND action = 'signup'`,
    );
    record(5, "auditoria de cadastro append-only gravada", Number(auditSignup!.c) === 1, `count=${auditSignup!.c}`);

    // -----------------------------------------------------------------------
    // CADASTRO DUPLICADO — anti-enumeracao, sem escrita nova
    // -----------------------------------------------------------------------
    const consentAntes = consentRows.length;
    const dupDto = await runtime.signup(
      {
        email: "titular@example.test",
        emailNormalized: "titular@example.test",
        password: "outra-senha-longa-1",
        displayName: null,
        acceptedTerms: true,
        acceptedMarketingEmail: false,
        acceptedAnalytics: false,
      },
      ctx,
    );
    await runtime.flush();
    const [consentDepois] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_consent_records" WHERE user_id = ${userId}`,
    );
    record(
      6,
      "cadastro de e-mail existente: resposta identica e ZERO escrita nova",
      dupDto.status === "accepted" && Number(consentDepois!.c) === consentAntes,
      `status=${dupDto.status} consents=${consentDepois!.c}`,
    );

    // -----------------------------------------------------------------------
    // LOGIN — sessao real, com csrfTokenHash persistido
    // -----------------------------------------------------------------------
    const loginRes = await runtime.login(
      { emailNormalized: "titular@example.test", password: "senha-bem-longa-10" },
      ctx,
    );
    record(7, "login estabelece sessao", loginRes.sessionDelivery !== null, `reason=${loginRes.internalReason}`);
    const sessionToken = loginRes.sessionDelivery!.rawSessionToken;

    const [sessRow] = await q<{ csrf_token_hash: string; token_hash: string }>(
      `SELECT csrf_token_hash, token_hash FROM "user_sessions" WHERE user_id = ${userId} AND revoked_at IS NULL`,
    );
    record(
      8,
      "sessao guarda hash de sessao E hash de CSRF (nunca o token cru)",
      /^[0-9a-f]{64}$/.test(sessRow!.csrf_token_hash) && sessRow!.token_hash !== sessionToken,
      `csrf=${sessRow!.csrf_token_hash.slice(0, 8)}...`,
    );

    const authCtx = await runtime.resolveAuthenticatedContext(sessionToken);
    record(9, "sessao resolve o contexto autenticado", authCtx !== null, `userId=${authCtx?.userId}`);

    // -----------------------------------------------------------------------
    // LOGIN ERRADO — mesma resposta, sem sessao
    // -----------------------------------------------------------------------
    const loginBad = await runtime.login(
      { emailNormalized: "titular@example.test", password: "errada" },
      ctx,
    );
    record(10, "login com senha errada NAO cria sessao", loginBad.sessionDelivery === null, `reason=${loginBad.internalReason}`);

    // -----------------------------------------------------------------------
    // PERFIL — upsert com handle unico
    // -----------------------------------------------------------------------
    const profRes = await runtime.updateProfile(
      authCtx!,
      {
        displayName: "Titular Publico",
        handle: "titular",
        bio: "bio de teste",
        locale: "pt-BR",
        countryCode: "BR",
        timezone: "America/Sao_Paulo",
        visibility: "public",
      },
      ctx,
    );
    record(11, "perfil salvo", profRes.ok, `ok=${profRes.ok}`);

    const [handleRow] = await q<{ handle: string | null; display_name: string | null }>(
      `SELECT handle, display_name FROM "users" WHERE id = ${userId}`,
    );
    record(
      12,
      "handle e display_name gravados em users (nao so em user_profiles)",
      handleRow!.handle === "titular" && handleRow!.display_name === "Titular Publico",
      `handle=${handleRow!.handle}`,
    );

    // -----------------------------------------------------------------------
    // CONSENTIMENTO — retirada com efeito real
    // -----------------------------------------------------------------------
    await runtime.setConsent(authCtx!, { kind: "analytics", granted: true }, ctx);
    const ativoAntes = await runtime.hasActiveConsent(userId, "analytics");
    await runtime.setConsent(authCtx!, { kind: "analytics", granted: false }, ctx);
    const ativoDepois = await runtime.hasActiveConsent(userId, "analytics");
    record(
      13,
      "retirada de consentimento tem efeito REAL e imediato (append-only)",
      ativoAntes === true && ativoDepois === false,
      `antes=${ativoAntes} depois=${ativoDepois}`,
    );

    // -----------------------------------------------------------------------
    // EXPORTACAO — sem segredo, so dados do titular
    // -----------------------------------------------------------------------
    const exportRes = await runtime.requestDataExport(authCtx!, ctx);
    record(14, "exportacao gerada", exportRes.ok, `ok=${exportRes.ok}`);
    if (exportRes.ok) {
      const json = JSON.stringify(exportRes.value);
      const semSegredo = !/passwordHash|csrfTokenHash|tokenHash|ip_?hash|"secret"/i.test(json);
      record(15, "exportacao NUNCA contem segredo/hash/token", semSegredo, semSegredo ? "sem segredo" : "VAZOU");
      record(
        16,
        "exportacao carrega dados do titular (conta + consentimentos)",
        String(exportRes.value.account.email).toLowerCase() === "titular@example.test" &&
          exportRes.value.consents.length > 0,
        `email=${exportRes.value.account.email} consents=${exportRes.value.consents.length}`,
      );
    }
    const [reqRow] = await q<{ status: string; kind: string }>(
      `SELECT status, kind FROM "user_data_requests" WHERE user_id = ${userId} AND kind = 'export'`,
    );
    record(17, "pedido de exportacao registrado e concluido", reqRow?.status === "completed", `status=${reqRow?.status}`);

    // -----------------------------------------------------------------------
    // TROCA DE SENHA AUTENTICADA — revoga todas as sessoes
    // -----------------------------------------------------------------------
    const authCtx2 = (await runtime.resolveAuthenticatedContext(sessionToken))!;
    const changeRes = await runtime.changePassword(
      authCtx2,
      { currentPassword: "senha-bem-longa-10", newPassword: "nova-senha-longa-1" },
      ctx,
    );
    record(18, "troca de senha autenticada aceita", changeRes.ok, `ok=${changeRes.ok}`);
    const aposTroca = await runtime.resolveAuthenticatedContext(sessionToken);
    record(19, "troca de senha REVOGA a sessao corrente", aposTroca === null, `sessao=${aposTroca === null ? "revogada" : "viva"}`);

    // Re-login com a nova senha para os proximos passos.
    const relogin = await runtime.login(
      { emailNormalized: "titular@example.test", password: "nova-senha-longa-1" },
      ctx,
    );
    record(20, "login com a NOVA senha funciona", relogin.sessionDelivery !== null, `reason=${relogin.internalReason}`);
    const authCtx3 = (await runtime.resolveAuthenticatedContext(relogin.sessionDelivery!.rawSessionToken))!;

    // -----------------------------------------------------------------------
    // ENCERRAMENTO — reautentica, revoga tudo, vai a pending_deletion
    // -----------------------------------------------------------------------
    const closeRes = await runtime.requestAccountClosure(authCtx3, { password: "nova-senha-longa-1" }, ctx);
    record(21, "encerramento aceito com reautenticacao", closeRes.ok, `ok=${closeRes.ok}`);

    const [statusRow] = await q<{ status: string; deleted_at: Date | null }>(
      `SELECT status, deleted_at FROM "users" WHERE id = ${userId}`,
    );
    record(
      22,
      "conta em pending_deletion com deleted_at coerente (CHECK do schema)",
      statusRow!.status === "pending_deletion" && statusRow!.deleted_at !== null,
      `status=${statusRow!.status} deleted_at=${statusRow!.deleted_at !== null}`,
    );

    const aposClose = await runtime.resolveAuthenticatedContext(relogin.sessionDelivery!.rawSessionToken);
    record(23, "encerramento revoga todas as sessoes", aposClose === null, `sessao=${aposClose === null ? "revogada" : "viva"}`);

    // -----------------------------------------------------------------------
    // ANONIMIZACAO — tumba: linha permanece, PII some
    // -----------------------------------------------------------------------
    const anonRes = await runtime.anonymizeAccount(userId, "operador-humano@cinerie");
    record(24, "anonimizacao aplicada", anonRes.ok, `ok=${anonRes.ok}`);

    const [tumba] = await q<{ id: bigint; email: string; handle: string | null; display_name: string | null; status: string }>(
      `SELECT id, email, handle, display_name, status FROM "users" WHERE id = ${userId}`,
    );
    record(
      25,
      "TUMBA: a linha permanece, e-mail anonimizado, handle/nome nulos, status deleted",
      tumba !== undefined &&
        tumba.email.includes("anonymized.invalid") &&
        tumba.handle === null &&
        tumba.display_name === null &&
        tumba.status === "deleted",
      `email=${tumba?.email} handle=${tumba?.handle} status=${tumba?.status}`,
    );

    const [consentSobrevive] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_consent_records" WHERE user_id = ${userId}`,
    );
    record(
      26,
      "prova de consentimento SOBREVIVE a anonimizacao (retencao LGPD)",
      Number(consentSobrevive!.c) > 0,
      `consents=${consentSobrevive!.c}`,
    );

    // -----------------------------------------------------------------------
    // TRIGGER append-only — UPDATE em auditoria e recusado pelo banco
    // -----------------------------------------------------------------------
    let auditImutavel = false;
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "user_auth_audit_logs" SET action = 'login_succeeded' WHERE user_id = ${userId}`,
      );
    } catch {
      auditImutavel = true;
    }
    record(27, "user_auth_audit_logs e append-only por TRIGGER (UPDATE recusado)", auditImutavel, `imutavel=${auditImutavel}`);

    // -----------------------------------------------------------------------
    // CONCORRENCIA — CAS de status elege exatamente um vencedor
    // -----------------------------------------------------------------------
    const alvo = await runtime.signupAndActivate(
      { email: "corrida@example.test", emailNormalized: "corrida@example.test", password: "senha-bem-longa-10" },
    );
    const lifecycle = createPrismaAccountLifecycleStore(prisma);
    const disputa = await Promise.all(
      [0, 1].map(async () =>
        prisma.$transaction(async (tx) =>
          createPrismaAccountLifecycleStore(tx).transitionStatus(SCOPE, {
            userId: alvo,
            expectedStatus: "active",
            nextStatus: "pending_deletion",
            deletedAt: new Date("2026-07-24T00:00:00Z"),
          }),
        ),
      ),
    );
    const vencedores = disputa.filter((r) => r.kind === "updated").length;
    record(
      28,
      "CAS de status de conta: sob concorrencia real elege EXATAMENTE um vencedor",
      vencedores === 1,
      `vencedores=${vencedores} kinds=${disputa.map((r) => r.kind).join(",")}`,
    );
    void lifecycle;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-c7d-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  console.log(
    `\n=== C7D — adapters e runtime de identidade/privacidade | Postgres 16 efemero :${port} (postgres:****) ===\n`,
  );

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("c7d");
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/c7d?schema=public`;

    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
      cwd: dbDir,
    });
    record(0, "todas as migrations aplicam em banco vazio", true, "migrate deploy ok");

    await runChecks(url);
  } catch (e) {
    record(99, "execucao", false, (e as Error).message.split("\n")[0] ?? "erro");
  } finally {
    if (started) {
      try {
        await pg.stop();
      } catch (e) {
        console.warn(`[cleanup] pg.stop: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado e dir temporario removido ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Identidade e privacidade validadas em PostgreSQL 16 real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
