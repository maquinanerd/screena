/**
 * staging-seed.ts — Harness de SEED CONTROLADO de staging (linha de comando).
 *
 * FERRAMENTA OPERACIONAL, FORA DO RUNTIME DO ADMIN. Nao e importada por nenhuma
 * pagina/componente; nao entra no bundle de render. E a UNICA superficie com
 * escrita Prisma desta fase — e mesmo assim, so escreve sob confirmacao dupla.
 *
 * SEGURANCA (fail closed):
 *  - DRY-RUN por padrao: rodar sem flags NUNCA escreve; apenas imprime o plano.
 *  - Escrita (apply/cleanup) exige DUAS confirmacoes: a flag `--apply`/`--cleanup`
 *    MAIS a env `SCREEN_STAGING_SEED_CONFIRM=APPLY_STAGING_SEED`.
 *  - PRODUCAO REAL aborta: se o ambiente for production (VERCEL_ENV/NODE_ENV),
 *    apply/cleanup abortam. (Preview/staging e o alvo previsto.)
 *  - Sem `DATABASE_URL` aborta.
 *  - SEM API externa: nao chama TMDB, Gemini, WordPress, RSSPRIME nem endpoints
 *    publicos. So escreve no PostgreSQL local via `@screena/db/server`.
 *
 * IDENTIFICAVEL / REVERSIVEL:
 *  - Todo registro criado leva marcador inequivoco: slug com prefixo
 *    `screen-staging-seed-`, `tmdb_id` na faixa sentinela e `content` iniciado por
 *    `[STAGING SEED]`.
 *  - `--cleanup` (com a mesma confirmacao dupla) remove SOMENTE registros com esse
 *    marcador — nunca toca conteudo editorial real.
 *
 * DETERMINISTICO: o plano vem de `buildStagingSeedPlan()` (puro, sem
 * random/`Date.now`). A unica data usada e a data fixa de referencia do plano.
 *
 * PRE-CONDICAO: apply/cleanup exigem que o idioma `pt-BR` exista em `languages`
 * (FK). Se ausente, aborta com mensagem clara (nunca escreve pela metade).
 *
 * Uso (a partir da raiz do monorepo):
 *   # dry-run (padrao, nao escreve):
 *   pnpm --filter @screena/db exec tsx apps/admin/scripts/staging-seed.ts
 *   # apply (escreve em staging, NUNCA em producao):
 *   SCREEN_STAGING_SEED_CONFIRM=APPLY_STAGING_SEED pnpm --filter @screena/db exec \
 *     tsx apps/admin/scripts/staging-seed.ts --apply
 *   # cleanup (remove so registros marcados):
 *   SCREEN_STAGING_SEED_CONFIRM=APPLY_STAGING_SEED pnpm --filter @screena/db exec \
 *     tsx apps/admin/scripts/staging-seed.ts --cleanup
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildStagingSeedPlan,
  formatSeedPlan,
  parseSeedFlags,
  resolveSeedMode,
  STAGING_SEED_CONFIRM_ENV,
  STAGING_SEED_LANGUAGE,
  STAGING_SEED_MARKER,
  STAGING_SEED_SLUG_PREFIX,
  type SeedContentBlock,
  type SeedEnvInput,
  type StagingSeedPlan,
} from "../src/lib/staging-seed-plan";

const ENTITY_TYPE = "movie";
const SEED_PROMPT_VERSION = "staging-seed";

/** Prisma tipado minimamente (resolvido por import dinamico em runtime). */
interface PrismaLike {
  language: { findUnique: (args: unknown) => Promise<{ code: string } | null> };
  movie: {
    upsert: (args: unknown) => Promise<{ id: bigint }>;
    findMany: (args: unknown) => Promise<Array<{ id: bigint }>>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  slug: {
    upsert: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  entityTranslation: {
    upsert: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  contentBlock: {
    findFirst: (args: unknown) => Promise<{ id: bigint } | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
}

interface DbModule {
  getPrismaClient: () => PrismaLike;
  disconnectPrisma: () => Promise<void>;
}

/** Carrega o .env da raiz do monorepo (best-effort), como o seed dev do apps/web. */
function loadRepoEnv(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/admin/scripts
  const repoRoot = path.resolve(scriptDir, "..", "..", "..");
  const envPath = path.join(repoRoot, ".env");
  if (typeof process.loadEnvFile === "function" && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

/** Aplica UM bloco de conteudo de forma idempotente (atualiza o ativo ou cria). */
async function upsertBlock(
  prisma: PrismaLike,
  entityId: bigint,
  block: SeedContentBlock,
): Promise<void> {
  const existing = await prisma.contentBlock.findFirst({
    where: {
      entityType: ENTITY_TYPE,
      entityId,
      languageCode: STAGING_SEED_LANGUAGE,
      blockType: block.blockType,
      reviewStatus: { not: "archived" },
    },
    select: { id: true },
  });
  if (existing !== null) {
    await prisma.contentBlock.update({
      where: { id: existing.id },
      data: { content: block.content, reviewStatus: block.reviewStatus, sourceType: "human" },
    });
    return;
  }
  await prisma.contentBlock.create({
    data: {
      entityType: ENTITY_TYPE,
      entityId,
      languageCode: STAGING_SEED_LANGUAGE,
      blockType: block.blockType,
      content: block.content,
      sourceType: "human",
      modelProvider: null,
      modelName: null,
      promptVersion: SEED_PROMPT_VERSION,
      inputHash: SEED_PROMPT_VERSION,
      outputHash: SEED_PROMPT_VERSION,
      reviewStatus: block.reviewStatus,
    },
  });
}

/** Aplica o plano de seed de forma idempotente. Retorna contagem de filmes. */
async function applyPlan(prisma: PrismaLike, plan: StagingSeedPlan): Promise<number> {
  const releaseDate = new Date(plan.referenceDate);
  for (const movie of plan.movies) {
    const created = await prisma.movie.upsert({
      where: { tmdbId: movie.tmdbId },
      update: { titleOriginal: movie.titleOriginal, releaseDate },
      create: { tmdbId: movie.tmdbId, titleOriginal: movie.titleOriginal, releaseDate },
      select: { id: true },
    });
    const entityId = created.id;

    await prisma.slug.upsert({
      where: {
        entityType_languageCode_slug: {
          entityType: ENTITY_TYPE,
          languageCode: movie.languageCode,
          slug: movie.slug,
        },
      },
      update: { entityId, isCanonical: true },
      create: {
        entityType: ENTITY_TYPE,
        entityId,
        languageCode: movie.languageCode,
        slug: movie.slug,
        isCanonical: true,
      },
    });

    await prisma.entityTranslation.upsert({
      where: {
        entityType_entityId_languageCode: {
          entityType: ENTITY_TYPE,
          entityId,
          languageCode: movie.languageCode,
        },
      },
      update: { title: movie.titlePt },
      create: {
        entityType: ENTITY_TYPE,
        entityId,
        languageCode: movie.languageCode,
        title: movie.titlePt,
      },
    });

    for (const block of movie.blocks) {
      await upsertBlock(prisma, entityId, block);
    }
  }
  return plan.movies.length;
}

/** Remove SOMENTE registros marcados do seed (sentinela + prefixo + marcador). */
async function cleanupPlan(prisma: PrismaLike, plan: StagingSeedPlan): Promise<number> {
  const tmdbIds = plan.movies.map((movie) => movie.tmdbId);
  const movies = await prisma.movie.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: { id: true },
  });
  const ids = movies.map((movie) => movie.id);
  if (ids.length === 0) return 0;

  await prisma.contentBlock.deleteMany({
    where: {
      entityType: ENTITY_TYPE,
      entityId: { in: ids },
      content: { startsWith: STAGING_SEED_MARKER },
    },
  });
  await prisma.entityTranslation.deleteMany({
    where: { entityType: ENTITY_TYPE, entityId: { in: ids } },
  });
  await prisma.slug.deleteMany({
    where: {
      entityType: ENTITY_TYPE,
      entityId: { in: ids },
      slug: { startsWith: STAGING_SEED_SLUG_PREFIX },
    },
  });
  const removed = await prisma.movie.deleteMany({ where: { tmdbId: { in: tmdbIds } } });
  return removed.count;
}

/** Imprime a nota de reversao manual (mesmo quando cleanup existe). */
function printReversalNote(plan: StagingSeedPlan): void {
  console.log("Reversao:");
  console.log(
    `  --cleanup (mesma confirmacao dupla) remove SO registros marcados: tmdb ${plan.movies
      .map((movie) => movie.tmdbId)
      .join(", ")}, slugs com prefixo ${STAGING_SEED_SLUG_PREFIX}.`,
  );
  console.log("  Reversao manual equivalente: apagar exatamente esses registros marcados.");
}

async function main(): Promise<void> {
  loadRepoEnv();

  const flags = parseSeedFlags(process.argv.slice(2));
  const env: SeedEnvInput = {
    confirmValue: process.env[STAGING_SEED_CONFIRM_ENV],
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    hasDatabaseUrl:
      typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim() !== "",
  };
  const decision = resolveSeedMode(flags, env);
  const plan = buildStagingSeedPlan();

  console.log("== Screen · Staging Seed Harness ==");
  console.log(`Modo: ${decision.mode}`);
  console.log(`Motivo: ${decision.reason}`);
  for (const line of formatSeedPlan(plan)) console.log(line);

  if (decision.mode === "dry-run") {
    console.log("Dry-run: NADA foi escrito. Para aplicar, use --apply com a confirmacao dupla.");
    printReversalNote(plan);
    return;
  }

  if (decision.mode === "abort") {
    console.error(`Abortado: ${decision.reason}`);
    process.exitCode = 1;
    return;
  }

  const dbModule = (await import("@screena/db/server")) as unknown as DbModule;
  const prisma = dbModule.getPrismaClient();
  try {
    const language = await prisma.language.findUnique({
      where: { code: STAGING_SEED_LANGUAGE },
      select: { code: true },
    });
    if (language === null) {
      console.error(
        `Abortado: idioma ${STAGING_SEED_LANGUAGE} ausente em 'languages'. Rode o seed base do banco antes.`,
      );
      process.exitCode = 1;
      return;
    }

    if (decision.mode === "apply") {
      const count = await applyPlan(prisma, plan);
      console.log(`Apply concluido: ${count} filmes de staging aplicados (idempotente).`);
      printReversalNote(plan);
    } else {
      const count = await cleanupPlan(prisma, plan);
      console.log(`Cleanup concluido: ${count} filmes marcados removidos.`);
    }
  } finally {
    await dbModule.disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("Falha no harness de seed de staging:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
