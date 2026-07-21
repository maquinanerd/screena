/**
 * validate-user-product-persistence-real-postgres.ts — validacao DESCARTAVEL da
 * fundacao de persistencia da user platform (Backend C, unidade C7A) em
 * PostgreSQL 16 REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO. Nunca roda no render, no build de app nem em
 * producao; nunca toca banco compartilhado/EasyPanel. Motor:
 * `embedded-postgres@16.14.0-beta.17` (PostgreSQL 16 real, portatil, EFEMERO),
 * derrubado e apagado no `finally`. Nenhum DATABASE_URL e persistido em disco.
 *
 * Tres cenarios:
 *  A) FRESH  — aplica TODAS as migrations num banco vazio e prova constraints,
 *              indices, idempotencia, concorrencia e cascata de
 *              user_recommendation_snapshots + user_recommendation_feedback
 *              e, desde C7A.1, a identidade dos eventos de tracking.
 *  B) UPGRADE— aplica as migrations ANTERIORES a C7A, insere uma linha legada de
 *              snapshot, aplica C7A por cima e prova preservacao do dado, o
 *              backfill correto e que os DEFAULTs temporarios foram REMOVIDOS.
 *  C) UPGRADE C7A.1 — aplica tudo menos C7A.1, REPRODUZ o bloqueador (evento
 *              irmao barrado pela UNIQUE antiga), aplica C7A.1 e prova que o
 *              irmao passa a ser aceito enquanto o replay do MESMO tipo
 *              continua barrado.
 *
 * Uso: pnpm --filter @screena/db db:validate:user-persistence
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(scriptDir, "..");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");
const migrationsDir = path.join(dbDir, "prisma", "migrations");

/** Migration de C7A: fronteira entre "estado anterior" e "upgrade". */
const C7A_DIR = "20260721120000_user_product_persistence_foundation";
/** Migration de C7A.1: amplia a identidade idempotente dos eventos de tracking. */
const C7A1_DIR = "20260721140000_tracking_event_idempotency_scope";

const OLD_TRACKING_UNIQUE = "user_viewing_events_user_id_idempotency_key_key";
const NEW_TRACKING_UNIQUE = "user_viewing_events_user_id_idempotency_key_event_type_key";

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
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
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

/**
 * Fixtures minimas: 3 usuarios + 3 entidades no registry. Uma instrucao POR
 * item — `$executeRawUnsafe` usa prepared statement e recusa multiplos comandos.
 */
const FIXTURES: readonly string[] = [
  `INSERT INTO "users" ("email","email_normalized","status","updated_at") VALUES ('c7a@example.test','c7a@example.test','active', now())`,
  `INSERT INTO "users" ("email","email_normalized","status","updated_at") VALUES ('c7b@example.test','c7b@example.test','active', now())`,
  // Terceiro usuario DEDICADO aos checks de tracking: o check 28 (cascata LGPD)
  // APAGA o usuario 2, entao reutiliza-lo depois falharia por FK.
  `INSERT INTO "users" ("email","email_normalized","status","updated_at") VALUES ('c7c@example.test','c7c@example.test','active', now())`,
  `INSERT INTO "entities" ("entity_type","entity_id") VALUES ('movie', 9001)`,
  `INSERT INTO "entities" ("entity_type","entity_id") VALUES ('tv', 9002)`,
  `INSERT INTO "entities" ("entity_type","entity_id") VALUES ('person', 9003)`,
];

async function seedFixtures(run: (sql: string) => Promise<unknown>): Promise<void> {
  for (const sql of FIXTURES) {
    await run(sql);
  }
}

const SNAP = "user_recommendation_snapshots";
const FB = "user_recommendation_feedback";

async function runFreshChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);

  async function expectViolation(n: number, name: string, sql: string): Promise<void> {
    try {
      await exec(sql);
      record(n, name, false, "operacao PROIBIDA foi ACEITA (constraint nao barrou)");
    } catch (e) {
      record(n, name, true, `barrado: ${(e as Error).message.split("\n")[0].slice(0, 80)}`);
    }
  }
  async function expectOk(n: number, name: string, sql: string): Promise<void> {
    try {
      await exec(sql);
      record(n, name, true, "aceito");
    } catch (e) {
      record(n, name, false, `rejeitado: ${(e as Error).message.split("\n")[0].slice(0, 80)}`);
    }
  }

  try {
    await seedFixtures(exec);
    const [u1] = await q<{ id: bigint }>(
      `SELECT id FROM users WHERE email_normalized='c7a@example.test'`,
    );
    const [u2] = await q<{ id: bigint }>(
      `SELECT id FROM users WHERE email_normalized='c7b@example.test'`,
    );
    const U1 = Number(u1!.id);
    const U2 = Number(u2!.id);
    record(1, "fixtures (3 usuarios + 3 entidades) criadas", true, `u1=${U1} u2=${U2}`);

    const snapCols = `("user_id","context","algorithm_version","policy_version","fingerprint","generated_at","expires_at","items","is_current")`;

    // ---------------- SNAPSHOT ----------------
    await expectOk(
      2,
      "snapshot valido e inserido",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'discovery','reco-v1','reco-v1','fp-a', now(), now() + interval '1 day', '{"items":[]}'::jsonb, true)`,
    );

    await expectViolation(
      3,
      "policy_version e OBRIGATORIO (NOT NULL)",
      `INSERT INTO "${SNAP}" ("user_id","context","algorithm_version","generated_at","items") VALUES (${U1},'rewatch','reco-v1', now(), '{}'::jsonb)`,
    );

    await expectViolation(
      4,
      "policy_version em branco e barrado (CHECK)",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'rewatch','reco-v1','   ','fp-x', now(), NULL, '{}'::jsonb, false)`,
    );

    await expectViolation(
      5,
      "fingerprint em branco e barrado (CHECK)",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'rewatch','reco-v1','reco-v1','  ', now(), NULL, '{}'::jsonb, false)`,
    );

    await expectOk(
      6,
      "fingerprint NULL e permitido (snapshot legado)",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'rewatch','reco-v1','reco-v1',NULL, now(), NULL, '{}'::jsonb, false)`,
    );

    await expectViolation(
      7,
      "expires_at ANTERIOR a generated_at e barrado (CHECK)",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'similar','reco-v1','reco-v1','fp-y', now(), now() - interval '1 hour', '{}'::jsonb, false)`,
    );

    // Vigente por (user, CONTEXTO) — o coracao do G4.
    await expectViolation(
      8,
      "dois VIGENTES no MESMO (user, context) sao barrados",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'discovery','reco-v1','reco-v1','fp-b', now(), NULL, '{}'::jsonb, true)`,
    );

    await expectOk(
      9,
      "vigentes em CONTEXTOS DIFERENTES coexistem (G4 corrigido)",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'continue_watching','reco-v1','reco-v1','fp-c', now(), NULL, '{}'::jsonb, true)`,
    );

    await expectOk(
      10,
      "historico (is_current=false) coexiste com o vigente",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'discovery','reco-v1','reco-v1','fp-a', now(), NULL, '{}'::jsonb, false)`,
    );

    await expectOk(
      11,
      "fingerprint REPETIDO no historico nao viola constraint",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U1},'discovery','reco-v1','reco-v1','fp-a', now(), NULL, '{}'::jsonb, false)`,
    );

    await expectViolation(
      12,
      "snapshot de usuario inexistente e barrado (FK)",
      `INSERT INTO "${SNAP}" ${snapCols} VALUES (999999,'discovery','reco-v1','reco-v1','fp-z', now(), NULL, '{}'::jsonb, false)`,
    );

    // Concorrencia real: 2 inserts simultaneos disputando o mesmo vigente.
    const races = await Promise.allSettled([
      exec(
        `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U2},'discovery','reco-v1','reco-v1','fp-r1', now(), NULL, '{}'::jsonb, true)`,
      ),
      exec(
        `INSERT INTO "${SNAP}" ${snapCols} VALUES (${U2},'discovery','reco-v1','reco-v1','fp-r2', now(), NULL, '{}'::jsonb, true)`,
      ),
    ]);
    const won = races.filter((r) => r.status === "fulfilled").length;
    record(13, "concorrencia: so 1 de 2 vigentes concorrentes sobrevive", won === 1, `aceitos=${won}`);

    // Indices PARCIAIS nao sao representaveis no Prisma, logo o check de drift
    // (37) nao os cobre: eles precisam de assercao por CATALOGO. Inspecionar o
    // PLANO de execucao NAO serve — numa tabela minuscula o planner escolhe Seq
    // Scan mesmo com o indice presente, o que tornaria o check instavel.
    const [expiresIdx] = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename='${SNAP}' AND indexname='user_recommendation_snapshots_current_expires_at_idx'`,
    );
    const expiresDef = expiresIdx?.indexdef ?? "";
    record(
      14,
      "indice parcial de expiracao dos VIGENTES existe com o predicado correto",
      /\(expires_at\)/i.test(expiresDef) && /WHERE\s*\(?\s*is_current/i.test(expiresDef),
      expiresDef.slice(0, 120) || "indice AUSENTE",
    );

    const [fbExpiresIdx] = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename='${FB}' AND indexname='user_recommendation_feedback_expires_at_idx'`,
    );
    const fbExpiresDef = fbExpiresIdx?.indexdef ?? "";
    record(
      38,
      "indice parcial de feedback expirado existe com o predicado correto",
      /\(expires_at\)/i.test(fbExpiresDef) && /WHERE\s*\(?\s*expires_at IS NOT NULL/i.test(fbExpiresDef),
      fbExpiresDef.slice(0, 120) || "indice AUSENTE",
    );

    // ---------------- FEEDBACK ----------------
    const fbCols = `("user_id","entity_type","entity_id","context","feedback_type","source","occurred_at","expires_at","idempotency_key")`;

    await expectOk(
      15,
      "feedback valido e inserido",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',9001,'discovery','not_interested','app', now(), NULL, 'key-1')`,
    );

    await expectViolation(
      16,
      "replay: mesma (user_id, idempotency_key) viola UNIQUE",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',9001,'discovery','not_interested','app', now(), NULL, 'key-1')`,
    );

    await expectOk(
      17,
      "OUTRO usuario pode reutilizar a MESMA idempotency_key",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U2},'movie',9001,'discovery','not_interested','app', now(), NULL, 'key-1')`,
    );

    await expectOk(
      18,
      "expires_at NULL (feedback permanente) e permitido",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'tv',9002,NULL,'hide','app', now(), NULL, 'key-2')`,
    );

    await expectOk(
      19,
      "expires_at futuro (feedback temporario) e permitido",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'tv',9002,'discovery','dismiss','app', now(), now() + interval '30 days', 'key-3')`,
    );

    await expectViolation(
      20,
      "expires_at <= occurred_at e barrado (CHECK)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',9001,NULL,'dismiss','app', now(), now() - interval '1 hour', 'key-4')`,
    );

    await expectViolation(
      21,
      "feedback_type invalido e barrado (enum)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',9001,NULL,'nao_existe','app', now(), NULL, 'key-5')`,
    );

    await expectViolation(
      22,
      "context invalido e barrado (enum)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',9001,'contexto_falso','hide','app', now(), NULL, 'key-6')`,
    );

    await expectViolation(
      23,
      "source invalida e barrada (enum)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',9001,NULL,'hide','robo', now(), NULL, 'key-7')`,
    );

    await expectViolation(
      24,
      "entity_type='person' e barrado (CHECK)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'person',9003,NULL,'hide','app', now(), NULL, 'key-8')`,
    );

    await expectViolation(
      25,
      "idempotency_key em branco e barrada (CHECK)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',9001,NULL,'hide','app', now(), NULL, '   ')`,
    );

    await expectViolation(
      26,
      "feedback de usuario inexistente e barrado (FK)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (999999,'movie',9001,NULL,'hide','app', now(), NULL, 'key-9')`,
    );

    await expectViolation(
      27,
      "feedback para entidade inexistente e barrado (FK)",
      `INSERT INTO "${FB}" ${fbCols} VALUES (${U1},'movie',123456,NULL,'hide','app', now(), NULL, 'key-10')`,
    );

    // Cascata LGPD: apagar o usuario apaga seu feedback e seus snapshots.
    const [beforeFb] = await q<{ c: bigint }>(`SELECT count(*) AS c FROM "${FB}" WHERE user_id=${U2}`);
    await exec(`DELETE FROM "${SNAP}" WHERE user_id=${U2}`);
    await exec(`DELETE FROM users WHERE id=${U2}`);
    const [afterFb] = await q<{ c: bigint }>(`SELECT count(*) AS c FROM "${FB}" WHERE user_id=${U2}`);
    record(
      28,
      "apagar usuario CASCATEIA o feedback (LGPD)",
      Number(beforeFb!.c) > 0 && Number(afterFb!.c) === 0,
      `antes=${Number(beforeFb!.c)} depois=${Number(afterFb!.c)}`,
    );

    // Nenhuma coluna sensivel na tabela de feedback.
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='${FB}'`,
    );
    const names = cols.map((c) => c.column_name);
    const banned = names.filter((c) =>
      /comment|note|body|title|description|email|password|token|ip_|session|rating|score|moderation/i.test(
        c,
      ),
    );
    record(29, "feedback nao tem coluna sensivel/texto livre", banned.length === 0, `colunas=${names.length}, proibidas=[${banned.join(",")}]`);

    // ---------------- C7A.1: IDENTIDADE DOS EVENTOS DE TRACKING ----------------
    const EV = "user_viewing_events";
    // U2 foi APAGADO no check 28 (cascata LGPD); os checks de tracking usam U3.
    const [u3] = await q<{ id: bigint }>(
      `SELECT id FROM users WHERE email_normalized='c7c@example.test'`,
    );
    const U3 = Number(u3!.id);
    const evCols = `("user_id","entity_type","entity_id","event_type","occurred_at","source","idempotency_key")`;
    const ev = (u: number, key: string, type: string) =>
      `INSERT INTO "${EV}" ${evCols} VALUES (${u},'movie',9001,'${type}', now(), 'app', '${key}')`;

    // Uma UNICA operacao (mesma chave) emite eventos IRMAOS de tipos distintos.
    await expectOk(40, "evento 1 da operacao (state_changed) e inserido", ev(U1, "op-1", "state_changed"));
    await expectOk(41, "evento 2 da MESMA operacao (watch_started) e inserido", ev(U1, "op-1", "watch_started"));
    await expectOk(42, "evento 3 da MESMA operacao (watch_completed) e inserido", ev(U1, "op-1", "watch_completed"));
    await expectOk(43, "evento 4 da MESMA operacao (rewatch_started) e inserido", ev(U1, "op-1", "rewatch_started"));

    await expectViolation(
      44,
      "REPLAY do mesmo (user, chave, tipo) e barrado (UNIQUE)",
      ev(U1, "op-1", "state_changed"),
    );

    await expectOk(45, "OUTRO usuario pode reutilizar a mesma chave e tipo", ev(U3, "op-1", "state_changed"));
    await expectOk(46, "MESMO usuario, chave diferente, mesmo tipo e aceito", ev(U1, "op-2", "state_changed"));

    await expectViolation(
      47,
      "event_type invalido e barrado (enum)",
      ev(U1, "op-3", "tipo_inexistente"),
    );
    await expectViolation(
      48,
      "evento de usuario inexistente e barrado (FK)",
      ev(999999, "op-4", "state_changed"),
    );

    // Introspeccao: a identidade ANTIGA sumiu e a NOVA existe, com as 3 colunas
    // na ordem correta.
    const [oldIdx] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM pg_indexes WHERE tablename='${EV}' AND indexname='${OLD_TRACKING_UNIQUE}'`,
    );
    record(49, "a UNIQUE antiga (user_id, idempotency_key) NAO existe mais", Number(oldIdx!.c) === 0, `encontradas=${Number(oldIdx!.c)}`);

    const [newIdx] = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename='${EV}' AND indexname='${NEW_TRACKING_UNIQUE}'`,
    );
    const newDef = newIdx?.indexdef ?? "";
    record(
      50,
      "a UNIQUE nova existe com (user_id, idempotency_key, event_type) NESSA ordem",
      /UNIQUE INDEX/i.test(newDef) &&
        /\(\s*user_id\s*,\s*idempotency_key\s*,\s*event_type\s*\)/i.test(newDef),
      newDef.slice(0, 130) || "indice AUSENTE",
    );

    // Concorrencia A: identidades IGUAIS -> exatamente uma vence.
    const sameRace = await Promise.allSettled([
      exec(ev(U1, "op-race", "state_changed")),
      exec(ev(U1, "op-race", "state_changed")),
    ]);
    const sameWon = sameRace.filter((r) => r.status === "fulfilled").length;
    record(51, "concorrencia: identidades IGUAIS => so 1 linha vence", sameWon === 1, `aceitos=${sameWon}`);

    // Concorrencia B: mesma operacao, tipos DIFERENTES -> ambas vencem.
    const diffRace = await Promise.allSettled([
      exec(ev(U1, "op-race2", "watch_started")),
      exec(ev(U1, "op-race2", "watch_completed")),
    ]);
    const diffWon = diffRace.filter((r) => r.status === "fulfilled").length;
    const [rows2] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "${EV}" WHERE user_id=${U1} AND idempotency_key='op-race2'`,
    );
    record(
      52,
      "concorrencia: mesma operacao com tipos DIFERENTES => ambas persistem",
      diffWon === 2 && Number(rows2!.c) === 2,
      `aceitos=${diffWon}, linhas=${Number(rows2!.c)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** Cenario B: estado anterior -> aplica C7A -> prova preservacao e backfill. */
async function runUpgradeScenario(url: string, env: NodeJS.ProcessEnv): Promise<void> {
  const tempPrisma = mkdtempSync(path.join(tmpdir(), "screena-c7a-prisma-"));
  try {
    const tempSchema = path.join(tempPrisma, "schema.prisma");
    const tempMig = path.join(tempPrisma, "migrations");
    copyFileSync(schemaPath, tempSchema);
    cpSync(migrationsDir, tempMig, { recursive: true });

    // Estado ANTERIOR = tudo, EM ORDEM, exceto C7A e o que veio DEPOIS dela
    // (C7A.1) — senao o "estado anterior" conteria uma migration posterior.
    rmSync(path.join(tempMig, C7A_DIR), { recursive: true, force: true });
    rmSync(path.join(tempMig, C7A1_DIR), { recursive: true, force: true });
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", tempSchema], {
      env,
      stdio: "pipe",
      cwd: dbDir,
    });

    const prisma = new PrismaClient({ datasourceUrl: url });
    try {
      await seedFixtures((sql) => prisma.$executeRawUnsafe(sql));
      const [u] = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
        `SELECT id FROM users WHERE email_normalized='c7a@example.test'`,
      );
      const U = Number(u!.id);
      // Linha LEGADA: schema antigo (sem context/policy_version/fingerprint/expires_at).
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${SNAP}" ("user_id","algorithm_version","generated_at","items","is_current") VALUES (${U},'reco-v1', now(), '{"legacy":true}'::jsonb, true)`,
      );
      record(30, "estado anterior aplicado + linha legada inserida", true, `user=${U}`);
      await prisma.$disconnect();

      // Aplica C7A por cima.
      cpSync(path.join(migrationsDir, C7A_DIR), path.join(tempMig, C7A_DIR), { recursive: true });
      execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", tempSchema], {
        env,
        stdio: "pipe",
        cwd: dbDir,
      });
      record(31, "migration C7A aplica SOBRE o estado anterior", true, "migrate deploy ok");

      const after = new PrismaClient({ datasourceUrl: url });
      try {
        const rows = await after.$queryRawUnsafe<
          { context: string; policy_version: string; fingerprint: string | null; expires_at: Date | null; items: unknown }[]
        >(`SELECT context::text, policy_version, fingerprint, expires_at, items FROM "${SNAP}" WHERE user_id=${U}`);
        const row = rows[0];
        record(
          32,
          "dado legado PRESERVADO (nenhuma perda)",
          rows.length === 1 && JSON.stringify(row?.items).includes("legacy"),
          `linhas=${rows.length}`,
        );
        record(
          33,
          "backfill usa valores VALIDOS do dominio (discovery / reco-v1)",
          row?.context === "discovery" && row?.policy_version === "reco-v1",
          `context=${row?.context} policy_version=${row?.policy_version}`,
        );
        record(
          34,
          "fingerprint/expires_at legados ficam NULL (sem valor inventado)",
          row?.fingerprint === null && row?.expires_at === null,
          `fingerprint=${row?.fingerprint} expires_at=${row?.expires_at}`,
        );

        // Os DEFAULTs temporarios foram REMOVIDOS: inserir sem context/policy falha.
        let defaultDropped = false;
        try {
          await after.$executeRawUnsafe(
            `INSERT INTO "${SNAP}" ("user_id","algorithm_version","generated_at","items") VALUES (${U},'reco-v1', now(), '{}'::jsonb)`,
          );
        } catch {
          defaultDropped = true;
        }
        record(35, "DEFAULT temporario foi REMOVIDO (adapter deve ser explicito)", defaultDropped, defaultDropped ? "insert sem context/policy_version falhou" : "DEFAULT ainda ativo");

        const [idx] = await after.$queryRawUnsafe<{ indexdef: string }[]>(
          `SELECT indexdef FROM pg_indexes WHERE indexname='user_recommendation_snapshots_current_unique'`,
        );
        record(
          36,
          "indice vigente passou a considerar o CONTEXTO",
          /user_id/.test(idx?.indexdef ?? "") && /context/.test(idx?.indexdef ?? ""),
          (idx?.indexdef ?? "ausente").slice(0, 110),
        );
      } finally {
        await after.$disconnect();
      }
    } catch (e) {
      record(30, "cenario de upgrade", false, (e as Error).message.split("\n")[0].slice(0, 120));
      await prisma.$disconnect().catch(() => undefined);
    }
  } finally {
    await safeRm(tempPrisma);
  }
}

/**
 * Cenario C (C7A.1): estado ANTERIOR = tudo menos C7A.1 (a UNIQUE antiga ainda
 * vale) -> insere evento valido sob ela -> aplica C7A.1 -> prova preservacao, a
 * liberacao dos eventos irmaos e a manutencao do bloqueio de replay.
 */
async function runTrackingUpgradeScenario(url: string, env: NodeJS.ProcessEnv): Promise<void> {
  const tempPrisma = mkdtempSync(path.join(tmpdir(), "screena-c7a1-prisma-"));
  try {
    const tempSchema = path.join(tempPrisma, "schema.prisma");
    const tempMig = path.join(tempPrisma, "migrations");
    copyFileSync(schemaPath, tempSchema);
    cpSync(migrationsDir, tempMig, { recursive: true });
    rmSync(path.join(tempMig, C7A1_DIR), { recursive: true, force: true });
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", tempSchema], {
      env,
      stdio: "pipe",
      cwd: dbDir,
    });

    const before = new PrismaClient({ datasourceUrl: url });
    let U = 0;
    try {
      await seedFixtures((sql) => before.$executeRawUnsafe(sql));
      const [u] = await before.$queryRawUnsafe<{ id: bigint }[]>(
        `SELECT id FROM users WHERE email_normalized='c7a@example.test'`,
      );
      U = Number(u!.id);
      const cols = `("user_id","entity_type","entity_id","event_type","occurred_at","source","idempotency_key")`;
      await before.$executeRawUnsafe(
        `INSERT INTO "user_viewing_events" ${cols} VALUES (${U},'movie',9001,'state_changed', now(), 'app', 'legacy-op')`,
      );
      // Sob a UNIQUE ANTIGA o evento irmao ja falharia — este e o bloqueador.
      let blockedBefore = false;
      try {
        await before.$executeRawUnsafe(
          `INSERT INTO "user_viewing_events" ${cols} VALUES (${U},'movie',9001,'watch_started', now(), 'app', 'legacy-op')`,
        );
      } catch {
        blockedBefore = true;
      }
      record(
        60,
        "ANTES de C7A.1 o evento irmao da mesma operacao era BARRADO (bloqueador reproduzido)",
        blockedBefore,
        blockedBefore ? "watch_started rejeitado pela UNIQUE antiga" : "nao foi barrado (premissa falhou)",
      );
    } finally {
      await before.$disconnect();
    }

    // Aplica C7A.1 por cima.
    cpSync(path.join(migrationsDir, C7A1_DIR), path.join(tempMig, C7A1_DIR), { recursive: true });
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", tempSchema], {
      env,
      stdio: "pipe",
      cwd: dbDir,
    });
    record(61, "migration C7A.1 aplica SOBRE o estado anterior", true, "migrate deploy ok");

    const after = new PrismaClient({ datasourceUrl: url });
    try {
      const cols = `("user_id","entity_type","entity_id","event_type","occurred_at","source","idempotency_key")`;
      const [kept] = await after.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT count(*) AS c FROM "user_viewing_events" WHERE user_id=${U} AND idempotency_key='legacy-op'`,
      );
      record(62, "evento legado PRESERVADO (nenhuma perda)", Number(kept!.c) === 1, `linhas=${Number(kept!.c)}`);

      let siblingOk = false;
      try {
        await after.$executeRawUnsafe(
          `INSERT INTO "user_viewing_events" ${cols} VALUES (${U},'movie',9001,'watch_started', now(), 'app', 'legacy-op')`,
        );
        siblingOk = true;
      } catch {
        siblingOk = false;
      }
      record(63, "DEPOIS de C7A.1 o evento irmao e ACEITO (bloqueador resolvido)", siblingOk, siblingOk ? "watch_started aceito" : "ainda barrado");

      let replayBlocked = false;
      try {
        await after.$executeRawUnsafe(
          `INSERT INTO "user_viewing_events" ${cols} VALUES (${U},'movie',9001,'state_changed', now(), 'app', 'legacy-op')`,
        );
      } catch {
        replayBlocked = true;
      }
      record(64, "replay do MESMO tipo continua BARRADO apos o upgrade", replayBlocked, replayBlocked ? "state_changed rejeitado" : "replay passou (regressao!)");

      const [oldGone] = await after.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT count(*) AS c FROM pg_indexes WHERE indexname='${OLD_TRACKING_UNIQUE}'`,
      );
      const [newDefRow] = await after.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE indexname='${NEW_TRACKING_UNIQUE}'`,
      );
      record(
        65,
        "apos upgrade: UNIQUE antiga ausente e nova presente com as 3 colunas",
        Number(oldGone!.c) === 0 &&
          /\(\s*user_id\s*,\s*idempotency_key\s*,\s*event_type\s*\)/i.test(newDefRow?.indexdef ?? ""),
        `antiga=${Number(oldGone!.c)} nova=${(newDefRow?.indexdef ?? "ausente").slice(0, 90)}`,
      );
    } finally {
      await after.$disconnect();
    }
  } finally {
    await safeRm(tempPrisma);
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-c7a-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  console.log(
    `\n=== C7A — persistencia da user platform | Postgres 16 efemero :${port} (postgres:****) ===\n`,
  );

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;

    // --- Cenario A: FRESH ---
    await pg.createDatabase("c7a_fresh");
    const freshUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/c7a_fresh?schema=public`;
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
      env: { ...process.env, DATABASE_URL: freshUrl },
      stdio: "pipe",
      cwd: dbDir,
    });
    record(0, "FRESH: todas as migrations aplicam em banco vazio", true, "migrate deploy ok");

    // DRIFT: o que o Prisma ainda mudaria no banco ja migrado? Objetos so-SQL
    // (indices parciais, CHECKs) sempre aparecem — o repo inteiro e assim, pois
    // o Prisma nao os representa. O que NAO pode aparecer e qualquer objeto de
    // C7A: se o Prisma quisesse criar/alterar a tabela de feedback, as colunas
    // novas ou os enums novos, o schema estaria fora de sincronia com o SQL.
    const drift = execFileSync(
      "node",
      [
        prismaBin(),
        "migrate",
        "diff",
        "--from-url",
        freshUrl,
        "--to-schema-datamodel",
        schemaPath,
        "--script",
      ],
      { env: { ...process.env, DATABASE_URL: freshUrl }, encoding: "utf8", cwd: dbDir },
    );
    // Classe CONHECIDA e repo-wide: a FK polimorfica composta para o registry
    // `entities` NAO e representavel no Prisma (nenhum model declara relacao
    // para `entities`), entao o diff sempre quer derruba-la — nas 6 tabelas que
    // a usam, nao so na nova. Excluir essa classe e legitimo; excluir qualquer
    // outra coisa mascararia drift real.
    const driftLines = drift.split(/\r?\n/);
    const entityFkDrops = driftLines.filter((l) => /DROP CONSTRAINT "\w+_entity_fkey"/.test(l));
    const residual = driftLines.filter((l) => !/DROP CONSTRAINT "\w+_entity_fkey"/.test(l));
    const c7aDrift = [
      "user_recommendation_feedback",
      '"context"',
      '"policy_version"',
      '"fingerprint"',
      '"expires_at"',
      "RecommendationContext",
      "RecommendationFeedbackType",
      "RecommendationFeedbackSource",
    ].filter((token) => residual.some((l) => l.includes(token)));
    if (c7aDrift.length > 0) {
      console.log(
        `[drift] statements citando objetos de C7A:\n${residual
          .filter((l) => c7aDrift.some((t) => l.includes(t)))
          .slice(0, 6)
          .join("\n")}`,
      );
    }
    record(
      37,
      "sem DRIFT nos objetos de C7A (schema Prisma == SQL aplicado)",
      c7aDrift.length === 0,
      c7aDrift.length === 0
        ? `nenhum objeto de C7A no diff (${entityFkDrops.length} FKs polimorficas so-SQL ignoradas, classe repo-wide)`
        : `drift em: ${c7aDrift.join(", ")}`,
    );

    console.log("\n--- cenario A (fresh) ---");
    await runFreshChecks(freshUrl);

    // --- Cenario B: UPGRADE ---
    console.log("\n--- cenario B (upgrade) ---");
    await pg.createDatabase("c7a_upgrade");
    const upgradeUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/c7a_upgrade?schema=public`;
    await runUpgradeScenario(upgradeUrl, { ...process.env, DATABASE_URL: upgradeUrl });

    // --- Cenario C: UPGRADE de C7A.1 (idempotencia dos eventos de tracking) ---
    console.log("\n--- cenario C (upgrade C7A.1: tracking) ---");
    await pg.createDatabase("c7a1_upgrade");
    const trackUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/c7a1_upgrade?schema=public`;
    await runTrackingUpgradeScenario(trackUrl, { ...process.env, DATABASE_URL: trackUrl });
  } catch (e) {
    record(99, "execucao", false, (e as Error).message.split("\n")[0]);
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
  console.log("Resultado: PASSOU. Fundacao de persistencia validada em PostgreSQL 16 real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
