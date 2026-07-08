/**
 * validate-real-postgres.ts — Validacao DESCARTAVEL da Fase 1 em PostgreSQL real.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do produto:
 * nunca roda no render, no build de app, nem em producao. Usada apenas para
 * revalidar a migration + o seed em qualquer maquina/CI, sem Docker e sem
 * Postgres global.
 *
 * Motor: `embedded-postgres@16.14.0-beta.17` (PostgreSQL 16 real, binario
 * portatil, EFEMERO). O sufixo "-beta" e a maturidade do wrapper npm; o motor e
 * Postgres real. Esta dependencia e devDependency-only de @screena/db.
 *
 * Seguranca:
 *  - NAO ha senha real nem segredo: o instance efemero usa a senha descartavel
 *    "postgres" apenas para o processo local; nada disso e producao.
 *  - NENHUM DATABASE_URL e persistido em disco/.env: ele so existe como variavel
 *    de ambiente em memoria, passada aos subprocessos durante a execucao, e e
 *    SEMPRE mascarado nos logs (postgres:****).
 *  - O Postgres efemero e DERRUBADO e o diretorio temporario e REMOVIDO no
 *    bloco `finally`, mesmo em caso de erro.
 *
 * Fluxo: sobe PG efemero -> prisma migrate deploy -> prisma db seed -> 18 checks
 * no banco real -> derruba tudo. NAO altera schema/migration/seed, nao toca
 * producao, nao commita nada.
 *
 * Uso: pnpm --filter @screena/db db:validate:real
 */

import { execFileSync } from "node:child_process";
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

type Row = Record<string, unknown>;
interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${n}. ${name} — ${detail}`);
}

/** Acha uma porta TCP livre. */
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

/** Resolve o entrypoint da CLI do Prisma (para invocar com `node`). */
function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

const EXPECTED_TABLES = [
  "movies", "tv_shows", "seasons", "episodes", "people", "cast_members", "crew_members",
  "entity_translations", "content_blocks", "entity_writer_jobs", "entity_writer_logs",
  "external_ratings", "source_licenses", "watch_availability", "page_indexability_decisions",
  "countries", "languages", "slugs", "redirects", "api_sync_logs", "api_cache",
  "rating_sources", "api_providers", "entity_external_ids",
  // Fase 4F-A — ambiente editorial/blog.
  "articles", "article_translations", "entity_news_links",
  // P0-00a — raw sync TMDB (schema-only; worker-only, nao lido no render).
  "tmdb_raw", "tmdb_image_config",
];
const EXPECTED_ENUMS = [
  "EntityType", "ContentBlockType", "ContentSource", "ReviewStatus", "TranslationStatus",
  "IndexDecision", "JobType", "JobStatus", "LicenseStatus", "OfferType", "SyncStatus",
  "ValidationStatus", "ProviderKind",
  // P0-00a — discriminador dedicado do raw sync TMDB.
  "TmdbEntityKind",
];
const EXPECTED_SCALES: Record<string, number> = {
  imdb: 10, rotten_tomatoes: 100, metacritic: 100, letterboxd: 5, filmaffinity: 10,
};

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const q = <T = Row>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);

  /** Espera que `fn` LANCE (constraint deve barrar). */
  async function expectViolation(n: number, name: string, sql: string): Promise<void> {
    try {
      await exec(sql);
      record(n, name, false, "INSERT proibido foi ACEITO (constraint nao barrou)");
    } catch (e) {
      record(n, name, true, `barrado: ${(e as Error).message.split("\n")[0].slice(0, 90)}`);
    }
  }

  try {
    // 3. 29 tabelas esperadas (27 Fase 1/4F-A + tmdb_raw + tmdb_image_config do P0-00a)
    const tables = (await q<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    )).map((r) => r.table_name).filter((t) => t !== "_prisma_migrations");
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    record(3, "29 tabelas esperadas", tables.length === 29 && missing.length === 0,
      `encontradas ${tables.length}${missing.length ? ", faltando " + missing.join(",") : ""}`);

    // 4. 14 enums esperados (13 + TmdbEntityKind do P0-00a)
    const enums = (await q<{ typname: string }>(
      "SELECT typname FROM pg_type WHERE typtype='e' AND typnamespace='public'::regnamespace",
    )).map((r) => r.typname);
    const missingEnums = EXPECTED_ENUMS.filter((e) => !enums.includes(e));
    record(4, "14 enums esperados", enums.length === 14 && missingEnums.length === 0,
      `encontrados ${enums.length}${missingEnums.length ? ", faltando " + missingEnums.join(",") : ""}`);

    // 5/6/7. languages
    const langs = await q<{ code: string; is_published: boolean; index_default: boolean }>(
      "SELECT code, is_published, index_default FROM languages ORDER BY code",
    );
    const byCode = Object.fromEntries(langs.map((l) => [l.code, l]));
    record(5, "languages contem pt-BR, en, es", ["pt-BR", "en", "es"].every((c) => c in byCode),
      `codigos: ${langs.map((l) => l.code).join(", ")}`);
    record(6, "pt-BR publicado/indexavel", byCode["pt-BR"]?.is_published === true && byCode["pt-BR"]?.index_default === true,
      `is_published=${byCode["pt-BR"]?.is_published}, index_default=${byCode["pt-BR"]?.index_default}`);
    record(7, "en/es nao publicados/noindex",
      ["en", "es"].every((c) => byCode[c]?.is_published === false && byCode[c]?.index_default === false),
      `en(${byCode["en"]?.is_published}/${byCode["en"]?.index_default}) es(${byCode["es"]?.is_published}/${byCode["es"]?.index_default})`);

    // 8. rating_sources
    const rs = await q<{ key: string; scale: number }>("SELECT key, scale FROM rating_sources");
    const scaleByKey = Object.fromEntries(rs.map((r) => [r.key, Number(r.scale)]));
    const scalesOk = Object.entries(EXPECTED_SCALES).every(([k, v]) => scaleByKey[k] === v) && rs.length === 5;
    record(8, "rating_sources: fontes e escalas corretas", scalesOk, JSON.stringify(scaleByKey));

    // 9. disjuncao api_providers x rating_sources
    const ap = (await q<{ key: string }>("SELECT key FROM api_providers")).map((r) => r.key);
    const inter = ap.filter((k) => k in scaleByKey);
    record(9, "api_providers.key disjunto de rating_sources.key", inter.length === 0,
      `providers: ${ap.join(",")}; intersecao: [${inter.join(",")}]`);

    // 10/11. display_allowed default false
    for (const [n, table] of [[10, "external_ratings"], [11, "watch_availability"]] as const) {
      const def = (await q<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns WHERE table_name='${table}' AND column_name='display_allowed'`,
      ))[0]?.column_default;
      record(n, `${table}.display_allowed default false`, def === "false", `default=${def}`);
    }

    // 12. slug canonico: unique parcial barra 2o canonico
    await exec("INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', 1, 'pt-BR', 'slug-a', true, now())");
    await expectViolation(12, "indice unico parcial de slug canonico",
      "INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', 1, 'pt-BR', 'slug-b', true, now())");

    // 13. job ativo: unique parcial barra 2o ativo
    await exec("INSERT INTO entity_writer_jobs (entity_type, entity_id, language_code, job_type, status, updated_at) VALUES ('movie', 1, 'pt-BR', 'generate_block', 'queued', now())");
    await expectViolation(13, "indice unico parcial de job ativo",
      "INSERT INTO entity_writer_jobs (entity_type, entity_id, language_code, job_type, status, updated_at) VALUES ('movie', 1, 'pt-BR', 'generate_block', 'queued', now())");

    // 14. redirect from_path <> to_path
    await expectViolation(14, "CHECK redirect from_path <> to_path",
      "INSERT INTO redirects (from_path, to_path) VALUES ('/x', '/x')");

    // 15. watch price exige currency
    await expectViolation(15, "CHECK watch price/currency",
      "INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, updated_at) VALUES ('movie', 1, 'BR', 'TestProv', 'rent', 9.90, now())");

    // 16. FK composta episodes(season_id, tv_show_id) -> seasons(id, tv_show_id)
    const tv = (await q<{ id: bigint }>("INSERT INTO tv_shows (tmdb_id, name_original, updated_at) VALUES (999001, 'Test Show', now()) RETURNING id"))[0];
    const tvId = Number(tv.id);
    const season = (await q<{ id: bigint }>(`INSERT INTO seasons (tv_show_id, season_number, updated_at) VALUES (${tvId}, 1, now()) RETURNING id`))[0];
    const seasonId = Number(season.id);
    let positiveOk = false;
    try {
      await exec(`INSERT INTO episodes (season_id, tv_show_id, episode_number, updated_at) VALUES (${seasonId}, ${tvId}, 1, now())`);
      positiveOk = true;
    } catch (e) {
      record(16, "FK composta episodes (positivo)", false, `episodio valido REJEITADO: ${(e as Error).message.split("\n")[0]}`);
    }
    if (positiveOk) {
      try {
        await exec(`INSERT INTO episodes (season_id, tv_show_id, episode_number, updated_at) VALUES (${seasonId}, ${tvId + 1}, 2, now())`);
        record(16, "FK composta episodes(season_id,tv_show_id)", false, "episodio com tv_show_id divergente foi ACEITO");
      } catch (e) {
        record(16, "FK composta episodes(season_id,tv_show_id)", true,
          `valido aceito; divergente barrado: ${(e as Error).message.split("\n")[0].slice(0, 70)}`);
      }
    }

    // 17. episodes sem season_number
    const epSeasonNum = Number((await q<{ c: bigint }>(
      "SELECT count(*) AS c FROM information_schema.columns WHERE table_name='episodes' AND column_name='season_number'",
    ))[0].c);
    record(17, "episodes NAO tem coluna season_number", epSeasonNum === 0, `colunas season_number em episodes: ${epSeasonNum}`);

    // 18. seasons tem season_number
    const seSeasonNum = Number((await q<{ c: bigint }>(
      "SELECT count(*) AS c FROM information_schema.columns WHERE table_name='seasons' AND column_name='season_number'",
    ))[0].c);
    record(18, "seasons TEM coluna season_number", seSeasonNum === 1, `colunas season_number em seasons: ${seSeasonNum}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_validation");

    const env = { ...process.env, DATABASE_URL: url };
    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- checks no banco real ---");
    await runChecks(url);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (started) {
      await pg.stop();
    }
    rmSync(dataDir, { recursive: true, force: true });
    console.log("\n=== Postgres efemero derrubado e dir temporario removido ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Migration + seed validados em PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
