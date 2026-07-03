/**
 * public-demo-seed.ts — Harness de SEED DEMO PUBLICO (Fase 9A, linha de comando).
 *
 * FERRAMENTA OPERACIONAL, FORA DO RUNTIME DO ADMIN. Nao e importada por nenhuma
 * pagina/componente; nao entra no bundle de render. Serve para o slice publico
 * (filmes/series/pessoas) ter conteudo controlado suficiente para APARECER no
 * site local/staging: cards com poster, detalhe com sinopse editorial, elenco e
 * "onde assistir".
 *
 * SEGURANCA (fail closed):
 *  - DRY-RUN por padrao: rodar sem flags NUNCA escreve; apenas imprime o plano.
 *  - Escrita (apply/cleanup) exige DUAS confirmacoes: a flag `--apply`/`--cleanup`
 *    MAIS a env `SCREEN_PUBLIC_DEMO_SEED_CONFIRM=APPLY_PUBLIC_DEMO_SEED`.
 *  - PRODUCAO REAL aborta (VERCEL_ENV/NODE_ENV). Sem `DATABASE_URL` aborta.
 *  - SEM API externa: nao chama TMDB, Gemini nem qualquer endpoint. So escreve no
 *    PostgreSQL local via `@screena/db/server`.
 *
 * IDENTIFICAVEL / REVERSIVEL:
 *  - Slugs com prefixo `demo-`, `tmdb_id` na faixa sentinela, `content` iniciado
 *    por `[PUBLIC DEMO SEED]`, watch com `provider_api=public-demo-seed` e cast
 *    com `credit_id` prefixado `demo-cast-`.
 *  - `--cleanup` (mesma confirmacao dupla) remove SOMENTE esses registros marcados.
 *
 * Uso (a partir da raiz do monorepo):
 *   # dry-run (padrao, nao escreve):
 *   pnpm --filter @screena/db exec tsx apps/admin/scripts/public-demo-seed.ts
 *   # apply (LOCAL/staging, NUNCA producao):
 *   SCREEN_PUBLIC_DEMO_SEED_CONFIRM=APPLY_PUBLIC_DEMO_SEED pnpm --filter @screena/db exec \
 *     tsx apps/admin/scripts/public-demo-seed.ts --apply
 *   # cleanup (remove so registros marcados):
 *   SCREEN_PUBLIC_DEMO_SEED_CONFIRM=APPLY_PUBLIC_DEMO_SEED pnpm --filter @screena/db exec \
 *     tsx apps/admin/scripts/public-demo-seed.ts --cleanup
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPublicDemoSeedPlan,
  formatPublicDemoPlan,
  parsePublicDemoFlags,
  resolvePublicDemoMode,
  PUBLIC_DEMO_CONFIRM_ENV,
  PUBLIC_DEMO_COUNTRY,
  PUBLIC_DEMO_CREDIT_PREFIX,
  PUBLIC_DEMO_LANGUAGE,
  PUBLIC_DEMO_MARKER,
  PUBLIC_DEMO_SLUG_PREFIX,
  PUBLIC_DEMO_WATCH_PROVIDER_API,
  type PublicDemoBlock,
  type PublicDemoEnvInput,
  type PublicDemoSeedPlan,
} from "./public-demo-seed-plan";

const SEED_PROMPT_VERSION = "public-demo-seed";

/** Prisma tipado minimamente (resolvido por import dinamico em runtime). */
interface EntityModel {
  upsert: (args: unknown) => Promise<{ id: bigint }>;
  findMany: (args: unknown) => Promise<Array<{ id: bigint }>>;
  deleteMany: (args: unknown) => Promise<{ count: number }>;
}

interface PrismaLike {
  language: { findUnique: (args: unknown) => Promise<{ code: string } | null> };
  country: { findUnique: (args: unknown) => Promise<{ code: string } | null> };
  movie: EntityModel;
  tvShow: EntityModel;
  person: EntityModel;
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
  castMember: {
    upsert: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  watchAvailability: {
    create: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
}

interface DbModule {
  getPrismaClient: () => PrismaLike;
  disconnectPrisma: () => Promise<void>;
}

/** Carrega o .env da raiz do monorepo (best-effort), como os demais seeds. */
function loadRepoEnv(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/admin/scripts
  const repoRoot = path.resolve(scriptDir, "..", "..", "..");
  const envPath = path.join(repoRoot, ".env");
  if (typeof process.loadEnvFile === "function" && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

/** Upsert idempotente de slug canonico pt-BR. */
async function upsertSlug(
  prisma: PrismaLike,
  entityType: string,
  entityId: bigint,
  slug: string,
): Promise<void> {
  await prisma.slug.upsert({
    where: {
      entityType_languageCode_slug: {
        entityType,
        languageCode: PUBLIC_DEMO_LANGUAGE,
        slug,
      },
    },
    update: { entityId, isCanonical: true },
    create: {
      entityType,
      entityId,
      languageCode: PUBLIC_DEMO_LANGUAGE,
      slug,
      isCanonical: true,
    },
  });
}

/** Upsert idempotente da traducao pt-BR (title/meta/summary). */
async function upsertTranslation(
  prisma: PrismaLike,
  entityType: string,
  entityId: bigint,
  data: {
    title: string;
    metaTitle?: string | null;
    metaDescription?: string | null;
    summary?: string | null;
  },
): Promise<void> {
  await prisma.entityTranslation.upsert({
    where: {
      entityType_entityId_languageCode: {
        entityType,
        entityId,
        languageCode: PUBLIC_DEMO_LANGUAGE,
      },
    },
    update: {
      title: data.title,
      metaTitle: data.metaTitle ?? null,
      metaDescription: data.metaDescription ?? null,
      summary: data.summary ?? null,
    },
    create: {
      entityType,
      entityId,
      languageCode: PUBLIC_DEMO_LANGUAGE,
      title: data.title,
      metaTitle: data.metaTitle ?? null,
      metaDescription: data.metaDescription ?? null,
      summary: data.summary ?? null,
    },
  });
}

/** Aplica UM content_block de forma idempotente (atualiza o ativo ou cria). */
async function upsertBlock(
  prisma: PrismaLike,
  entityType: string,
  entityId: bigint,
  block: PublicDemoBlock,
): Promise<void> {
  const existing = await prisma.contentBlock.findFirst({
    where: {
      entityType,
      entityId,
      languageCode: PUBLIC_DEMO_LANGUAGE,
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
      entityType,
      entityId,
      languageCode: PUBLIC_DEMO_LANGUAGE,
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

/** Substitui (delete+create) as ofertas legais de "onde assistir" do demo. */
async function replaceWatch(
  prisma: PrismaLike,
  entityType: string,
  entityId: bigint,
  offers: ReadonlyArray<{ providerName: string; offerType: string }>,
  fetchedAtIso: string,
): Promise<void> {
  await prisma.watchAvailability.deleteMany({
    where: { entityType, entityId, providerApi: PUBLIC_DEMO_WATCH_PROVIDER_API },
  });
  const fetchedAt = new Date(fetchedAtIso);
  for (const offer of offers) {
    await prisma.watchAvailability.create({
      data: {
        entityType,
        entityId,
        countryCode: PUBLIC_DEMO_COUNTRY,
        providerName: offer.providerName,
        offerType: offer.offerType,
        displayAllowed: true,
        providerApi: PUBLIC_DEMO_WATCH_PROVIDER_API,
        fetchedAt,
      },
    });
  }
}

/** Aplica o plano de seed demo de forma idempotente. Retorna a contagem. */
async function applyPlan(prisma: PrismaLike, plan: PublicDemoSeedPlan): Promise<PublicDemoSeedPlan["recordCount"]> {
  const movieIdByKey = new Map<string, bigint>();
  for (const movie of plan.movies) {
    const created = await prisma.movie.upsert({
      where: { tmdbId: movie.tmdbId },
      update: {
        titleOriginal: movie.titleOriginal,
        releaseDate: new Date(movie.releaseDateIso),
        runtimeMinutes: movie.runtimeMinutes,
        status: movie.status,
        posterPath: movie.posterPath,
        backdropPath: movie.backdropPath,
      },
      create: {
        tmdbId: movie.tmdbId,
        titleOriginal: movie.titleOriginal,
        releaseDate: new Date(movie.releaseDateIso),
        runtimeMinutes: movie.runtimeMinutes,
        status: movie.status,
        posterPath: movie.posterPath,
        backdropPath: movie.backdropPath,
      },
      select: { id: true },
    });
    movieIdByKey.set(movie.key, created.id);
    await upsertSlug(prisma, "movie", created.id, movie.slug);
    await upsertTranslation(prisma, "movie", created.id, {
      title: movie.titlePt,
      metaTitle: movie.metaTitlePt,
      metaDescription: movie.metaDescriptionPt,
      summary: movie.summaryPt,
    });
    for (const block of movie.blocks) await upsertBlock(prisma, "movie", created.id, block);
    await replaceWatch(prisma, "movie", created.id, movie.watch, movie.watchFetchedAtIso);
  }

  const seriesIdByKey = new Map<string, bigint>();
  for (const show of plan.series) {
    const created = await prisma.tvShow.upsert({
      where: { tmdbId: show.tmdbId },
      update: {
        nameOriginal: show.nameOriginal,
        firstAirDate: new Date(show.firstAirDateIso),
        lastAirDate: show.lastAirDateIso === null ? null : new Date(show.lastAirDateIso),
        status: show.status,
        numberOfSeasons: show.numberOfSeasons,
        numberOfEpisodes: show.numberOfEpisodes,
        posterPath: show.posterPath,
        backdropPath: show.backdropPath,
      },
      create: {
        tmdbId: show.tmdbId,
        nameOriginal: show.nameOriginal,
        firstAirDate: new Date(show.firstAirDateIso),
        lastAirDate: show.lastAirDateIso === null ? null : new Date(show.lastAirDateIso),
        status: show.status,
        numberOfSeasons: show.numberOfSeasons,
        numberOfEpisodes: show.numberOfEpisodes,
        posterPath: show.posterPath,
        backdropPath: show.backdropPath,
      },
      select: { id: true },
    });
    seriesIdByKey.set(show.key, created.id);
    await upsertSlug(prisma, "tv", created.id, show.slug);
    await upsertTranslation(prisma, "tv", created.id, {
      title: show.namePt,
      metaTitle: show.metaTitlePt,
      metaDescription: show.metaDescriptionPt,
      summary: show.summaryPt,
    });
    for (const block of show.blocks) await upsertBlock(prisma, "tv", created.id, block);
    await replaceWatch(prisma, "tv", created.id, show.watch, show.watchFetchedAtIso);
  }

  const personIdByKey = new Map<string, bigint>();
  for (const person of plan.people) {
    const created = await prisma.person.upsert({
      where: { tmdbId: person.tmdbId },
      update: {
        name: person.name,
        knownForDepartment: person.knownForDepartment,
        profilePath: person.profilePath,
      },
      create: {
        tmdbId: person.tmdbId,
        name: person.name,
        knownForDepartment: person.knownForDepartment,
        profilePath: person.profilePath,
      },
      select: { id: true },
    });
    personIdByKey.set(person.key, created.id);
    await upsertSlug(prisma, "person", created.id, person.slug);
    await upsertTranslation(prisma, "person", created.id, { title: person.name });
    for (const block of person.blocks) await upsertBlock(prisma, "person", created.id, block);
  }

  for (const link of plan.cast) {
    const personId = personIdByKey.get(link.personKey);
    const targetId =
      link.targetKind === "movie"
        ? movieIdByKey.get(link.targetKey)
        : seriesIdByKey.get(link.targetKey);
    if (personId === undefined || targetId === undefined) continue;
    await prisma.castMember.upsert({
      where: { creditId: link.creditId },
      update: {
        personId,
        entityType: link.targetKind,
        entityId: targetId,
        character: link.character,
        billingOrder: link.billingOrder,
      },
      create: {
        creditId: link.creditId,
        personId,
        entityType: link.targetKind,
        entityId: targetId,
        character: link.character,
        billingOrder: link.billingOrder,
      },
    });
  }

  return plan.recordCount;
}

/** IDs de uma tabela-raiz cujos `tmdb_id` estao na lista sentinela. */
async function sentinelIds(model: EntityModel, tmdbIds: number[]): Promise<bigint[]> {
  if (tmdbIds.length === 0) return [];
  const rows = await model.findMany({ where: { tmdbId: { in: tmdbIds } }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** Remove SOMENTE registros marcados do seed (sentinela + prefixo + marcador). */
async function cleanupPlan(prisma: PrismaLike, plan: PublicDemoSeedPlan): Promise<number> {
  // Vinculos polimorficos primeiro (marcados de forma inequivoca).
  await prisma.castMember.deleteMany({
    where: { creditId: { startsWith: PUBLIC_DEMO_CREDIT_PREFIX } },
  });
  await prisma.watchAvailability.deleteMany({
    where: { providerApi: PUBLIC_DEMO_WATCH_PROVIDER_API },
  });

  let removed = 0;
  const targets: Array<{ model: EntityModel; entityType: string; tmdbIds: number[] }> = [
    { model: prisma.movie, entityType: "movie", tmdbIds: plan.movies.map((m) => m.tmdbId) },
    { model: prisma.tvShow, entityType: "tv", tmdbIds: plan.series.map((s) => s.tmdbId) },
    { model: prisma.person, entityType: "person", tmdbIds: plan.people.map((p) => p.tmdbId) },
  ];

  for (const target of targets) {
    const ids = await sentinelIds(target.model, target.tmdbIds);
    if (ids.length === 0) continue;
    await prisma.contentBlock.deleteMany({
      where: {
        entityType: target.entityType,
        entityId: { in: ids },
        content: { startsWith: PUBLIC_DEMO_MARKER },
      },
    });
    await prisma.entityTranslation.deleteMany({
      where: { entityType: target.entityType, entityId: { in: ids } },
    });
    await prisma.slug.deleteMany({
      where: {
        entityType: target.entityType,
        entityId: { in: ids },
        slug: { startsWith: PUBLIC_DEMO_SLUG_PREFIX },
      },
    });
    const deleted = await target.model.deleteMany({ where: { tmdbId: { in: target.tmdbIds } } });
    removed += deleted.count;
  }
  return removed;
}

/** Nota de reversao manual (mesmo com cleanup disponivel). */
function printReversalNote(plan: PublicDemoSeedPlan): void {
  console.log("Reversao:");
  console.log(
    `  --cleanup (mesma confirmacao dupla) remove SO registros marcados: slugs com prefixo ${plan.slugPrefix}, tmdb sentinela ${plan.tmdbIdBase}.., watch ${plan.watchProviderApi}, cast ${plan.creditPrefix}.`,
  );
}

async function main(): Promise<void> {
  loadRepoEnv();

  const flags = parsePublicDemoFlags(process.argv.slice(2));
  const env: PublicDemoEnvInput = {
    confirmValue: process.env[PUBLIC_DEMO_CONFIRM_ENV],
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    hasDatabaseUrl:
      typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim() !== "",
  };
  const decision = resolvePublicDemoMode(flags, env);
  const plan = buildPublicDemoSeedPlan();

  console.log("== Screen · Public Demo Seed Harness ==");
  console.log(`Modo: ${decision.mode}`);
  console.log(`Motivo: ${decision.reason}`);
  for (const line of formatPublicDemoPlan(plan)) console.log(line);

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
    const [language, country] = await Promise.all([
      prisma.language.findUnique({ where: { code: PUBLIC_DEMO_LANGUAGE }, select: { code: true } }),
      prisma.country.findUnique({ where: { code: PUBLIC_DEMO_COUNTRY }, select: { code: true } }),
    ]);
    if (language === null || country === null) {
      console.error(
        `Abortado: idioma ${PUBLIC_DEMO_LANGUAGE} e/ou pais ${PUBLIC_DEMO_COUNTRY} ausentes nas tabelas-semente. Rode o seed base do banco antes.`,
      );
      process.exitCode = 1;
      return;
    }

    if (decision.mode === "apply") {
      const count = await applyPlan(prisma, plan);
      console.log(
        `Apply concluido (idempotente): ${count.movies} filmes, ${count.series} series, ${count.people} pessoas, ${count.castLinks} creditos, ${count.watchOffers} ofertas.`,
      );
      printReversalNote(plan);
    } else {
      const count = await cleanupPlan(prisma, plan);
      console.log(`Cleanup concluido: ${count} entidades marcadas removidas (com seus vinculos).`);
    }
  } finally {
    await dbModule.disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Falha no harness de seed demo publico:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
