/**
 * validate-source-authorization-legacy-grants.ts — Reconstrói, em PostgreSQL 16
 * REAL e efêmero, o estado de produção em que `legal sources apply --confirm`
 * empaca com:
 *
 *   P0001: data_usage_decisions fail-closed: licenca 8 com license_status unknown
 *          nao permite uso concedido
 *
 * E prova COMO esse estado nasceu — pelo caminho real, sem SQL sintético:
 *
 *   1. `db:seed`  -> 5 licenças de rating conservadoras (`unknown`), 0 decisões
 *   2. `legal apply` -> supersede as 5, cria as vigentes (`third_party`) + as
 *                       13 decisões (5 delas rating_display/BR concedendo display)
 *   3. `db:seed` DE NOVO -> **o clobber**: o seed faz `update` IN PLACE na licença
 *                       VIGENTE de cada fonte de rating e a rebaixa para
 *                       `unknown`/`display_allowed=false`, mantendo o MESMO id,
 *                       `is_current=true` e todas as decisões penduradas nela.
 *
 * A partir daí as 5 decisões `rating_display` concedem display sob licença
 * `unknown`. Elas eram LEGAIS quando nasceram — a licença é que foi rebaixada
 * debaixo delas. Nenhuma delas poderia ser criada hoje.
 *
 * O impasse que isso produz: a decisão velha não sai porque a licença-mãe é
 * `unknown` (guarda de decisões, ramo `license_status`); a licença não é
 * substituída porque a decisão velha não sai.
 *
 * NÃO é caso isolado: `packages/db/prisma/seed.ts` refaz o rebaixamento a CADA
 * execução de `pnpm --filter @screena/db db:seed` posterior a um apply. E nada
 * o impede: o único trigger de `source_licenses`
 * (`source_licenses_supersedes_guard`) só valida a cadeia `supersedes_id` —
 * não há guarda contra rebaixar uma licença sob decisões vivas. A assimetria é
 * estrutural: `data_usage_decisions` é fail-closed na escrita; `source_licenses`
 * não é fail-closed contra rebaixamento retroativo.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTÁVEL — nunca em produto/render/produção.
 * Motor: embedded-postgres (PostgreSQL 16 real, efêmero), devDependency-only.
 * Segurança: nenhum segredo; DATABASE_URL só em memória, mascarado; PG derrubado
 * no finally.
 *
 * Uso (a partir da raiz): pnpm validate:source-authorization-legacy-grants
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

import { applyAuthorizationWithin, readCurrentState } from "../src/apply.js";
import {
  STATIC_AUTHORIZATION,
  AUTHORIZATION_REASON,
  DECIDED_BY,
  type AuthorizationEntry,
} from "../src/authorization-spec.js";
import { planAuthorization } from "../src/plan.js";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");

interface CheckResult { n: number; name: string; ok: boolean; detail: string }
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} — ${detail}`);
}

/** Ver a nota extensa em validate-source-authorization-and-attribution.ts. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      if (port <= 0) {
        srv.close(() => reject(new Error("nao foi possivel reservar uma porta TCP valida")));
        return;
      }
      srv.close((error) => (error !== undefined ? reject(error) : resolve(port)));
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  if (rel === undefined) throw new Error("prisma/package.json sem entrada bin.prisma");
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
}

const msg = (e: unknown): string => (e as Error).message.replace(/\s+/g, " ").trim();

async function runChecks(url: string, runSeed: () => void): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql);
  const count = async (sql: string): Promise<number> =>
    Number((await q<{ c: number }>(`SELECT count(*)::int AS c ${sql}`))[0]!.c);

  /** Apply REAL — o mesmo laço que `pnpm legal sources apply --confirm` executa. */
  const apply = (entries: readonly AuthorizationEntry[]): Promise<void> =>
    prisma.$transaction(async (tx) => {
      await applyAuthorizationWithin(tx, entries, { reviewer: DECIDED_BY, reason: AUTHORIZATION_REASON });
    });

  try {
    // Produção não tem provedor canônico de streaming registrado.
    const entries = STATIC_AUTHORIZATION;

    // ============ 1. SEED: a licença conservadora, sem decisão nenhuma ============
    record(1, "seed inicial: 5 licencas de rating unknown, 0 decisoes",
      (await count(`FROM source_licenses WHERE is_current=true AND license_status='unknown'`)) === 5 &&
        (await count(`FROM data_usage_decisions`)) === 0,
      `unknown vigentes=${await count(`FROM source_licenses WHERE is_current=true AND license_status='unknown'`)} decisoes=${await count(`FROM data_usage_decisions`)}`);

    // ============ 2. APPLY: a leva de autorizacao, legal e completa ============
    await apply(entries);
    const legalAntes = await count(
      `FROM data_usage_decisions d JOIN source_licenses l ON l.id=d.source_license_id
        WHERE d.is_current AND d.display_allowed AND l.license_status IN ('official','licensed','third_party')`,
    );
    record(2, "apply cria 13 decisoes LEGAIS (todo grant sob licenca exibivel)",
      (await count(`FROM data_usage_decisions WHERE is_current=true`)) === 13 && legalAntes === 5,
      `decisoes vigentes=${await count(`FROM data_usage_decisions WHERE is_current=true`)} grants sob licenca exibivel=${legalAntes}`);

    // ============ 3. O CLOBBER: db:seed rodado DEPOIS do apply ============
    //
    // `seed.ts` procura a licenca VIGENTE de (source_key, 'rating', provider_key
    // NULL, territory NULL) e faz `update` IN PLACE — mesmo id, mesmo
    // is_current, mesmas decisoes penduradas — rebaixando para unknown.
    runSeed();

    const rebaixadas = await q<{ id: bigint; source_key: string; license_status: string; display_allowed: boolean; decision_origin: string | null; policy_version: string | null }>(
      `SELECT id, source_key, license_status::text AS license_status, display_allowed, decision_origin, policy_version
         FROM source_licenses WHERE is_current=true AND content_type='rating' ORDER BY id`,
    );
    record(3, "db:seed rebaixa IN PLACE as 5 licencas vigentes de rating para unknown/display=false",
      rebaixadas.length === 5 && rebaixadas.every((l) => l.license_status === "unknown" && !l.display_allowed),
      `ids=${rebaixadas.map((l) => String(l.id)).join(",")} status=${[...new Set(rebaixadas.map((l) => l.license_status))].join(",")}`);

    // A IMPRESSÃO DIGITAL do clobber: o apply NUNCA escreve `unknown`, e o seed
    // NUNCA escreve decision_origin/policy_version. Uma linha com os dois é
    // prova de que a licença do apply foi sobrescrita pelo seed.
    const digitais = rebaixadas.filter(
      (l) => l.license_status === "unknown" && l.decision_origin === "owner_authorization" && (l.policy_version ?? "") !== "",
    );
    record(4, "impressao digital do clobber: license_status=unknown COM decision_origin=owner_authorization",
      digitais.length === 5,
      `linhas com a assinatura=${digitais.length}/5 (ex.: id=${String(digitais[0]?.id ?? "?")} origin=${digitais[0]?.decision_origin} policy=${digitais[0]?.policy_version})`);

    // ============ 5. O ESTADO EXATO DE PRODUCAO ============
    const licCurrent = await count(`FROM source_licenses WHERE is_current=true`);
    const licTotal = await count(`FROM source_licenses`);
    const decCurrent = await count(`FROM data_usage_decisions WHERE is_current=true`);
    const ratingDisplay = await count(
      `FROM data_usage_decisions WHERE is_current=true AND use_case='rating_display' AND territory='BR' AND display_allowed=true`,
    );
    record(5, "estado == producao (8 licencas vigentes de 13; 13 decisoes vigentes; 5 rating_display/BR display=true)",
      licCurrent === 8 && licTotal === 13 && decCurrent === 13 && ratingDisplay === 5,
      `vigentes=${licCurrent}/${licTotal} decisoes=${decCurrent} rating_display/BR=${ratingDisplay}`);

    // As 5 linhas legadas: concedem display sob licenca `unknown`. Ilegais hoje.
    const ilegais = await q<{ dec: bigint; lic: bigint; source_key: string }>(
      `SELECT d.id AS dec, l.id AS lic, l.source_key
         FROM data_usage_decisions d JOIN source_licenses l ON l.id=d.source_license_id
        WHERE d.is_current AND d.display_allowed AND l.license_status NOT IN ('official','licensed','third_party')
        ORDER BY l.id`,
    );
    record(6, "as 5 decisoes legadas concedem display sob licenca unknown (nao poderiam nascer hoje)",
      ilegais.length === 5,
      ilegais.map((r) => `dec ${r.dec}->lic ${r.lic}(${r.source_key})`).join(" "));

    // ============ 7. NENHUMA DELAS PODERIA SER CRIADA HOJE ============
    // Controle: tentar inserir HOJE uma decisao igual a uma das legadas.
    let recusaCriacao = "";
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed,
             storage_allowed, derivative_allowed, attribution_required, linkback_required, valid_from,
             policy_version, decided_by, reason, is_current, updated_at)
           VALUES (${ilegais[0]!.lic},'rating_display','BR','approved_for_display',true,true,false,true,true,now(),
             'x/v1','${DECIDED_BY.replace(/'/g, "''")}','controle',false,now())`,
        );
        throw new Error("ROLLBACK-INTENCIONAL: o INSERT proibido foi ACEITO");
      });
    } catch (e) {
      recusaCriacao = msg(e);
    }
    record(7, "controle: criar HOJE uma decisao igual a legada e recusado pelo guarda",
      recusaCriacao.toLowerCase().includes("nao permite uso concedido"),
      recusaCriacao.includes("ROLLBACK-INTENCIONAL") ? "O INSERT PROIBIDO PASSOU" : recusaCriacao.slice(0, 150));

    // ============ 8. O GUARDA NAO EXISTIA ANTES? EXISTIA. ============
    // `data_usage_decisions` e seu trigger nascem na MESMA migration
    // (20260717120000, tabela na linha 85, trigger na 236) e nenhuma migration
    // insere decisoes. Logo nenhuma linha pode preceder o guarda: toda decisao
    // foi escrita com ele armado — e era legal no momento em que nasceu.
    const guardaAtivo = await count(
      `FROM pg_trigger WHERE tgname = 'data_usage_decisions_guard' AND NOT tgisinternal`,
    );
    record(8, "o guarda estava armado desde a criacao da tabela (nao foi adicionado depois)",
      guardaAtivo === 1, `triggers data_usage_decisions_guard=${guardaAtivo}`);

    // ============ 9. NADA PROTEGE A LICENCA ============
    // O unico trigger de source_licenses so valida a cadeia supersedes_id.
    const triggersLicenca = await q<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        WHERE c.relname='source_licenses' AND NOT t.tgisinternal ORDER BY tgname`,
    );
    record(9, "source_licenses NAO tem guarda contra rebaixar licenca sob decisoes vivas",
      triggersLicenca.length === 1 && triggersLicenca[0]!.tgname === "source_licenses_supersedes_guard",
      `triggers=${triggersLicenca.map((t) => t.tgname).join(",") || "<nenhum>"}`);

    // ============ 10-11. O IMPASSE ============
    const { licenses, decisions } = await readCurrentState(prisma);
    const s = planAuthorization(entries, licenses, decisions).summary;
    record(10, "dry-run reproduz o plano de producao (supersede=5, keep=3, decisoes create=10)",
      s.licensesSupersede === 5 && s.licensesKeep === 3 && s.decisionsCreate === 10,
      `supersede=${s.licensesSupersede} keep=${s.licensesKeep} decCreate=${s.decisionsCreate} decKeep=${s.decisionsKeep}`);

    let impasse = "";
    try {
      await apply(entries);
    } catch (e) {
      impasse = msg(e);
    }
    record(11, "apply empaca no OUTRO ramo do guarda: license_status unknown nao permite uso concedido",
      impasse.toLowerCase().includes("nao permite uso concedido"),
      impasse === "" ? "O APPLY PASSOU (o impasse nao foi reproduzido)" : impasse.slice(0, 190));

    // A transacao voltou atras inteira: o impasse nao corrompe nada.
    record(12, "o impasse e atomico: nada mudou no banco (como em producao)",
      (await count(`FROM source_licenses`)) === 13 && (await count(`FROM data_usage_decisions`)) === 13,
      `licencas=${await count(`FROM source_licenses`)} decisoes=${await count(`FROM data_usage_decisions`)}`);
  } catch (e) {
    record(0, "execucao", false, msg(e).slice(0, 200));
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-legal-legacy-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_legal?schema=public`;
  console.log(`\n=== decisoes legadas concedendo sob licenca unknown — PostgreSQL efemero :${port} (postgres:****) ===\n`);

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_legal");
    const env = { ...process.env, DATABASE_URL: url };
    const runSeed = (): void => {
      execFileSync("node", [prismaBin(), "db", "seed", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    };
    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(-1, "migrate deploy", true, "ok");
    console.log("--- db seed (1a vez) ---");
    runSeed();
    record(-2, "db seed", true, "ok");
    await runChecks(url, runSeed);
  } catch (e) {
    record(0, "boot", false, msg(e).slice(0, 200));
  } finally {
    if (started) {
      try { await pg.stop(); } catch { /* best-effort */ }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((r) => !r.ok);
  const total = results.filter((r) => r.n > 0).length;
  console.log(`\nRESUMO (decisoes legadas sob licenca unknown): ${total - failed.filter((f) => f.n > 0).length}/${total} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Origem reproduzida (db:seed rebaixa a licenca vigente IN PLACE) e impasse confirmado.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
