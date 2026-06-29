/**
 * validate-real-postgres.ts — Validacao DESCARTAVEL dos adapters Prisma do
 * Entity Writer (Fase 3B) contra PostgreSQL REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do produto:
 * nunca roda no render, no build de app, nem em producao. Prova, ponta a ponta e
 * com banco real, o fluxo offline do Entity Writer usando os adapters REAIS de
 * `services/entity-writer/src/persistence/*` (que ficam fora do typecheck):
 *
 *   enqueue -> job `queued` -> claim -> payload source -> runner (Gemini FAKE)
 *   -> content_block -> entity_writer_log -> job `completed` com `result_block_id`.
 *
 * Tambem cobre deduplicacao (skip por job ativo e por up-to-date) e arquivamento
 * (regeneracao com `--force` arquiva o bloco `ai` antigo, cria o novo e PRESERVA
 * blocos `human`/`hybrid`).
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO) —
 * o MESMO padrao ja usado por `packages/db/scripts/validate-real-postgres.ts`. A
 * CLI do Prisma (migrate/seed) e resolvida a partir de `@screena/db`, dona do
 * schema; nenhuma migration nova e criada e o schema nao e alterado.
 *
 * Seguranca / regras:
 *  - ZERO rede e ZERO Gemini real: o runner usa `FakeGeminiPort` deterministico.
 *  - NAO ha segredo: o instance efemero usa a senha descartavel "postgres" so
 *    para o processo local; nada disso e producao.
 *  - NENHUM DATABASE_URL e persistido em disco/.env: existe so como variavel de
 *    ambiente em memoria e e SEMPRE mascarado nos logs (postgres:****).
 *  - O Postgres efemero e DERRUBADO e o diretorio temporario REMOVIDO no
 *    bloco `finally`, mesmo em caso de erro.
 *  - Se o embedded-postgres nao funcionar no ambiente, o script PARA e reporta o
 *    erro claramente (check 0 = FAIL, exit 1).
 *
 * Uso: pnpm --filter @screena/entity-writer validate:real
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

import { disconnectPrisma, type PrismaClient } from "@screena/db/server";
import { FakeGeminiPort } from "../src/gemini/fake.js";
import { createEntityWriterPersistence, type EntityWriterPersistence } from "../src/persistence/index.js";
import { enqueueOne, type EnqueueDeps } from "../src/runner/enqueue-jobs.js";
import { processJobs, type RunnerDeps } from "../src/runner/run-jobs.js";

// Resolve a CLI do Prisma e o schema a partir de @screena/db (dona do schema):
// nenhuma migration nova, schema intocado — so aplicamos o que ja existe.
const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // services/entity-writer/scripts
const repoRoot = path.resolve(scriptDir, "..", "..", ".."); // raiz do monorepo
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

// Alvo de teste (pt-BR; en/es ficam fora da fase). Ids altos para nao colidir.
const LANGUAGE = "pt-BR";
const DIRECTOR_NAME = "Ana Lima";
const CAST_NAMES = ["Carlos Souza", "Bruna Dias"];

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
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

/**
 * Cria os dados estruturais minimos de um `movie` (movie + people + cast + crew
 * Director). NAO toca ratings/streaming/i18n — fora do escopo da Fase 3A. O
 * idioma pt-BR ja vem do seed. Retorna o id do movie (string).
 */
async function seedMinimalMovie(prisma: PrismaClient): Promise<string> {
  const director = await prisma.person.create({
    data: { tmdbId: 90000001, name: DIRECTOR_NAME, knownForDepartment: "Directing" },
    select: { id: true },
  });
  const castPeople = await Promise.all(
    CAST_NAMES.map((name, i) =>
      prisma.person.create({
        data: { tmdbId: 90000010 + i, name, knownForDepartment: "Acting" },
        select: { id: true, name: true },
      }),
    ),
  );

  const movie = await prisma.movie.create({
    data: {
      tmdbId: 90010001,
      titleOriginal: "Filme de Teste Screena",
      originalLanguage: null,
      releaseDate: new Date("2021-06-01"),
      runtimeMinutes: 118,
    },
    select: { id: true },
  });

  await prisma.crewMember.create({
    data: {
      personId: director.id,
      entityType: "movie",
      entityId: movie.id,
      department: "Directing",
      job: "Director",
    },
  });
  await Promise.all(
    castPeople.map((person, i) =>
      prisma.castMember.create({
        data: {
          personId: person.id,
          entityType: "movie",
          entityId: movie.id,
          character: `Personagem ${i + 1}`,
          billingOrder: i + 1,
        },
      }),
    ),
  );

  return movie.id.toString();
}

/** Conta blocos do alvo por (reviewStatus, sourceType). */
function blockCounts(
  blocks: readonly { reviewStatus: string; sourceType: string; blockType: string }[],
): { archivedAi: number; aiGenerated: number; published: number; humanReviewed: number } {
  return {
    archivedAi: blocks.filter((b) => b.sourceType === "ai" && b.reviewStatus === "archived").length,
    aiGenerated: blocks.filter((b) => b.sourceType === "ai" && b.reviewStatus === "ai_generated").length,
    published: blocks.filter((b) => b.reviewStatus === "published").length,
    humanReviewed: blocks.filter((b) => b.reviewStatus === "human_reviewed").length,
  };
}

async function runChecks(persistence: EntityWriterPersistence): Promise<void> {
  const prisma = persistence.prisma;
  const noop = (): void => undefined;
  const enqueueDeps: EnqueueDeps = {
    payloadSource: persistence.payloadSource,
    read: persistence.enqueueRead,
    enqueue: persistence.jobEnqueue,
    logger: noop,
  };
  const runnerDeps: RunnerDeps = {
    claim: persistence.claim,
    payloadSource: persistence.payloadSource,
    gemini: new FakeGeminiPort({ mode: "success" }),
    contentBlocks: persistence.contentBlocks,
    logs: persistence.logs,
    jobs: persistence.jobs,
    logger: noop,
  };
  const target = (entityId: string) =>
    ({ entityType: "movie", entityId, languageCode: LANGUAGE }) as const;

  const entityId = await seedMinimalMovie(prisma);
  console.log(`\n--- dados minimos criados: movie id=${entityId} (1 diretor + ${CAST_NAMES.length} no elenco) ---`);

  // 3. Enqueue cria o job (status='queued' no adapter; persistido).
  const enq1 = await enqueueOne(enqueueDeps, { dryRun: false }, target(entityId));
  record(
    3,
    "enqueue cria job (status created, persistido)",
    enq1.status === "created" && enq1.persisted === true && typeof enq1.jobId === "string",
    `status=${enq1.status}, persisted=${enq1.persisted}, jobId=${enq1.jobId ?? "?"}`,
  );
  const jobId = enq1.jobId ?? "";

  // 4. Job existe no banco como 'queued'.
  const queuedJob = await prisma.entityWriterJob.findUnique({
    where: { id: BigInt(jobId) },
    select: { status: true, jobType: true, payloadHash: true },
  });
  record(
    4,
    "job criado como 'queued'",
    queuedJob?.status === "queued" && queuedJob?.jobType === "generate_block",
    `status=${queuedJob?.status}, jobType=${queuedJob?.jobType}, payloadHash=${queuedJob?.payloadHash ? "set" : "null"}`,
  );

  // 5. Dedup A: segundo enqueue com job ativo (sem force) => skip por job ativo.
  const enq2 = await enqueueOne(enqueueDeps, { dryRun: false }, target(entityId));
  record(
    5,
    "dedup: 2o enqueue com job ativo e pulado",
    enq2.status === "skipped_existing_active_job" && enq2.persisted === false,
    `status=${enq2.status}`,
  );

  // 6. Claim "peek" (dry-run) seleciona o job SEM consumi-lo.
  const peeked = await persistence.claim.claimNext({ languageCode: LANGUAGE, dryRun: true });
  const stillQueued = await prisma.entityWriterJob.findUnique({
    where: { id: BigInt(jobId) },
    select: { status: true },
  });
  record(
    6,
    "claim dry-run seleciona o job sem muta-lo",
    peeked?.id === jobId && stillQueued?.status === "queued",
    `peek id=${peeked?.id ?? "null"}, status apos peek=${stillQueued?.status}`,
  );

  // 7. Runner reivindica e processa 1 job com o FakeGeminiPort.
  const summary = await processJobs(runnerDeps, { limit: 1, dryRun: false });
  const report = summary.jobs[0];
  record(
    7,
    "runner reivindica e processa 1 job (fake)",
    summary.claimed === 1 && summary.persisted === 1 && report?.outcome === "succeeded",
    `claimed=${summary.claimed}, persisted=${summary.persisted}, outcome=${report?.outcome}`,
  );

  // 8/9. Job finalizado 'completed' com result_block_id preenchido.
  const doneJob = await prisma.entityWriterJob.findUnique({
    where: { id: BigInt(jobId) },
    select: { status: true, resultBlockId: true, completedAt: true },
  });
  record(8, "job finalizado como 'completed'", doneJob?.status === "completed", `status=${doneJob?.status}`);
  const resultBlockId = doneJob?.resultBlockId ?? null;
  record(9, "job.result_block_id preenchido", resultBlockId !== null, `resultBlockId=${resultBlockId?.toString() ?? "null"}`);

  // 10. >= 1 content_block criado para o alvo.
  const blocks = await prisma.contentBlock.findMany({
    where: { entityType: "movie", entityId: BigInt(entityId), languageCode: LANGUAGE },
    select: { id: true, blockType: true, reviewStatus: true, sourceType: true, modelProvider: true },
  });
  record(10, "pelo menos 1 content_block criado", blocks.length >= 1, `blocos=${blocks.length} (${blocks.map((b) => b.blockType).join(", ")})`);

  // 11/12/13. O bloco apontado por result_block_id: real, sourceType=ai, ai_generated.
  const resultBlock = resultBlockId === null ? null : blocks.find((b) => b.id === resultBlockId) ?? null;
  record(13, "result_block_id aponta para um content_block real", resultBlock !== null, `bloco encontrado=${resultBlock !== null}`);
  record(11, "result block tem sourceType='ai'", resultBlock?.sourceType === "ai", `sourceType=${resultBlock?.sourceType}`);
  record(
    12,
    "result block tem reviewStatus='ai_generated'",
    resultBlock?.reviewStatus === "ai_generated",
    `reviewStatus=${resultBlock?.reviewStatus}`,
  );

  // 14. Log criado em entity_writer_logs para o job.
  const logCount = await prisma.entityWriterLog.count({ where: { jobId: BigInt(jobId) } });
  record(14, "log criado em entity_writer_logs", logCount >= 1, `logs do job=${logCount}`);

  // 15/16. Nenhum bloco 'published' nem 'human_reviewed' (publicacao nunca automatica).
  const c1 = blockCounts(blocks);
  record(15, "nenhum bloco 'published'", c1.published === 0, `published=${c1.published}`);
  record(16, "nenhum bloco 'human_reviewed'", c1.humanReviewed === 0, `human_reviewed=${c1.humanReviewed}`);

  // 17. Dedup B: enqueue sem force, sem job ativo e com blocos atualizados => up-to-date.
  const enq3 = await enqueueOne(enqueueDeps, { dryRun: false }, target(entityId));
  record(
    17,
    "dedup: enqueue up-to-date (sem force) e pulado",
    enq3.status === "skipped_up_to_date" && enq3.persisted === false,
    `status=${enq3.status}`,
  );

  // ----------------------------------------------------------------------
  // Arquivamento (regeneracao com --force): bloco 'ai' antigo arquivado, novo
  // criado, e bloco 'human' (decisao humana) PRESERVADO.
  // ----------------------------------------------------------------------

  // Bloco sentinela 'human' (estado pre-existente legitimo, criado por humano).
  const sentinel = await prisma.contentBlock.create({
    data: {
      entityType: "movie",
      entityId: BigInt(entityId),
      languageCode: LANGUAGE,
      blockType: "editorial_intro",
      content: "Introducao editorial revisada manualmente (sentinela).",
      sourceType: "human",
      promptVersion: "manual",
      inputHash: "manual-sentinel",
      outputHash: "manual-sentinel",
      reviewStatus: "draft",
    },
    select: { id: true },
  });

  // 18. Enqueue com force => cria job de regeneracao.
  const enqForce = await enqueueOne(enqueueDeps, { dryRun: false }, { ...target(entityId), force: true });
  record(
    18,
    "enqueue --force cria job de regeneracao",
    enqForce.status === "created" && enqForce.jobType === "regenerate_block",
    `status=${enqForce.status}, jobType=${enqForce.jobType}`,
  );
  const regenJobId = enqForce.jobId ?? "";

  // 19. Runner processa a regeneracao.
  const summary2 = await processJobs(runnerDeps, { limit: 1, dryRun: false });
  const regenJob = await prisma.entityWriterJob.findUnique({
    where: { id: BigInt(regenJobId) },
    select: { status: true, resultBlockId: true },
  });
  record(
    19,
    "runner processa a regeneracao (job completed)",
    summary2.claimed === 1 && regenJob?.status === "completed",
    `claimed=${summary2.claimed}, status=${regenJob?.status}`,
  );

  // Estado final dos blocos do alvo.
  const blocks2 = await prisma.contentBlock.findMany({
    where: { entityType: "movie", entityId: BigInt(entityId), languageCode: LANGUAGE },
    select: { id: true, blockType: true, reviewStatus: true, sourceType: true },
  });
  const c2 = blockCounts(blocks2);
  const editorialAiActive = blocks2.filter(
    (b) => b.blockType === "editorial_intro" && b.sourceType === "ai" && b.reviewStatus === "ai_generated",
  );

  // 20. Blocos 'ai' antigos (editorial_intro + cast_intro) foram arquivados.
  record(
    20,
    "bloco 'ai' antigo foi arquivado na regeneracao",
    c2.archivedAi >= 2,
    `blocos ai arquivados=${c2.archivedAi}`,
  );

  // 21. Novo bloco 'ai' editorial_intro criado e ativo (exatamente 1).
  const newEditorialIsResult = regenJob?.resultBlockId != null && editorialAiActive.some((b) => b.id === regenJob.resultBlockId);
  record(
    21,
    "novo bloco 'ai' editorial_intro criado (ai_generated)",
    editorialAiActive.length === 1 && newEditorialIsResult,
    `editorial ai ativos=${editorialAiActive.length}, e o result_block=${newEditorialIsResult}`,
  );

  // 22. Bloco 'human' (sentinela) NAO foi arquivado.
  const sentinelAfter = await prisma.contentBlock.findUnique({
    where: { id: sentinel.id },
    select: { reviewStatus: true, sourceType: true },
  });
  record(
    22,
    "bloco 'human' NAO e arquivado (decisao humana preservada)",
    sentinelAfter?.reviewStatus === "draft" && sentinelAfter?.sourceType === "human",
    `sentinela: sourceType=${sentinelAfter?.sourceType}, reviewStatus=${sentinelAfter?.reviewStatus}`,
  );

  // 23. Ainda nenhum 'published'/'human_reviewed' produzido pelo writer.
  record(
    23,
    "writer nunca produz 'published'/'human_reviewed'",
    c2.published === 0 && c2.humanReviewed === 0,
    `published=${c2.published}, human_reviewed=${c2.humanReviewed}`,
  );
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-ew-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_ew_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_ew_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let persistence: EntityWriterPersistence | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_ew_validation");

    // DATABASE_URL so em memoria (nunca em disco/.env); o singleton do Prisma o le.
    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy (schema existente; sem migration nova) ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (seed existente: idiomas, paises, fontes) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- fluxo do Entity Writer no banco real (adapters Prisma) ---");
    persistence = createEntityWriterPersistence();
    await runChecks(persistence);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (persistence) {
      await disconnectPrisma();
    }
    if (started) {
      await pg.stop();
    }
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATABASE_URL;
    console.log("\n=== Postgres efemero derrubado e dir temporario removido ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Adapters Prisma do Entity Writer validados em PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
