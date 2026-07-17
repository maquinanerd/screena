/**
 * validate-pgcrypto-migration-real-postgres.ts — Prova, em PostgreSQL real, que a
 * migration `20260715120000_data_governance_hardening` aplica e que os
 * fingerprints de `watch_availability` sao SHA-256 de verdade.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. Nao faz parte do produto:
 * nunca roda no render, no build de app, nem em producao. Motor:
 * `embedded-postgres` (PostgreSQL 16 real, efemero) — devDependency-only.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE VALIDATOR EXISTE (incidente de producao, 2026-07-16)
 * ---------------------------------------------------------------------------
 * A migration falhou em producao com:
 *
 *     ERROR: function digest(text, unknown) does not exist
 *
 * ...ao criar `watch_offer_identity_key_v1`/`watch_offer_payload_fingerprint_v1`.
 * O `digest` estava sem schema. Como `check_function_bodies = on` (default), o
 * corpo de uma funcao `LANGUAGE sql` e resolvido JA NO `CREATE FUNCTION` — logo a
 * migration morre na criacao da funcao, nao no primeiro uso.
 *
 * A ARMADILHA: com `pgcrypto` em `public` E `search_path = public` (o caso do
 * dev/CI), o `digest` sem schema resolve e a migration passa. O bug so aparece
 * quando o `search_path` da conexao NAO alcanca o schema da extensao — que era o
 * caso de producao. Um validator que apenas rode `migrate deploy` num Postgres
 * limpo passa COM o bug e nao prova nada.
 *
 * Por isso o check 6 reproduz a condicao de producao (search_path hostil) e exige
 * que a forma SEM schema FALHE e a COM schema passe. E o check 5 casa o digest do
 * banco com o SHA-256 do Node: se `digest` deixar de ser sha256, quebra.
 *
 * A migration usa `public.digest`, entao `pgcrypto` PRECISA estar no schema
 * `public` (check 2). Ver docs/runbooks/PRODUCTION_DEPLOY.md.
 *
 * Uso: pnpm --filter @screena/db db:validate:pgcrypto
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const migrationPath = path.join(
  dbDir,
  "prisma",
  "migrations",
  "20260715120000_data_governance_hardening",
  "migration.sql",
);

/** Schema hostil: existe, mas NAO contem `digest`. Reproduz o search_path de prod. */
const HOSTILE_SCHEMA = "prod_like_no_pgcrypto";

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

function prismaBin(): string {
  return require.resolve("prisma/build/index.js");
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

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    console.warn(`[cleanup] rm ${dir}: ${(e as Error).message.split("\n")[0]}`);
  }
}

/** `SQLSTATE 42883 undefined_function` — o erro exato do incidente. */
function isUndefinedFunction(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  return /does not exist/i.test(msg) && /digest/i.test(msg);
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    // 3. As duas funcoes existem apos o migrate deploy.
    const fns = await prisma.$queryRawUnsafe<{ proname: string; provolatile: string; nspname: string }[]>(
      `SELECT p.proname, p.provolatile, n.nspname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN ('watch_offer_identity_key_v1','watch_offer_payload_fingerprint_v1')`,
    );
    const names = fns.map((f) => f.proname).sort();
    record(
      3,
      "as duas funcoes de fingerprint existem apos migrate deploy",
      names.length === 2,
      names.length === 2 ? names.join(", ") : `encontradas: ${JSON.stringify(names)}`,
    );

    // 4. Ambas IMMUTABLE ('i') — exigencia do indice unico por expressao.
    const allImmutable = fns.length === 2 && fns.every((f) => f.provolatile === "i");
    record(
      4,
      "ambas as funcoes sao IMMUTABLE (exigido pelo indice por expressao)",
      allImmutable,
      fns.map((f) => `${f.proname}=${f.provolatile}`).join(", ") || "nenhuma funcao",
    );

    // 5. O digest do banco e SHA-256 DE VERDADE: casa com o crypto do Node.
    const probe = "cinerie:pgcrypto:probe";
    const expected = createHash("sha256").update(probe, "utf8").digest("hex");
    const [{ hex }] = await prisma.$queryRawUnsafe<{ hex: string }[]>(
      `SELECT encode(public.digest($1::text, 'sha256'::text), 'hex') AS hex`,
      probe,
    );
    record(
      5,
      "public.digest(...,'sha256') casa com o SHA-256 do Node (e sha256 real)",
      hex === expected,
      hex === expected ? `${hex.slice(0, 16)}...` : `banco=${hex} node=${expected}`,
    );

    // 6. REPRODUCAO DO INCIDENTE: sob search_path hostil, a forma SEM schema
    //    FALHA e a COM schema passa. E o check que da dentes ao fix.
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${HOSTILE_SCHEMA}"`);

    let bareFailed = false;
    let bareDetail = "";
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${HOSTILE_SCHEMA}"`);
        await tx.$executeRawUnsafe(
          `CREATE OR REPLACE FUNCTION "${HOSTILE_SCHEMA}".probe_bare(p TEXT) RETURNS TEXT AS $$
             SELECT encode(digest(p, 'sha256'), 'hex');
           $$ LANGUAGE sql IMMUTABLE`,
        );
      });
      bareDetail = "CREATE passou — o search_path hostil nao reproduziu o incidente";
    } catch (e) {
      bareFailed = isUndefinedFunction(e);
      bareDetail = (e as Error).message.split("\n").find((l) => /does not exist/i.test(l))?.trim() ?? "";
    }
    record(
      6,
      "sob search_path hostil, digest() SEM schema falha (reproduz o incidente)",
      bareFailed,
      bareFailed ? `erro esperado: ${bareDetail}` : bareDetail,
    );

    let qualifiedOk = false;
    let qualifiedDetail = "";
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${HOSTILE_SCHEMA}"`);
        await tx.$executeRawUnsafe(
          `CREATE OR REPLACE FUNCTION "${HOSTILE_SCHEMA}".probe_qualified(p TEXT) RETURNS TEXT AS $$
             SELECT encode(public.digest(p, 'sha256'::text), 'hex');
           $$ LANGUAGE sql IMMUTABLE`,
        );
      });
      qualifiedOk = true;
      qualifiedDetail = "CREATE passou mesmo com search_path hostil";
    } catch (e) {
      qualifiedDetail = (e as Error).message.split("\n")[0];
    }
    record(
      7,
      "sob o MESMO search_path hostil, public.digest(...) funciona (o fix e o que resolve)",
      qualifiedOk,
      qualifiedDetail,
    );

    // 8. O indice unico por expressao existe (depende das funcoes IMMUTABLE).
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'watch_availability_offer_identity'`,
    );
    record(
      8,
      "indice unico por expressao watch_availability_offer_identity existe",
      idx.length === 1,
      idx.length === 1 ? "criado" : "ausente",
    );

    // 9. A migration esta registrada como aplicada e sem falha.
    const applied = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>(
      `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
        WHERE migration_name = '20260715120000_data_governance_hardening'`,
    );
    const row = applied[0];
    const appliedOk = row !== undefined && row.finished_at !== null && row.rolled_back_at === null;
    record(
      9,
      "migration registrada em _prisma_migrations como aplicada (sem rollback)",
      appliedOk,
      row === undefined ? "ausente" : `finished_at=${String(row.finished_at)} rolled_back_at=${String(row.rolled_back_at)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  // 0. Guarda estatica: o arquivo versionado precisa chamar digest COM schema.
  //    Roda antes de subir o Postgres — falha barata e imediata.
  const sql = readFileSync(migrationPath, "utf-8");
  const bareDigest = [...sql.matchAll(/(^|[^.\w])digest\s*\(/g)];
  record(
    0,
    "migration.sql nao contem chamada a digest( sem schema",
    bareDigest.length === 0,
    bareDigest.length === 0
      ? "todas as chamadas usam public.digest("
      : `${bareDigest.length} chamada(s) sem schema — o incidente de producao volta`,
  );

  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-pgcrypto-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_pgcrypto?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/cinerie_pgcrypto?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_pgcrypto");

    // 1/2. pgcrypto e PRE-REQUISITO e precisa estar em `public` (a migration usa
    //      public.digest). FAIL-LOUD: sem extensao, nada adiante faz sentido.
    const bootstrap = new PrismaClient({ datasources: { db: { url } } });
    try {
      try {
        await bootstrap.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`);
        record(1, "pgcrypto pode ser criada (pre-requisito da migration)", true, "CREATE EXTENSION ok");
      } catch (e) {
        record(1, "pgcrypto pode ser criada (pre-requisito da migration)", false, (e as Error).message.split("\n")[0]);
        throw new Error(
          "pgcrypto indisponivel: a migration 20260715120000 NAO pode ser aplicada. " +
            "Rode `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;` como superuser/owner no banco alvo. " +
            "Ver docs/runbooks/PRODUCTION_DEPLOY.md.",
        );
      }
      const ext = await bootstrap.$queryRawUnsafe<{ nspname: string }[]>(
        `SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto'`,
      );
      const inPublic = ext[0]?.nspname === "public";
      record(
        2,
        "pgcrypto instalada no schema public (a migration usa public.digest)",
        inPublic,
        `schema=${ext[0]?.nspname ?? "ausente"}`,
      );
      if (!inPublic) {
        throw new Error(
          `pgcrypto esta no schema "${ext[0]?.nspname}" e a migration chama public.digest. ` +
            "Reinstale com `CREATE EXTENSION pgcrypto WITH SCHEMA public;`.",
        );
      }
    } finally {
      await bootstrap.$disconnect();
    }

    const env = { ...process.env, DATABASE_URL: url };
    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });

    console.log("\n--- checks no banco real ---");
    await runChecks(url);
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
    safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado e dir temporario removido ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. pgcrypto + migration de data governance validados em PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
