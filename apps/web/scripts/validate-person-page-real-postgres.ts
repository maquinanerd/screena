/**
 * validate-person-page-real-postgres.ts - Validacao descartavel da pagina
 * publica de pessoa contra PostgreSQL real efemero.
 *
 * Prova o fluxo:
 *   slug pt-BR -> person -> entity_translation -> content_blocks ->
 *   cast/crew -> alvos movie|tv (titulo + slug) -> presenter -> indexabilidade.
 *
 * Nao sobe Next, nao chama rede, nao chama TMDB/Gemini e nao altera schema.
 * Imagem: file_path cru do TMDB ("/abc.jpg") vira URL REMOTA do CDN do TMDB;
 * path local (demo) permanece local; externo/invalido -> null.
 *
 * Uso: pnpm --filter @screena/web validate:person-page
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: CheckResult[] = [];

function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} - ${detail}`);
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
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

type PrismaLike = {
  person: { create: (args: unknown) => Promise<{ id: bigint }> };
  movie: { create: (args: unknown) => Promise<{ id: bigint }> };
  tvShow: { create: (args: unknown) => Promise<{ id: bigint }> };
  castMember: { create: (args: unknown) => Promise<unknown> };
  crewMember: { create: (args: unknown) => Promise<unknown> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  contentBlock: { create: (args: unknown) => Promise<unknown> };
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: { create: (args: unknown) => Promise<unknown> };
  entityNewsLink: { create: (args: unknown) => Promise<unknown> };
};

/** Cria um Article publicavel|rascunho + traducao pt-BR + link para uma entidade. */
async function seedRelatedArticle(
  prisma: PrismaLike,
  opts: { slug: string; title: string; reviewStatus: string; entityType: string; entityId: bigint; indexStatus?: string },
): Promise<void> {
  const article = await prisma.article.create({
    data: {
      licenseStatus: "official",
      displayAllowed: true,
      publishedAt: new Date("2026-06-30T12:00:00.000Z"),
    },
    select: { id: true },
  });
  await prisma.articleTranslation.create({
    data: {
      articleId: article.id,
      languageCode: LANGUAGE,
      slug: opts.slug,
      title: opts.title,
      body: "Corpo editorial proprio e substancial. ".repeat(8),
      reviewStatus: opts.reviewStatus,
      indexStatus: opts.indexStatus ?? "index",
      publishedAt: new Date("2026-06-30T12:00:00.000Z"),
    },
  });
  await prisma.entityNewsLink.create({
    data: { articleId: article.id, entityType: opts.entityType, entityId: opts.entityId },
  });
}

async function createSlug(
  prisma: PrismaLike,
  entityType: string,
  entityId: bigint,
  slug: string,
  isCanonical: boolean,
): Promise<void> {
  await prisma.slug.create({
    data: { entityType, entityId, languageCode: LANGUAGE, slug, isCanonical },
  });
}

async function seedMovieTarget(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    titleOriginal: string;
    releaseDate: Date | null;
    translationTitle?: string | null;
    canonicalSlug?: string;
  },
): Promise<bigint> {
  const movie = await prisma.movie.create({
    data: {
      tmdbId: opts.tmdbId,
      titleOriginal: opts.titleOriginal,
      releaseDate: opts.releaseDate,
    },
    select: { id: true },
  });
  if (opts.canonicalSlug !== undefined) {
    await createSlug(prisma, "movie", movie.id, opts.canonicalSlug, true);
  }
  if (opts.translationTitle !== undefined) {
    await prisma.entityTranslation.create({
      data: {
        entityType: "movie",
        entityId: movie.id,
        languageCode: LANGUAGE,
        title: opts.translationTitle,
      },
    });
  }
  return movie.id;
}

async function seedTvTarget(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    nameOriginal: string;
    firstAirDate: Date | null;
    canonicalSlug?: string;
  },
): Promise<bigint> {
  const show = await prisma.tvShow.create({
    data: {
      tmdbId: opts.tmdbId,
      nameOriginal: opts.nameOriginal,
      firstAirDate: opts.firstAirDate,
    },
    select: { id: true },
  });
  if (opts.canonicalSlug !== undefined) {
    await createSlug(prisma, "tv", show.id, opts.canonicalSlug, true);
  }
  return show.id;
}

interface SeedCastCredit {
  readonly targetType: "movie" | "tv";
  readonly targetId: bigint;
  readonly character?: string | null;
  readonly creditId: string;
}
interface SeedCrewCredit {
  readonly targetType: "movie" | "tv";
  readonly targetId: bigint;
  readonly department?: string | null;
  readonly job?: string | null;
  readonly creditId: string;
}

async function seedPerson(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    name: string;
    knownForDepartment?: string | null;
    birthday?: Date | null;
    deathday?: Date | null;
    placeOfBirth?: string | null;
    profilePath?: string | null;
    canonicalSlug: string;
    aliasSlug?: string;
    translation?: {
      title?: string | null;
      metaTitle?: string | null;
      metaDescription?: string | null;
    };
    blocks?: ReadonlyArray<{
      blockType: string;
      content: string;
      reviewStatus: string;
      sourceType?: string;
    }>;
    cast?: ReadonlyArray<SeedCastCredit>;
    crew?: ReadonlyArray<SeedCrewCredit>;
  },
): Promise<bigint> {
  const person = await prisma.person.create({
    data: {
      tmdbId: opts.tmdbId,
      name: opts.name,
      knownForDepartment: opts.knownForDepartment ?? null,
      birthday: opts.birthday ?? null,
      deathday: opts.deathday ?? null,
      placeOfBirth: opts.placeOfBirth ?? null,
      profilePath: opts.profilePath ?? null,
    },
    select: { id: true },
  });
  const entityId = person.id;

  await createSlug(prisma, "person", entityId, opts.canonicalSlug, true);
  if (opts.aliasSlug !== undefined) {
    await createSlug(prisma, "person", entityId, opts.aliasSlug, false);
  }

  if (opts.translation !== undefined) {
    await prisma.entityTranslation.create({
      data: {
        entityType: "person",
        entityId,
        languageCode: LANGUAGE,
        title: opts.translation.title ?? null,
        metaTitle: opts.translation.metaTitle ?? null,
        metaDescription: opts.translation.metaDescription ?? null,
      },
    });
  }

  for (const block of opts.blocks ?? []) {
    const sourceType = block.sourceType ?? "human";
    await prisma.contentBlock.create({
      data: {
        entityType: "person",
        entityId,
        languageCode: LANGUAGE,
        blockType: block.blockType,
        content: block.content,
        sourceType,
        modelProvider: sourceType === "human" ? null : "test-provider",
        modelName: sourceType === "human" ? null : "test-model",
        promptVersion: "test-v1",
        inputHash: "test-input-hash",
        outputHash: "test-output-hash",
        reviewStatus: block.reviewStatus,
      },
    });
  }

  for (const c of opts.cast ?? []) {
    await prisma.castMember.create({
      data: {
        personId: entityId,
        entityType: c.targetType,
        entityId: c.targetId,
        character: c.character ?? null,
        creditId: c.creditId,
      },
    });
  }
  for (const c of opts.crew ?? []) {
    await prisma.crewMember.create({
      data: {
        personId: entityId,
        entityType: c.targetType,
        entityId: c.targetId,
        department: c.department ?? null,
        job: c.job ?? null,
        creditId: c.creditId,
      },
    });
  }

  return entityId;
}

type PersonPageData = {
  view: {
    name: string;
    originalName: string | null;
    roleLabel: string | null;
    lifeLabel: string | null;
    placeOfBirth: string | null;
    metaDescription: string | null;
    profile: { src: string; width: number; height: number } | null;
    hasRealImage: boolean;
    blocks: ReadonlyArray<{ blockType: string; content: string }>;
    renderableBlockCount: number;
    credits: ReadonlyArray<{
      entityType: string;
      title: string;
      href: string;
      year: number | null;
      roleLabel: string | null;
    }>;
  };
  indexability: { decision: string };
  canonicalSlug: string;
  canonicalUrl: string;
  relatedNews: ReadonlyArray<{ title: string; href: string }>;
};
type GetPersonPageData = (slug: string) => Promise<PersonPageData | null>;

async function runChecks(
  prisma: PrismaLike,
  getPersonPageData: GetPersonPageData,
): Promise<void> {
  const missing = await getPersonPageData("pessoa-que-nao-existe-1234");
  record(3, "A. slug inexistente retorna null", missing === null, `retorno=${missing === null ? "null" : "objeto"}`);

  await seedPerson(prisma, {
    tmdbId: 77000001,
    name: "Thin Person Zero",
    profilePath: "/abc.jpg",
    canonicalSlug: "pessoa-thin-zero",
    translation: { title: "Pessoa Fininha Zero" },
    blocks: [
      { blockType: "editorial_intro", content: "rascunho IA", reviewStatus: "ai_generated", sourceType: "ai" },
      { blockType: "faq", content: "aguardando revisao", reviewStatus: "needs_review", sourceType: "ai" },
    ],
  });
  const thinZero = await getPersonPageData("pessoa-thin-zero");
  record(4, "B. pessoa com 0 blocos publicos retorna dados", thinZero !== null, `retorno=${thinZero ? "objeto" : "null"}`);
  record(5, "B. renderableBlockCount === 0", thinZero?.view.renderableBlockCount === 0, `count=${thinZero?.view.renderableBlockCount}`);
  record(6, "B. indexability.decision === index (indexacao total; 0 blocos e sinal de qualidade, nao gate)", thinZero?.indexability.decision === "index", `decision=${thinZero?.indexability.decision}`);
  record(7, "B. metaDescription nao inventada", thinZero?.view.metaDescription === null, `metaDescription=${thinZero?.view.metaDescription === null ? "null" : "presente"}`);
  record(8, "B. nenhum bloco nao-publico aparece", (thinZero?.view.blocks.length ?? -1) === 0, `blocos=${thinZero?.view.blocks.length}`);
  record(9, "B. path cru de perfil vira imagem REMOTA (nunca local)", thinZero?.view.hasRealImage === true && (thinZero?.view.profile?.src?.startsWith("https://") ?? false), `profile=${thinZero?.view.profile?.src}`);
  record(10, "B. sem creditos, filmografia fica vazia", (thinZero?.view.credits.length ?? -1) === 0, `credits=${thinZero?.view.credits.length}`);

  await seedPerson(prisma, {
    tmdbId: 77000002,
    name: "One Block Person",
    canonicalSlug: "pessoa-um-bloco",
    translation: { title: "Pessoa de Um Bloco" },
    blocks: [
      { blockType: "editorial_intro", content: "introducao publicada", reviewStatus: "published" },
    ],
  });
  const oneBlock = await getPersonPageData("pessoa-um-bloco");
  record(11, "C. renderableBlockCount === 1", oneBlock?.view.renderableBlockCount === 1, `count=${oneBlock?.view.renderableBlockCount}`);
  record(12, "C. indexability.decision === index (indexacao total; 1 bloco nao gateia mais)", oneBlock?.indexability.decision === "index", `decision=${oneBlock?.indexability.decision}`);

  // Alvos de credito: um filme com slug, uma serie com slug, um filme SEM slug.
  const movieId = await seedMovieTarget(prisma, {
    tmdbId: 77100001,
    titleOriginal: "Old Movie Original",
    releaseDate: new Date("2005-06-01"),
    translationTitle: "Filme Antigo PT",
    canonicalSlug: "filme-antigo",
  });
  const tvId = await seedTvTarget(prisma, {
    tmdbId: 77100002,
    nameOriginal: "New Show",
    firstAirDate: new Date("2021-09-10"),
    canonicalSlug: "serie-nova",
  });
  const movieNoSlugId = await seedMovieTarget(prisma, {
    tmdbId: 77100003,
    titleOriginal: "Movie Without Slug",
    releaseDate: new Date("2012-01-01"),
  });

  const richId = await seedPerson(prisma, {
    tmdbId: 77000003,
    name: "Original Person",
    knownForDepartment: "Acting",
    birthday: new Date("1970-05-25"),
    placeOfBirth: "Sao Paulo, Brasil",
    profilePath: "/media/people/rich-person.webp",
    canonicalSlug: "pessoa-rica",
    aliasSlug: "pessoa-rica-antiga",
    translation: {
      title: "Pessoa Rica",
      metaTitle: "Pessoa Rica - Pessoa",
      metaDescription: "Descricao editorial pt-BR existente no banco.",
    },
    blocks: [
      { blockType: "faq", content: "Perguntas revisadas.", reviewStatus: "human_reviewed" },
      { blockType: "editorial_intro", content: "Introducao editorial revisada.", reviewStatus: "published" },
      { blockType: "news_context", content: "rascunho nao-publico", reviewStatus: "needs_review", sourceType: "ai" },
    ],
    cast: [
      { targetType: "movie", targetId: movieId, character: "Protagonista", creditId: "credit-cast-movie" },
      { targetType: "movie", targetId: movieNoSlugId, character: "Figurante", creditId: "credit-cast-noslug" },
    ],
    crew: [
      { targetType: "tv", targetId: tvId, department: "Directing", job: "Director", creditId: "credit-crew-tv" },
    ],
  });
  // 4G: noticias relacionadas reais via EntityNewsLink (person). Publicada
  // aparece; rascunho e noindex fora.
  await seedRelatedArticle(prisma, { slug: "noticia-da-pessoa", title: "Noticia da Pessoa", reviewStatus: "published", entityType: "person", entityId: richId });
  await seedRelatedArticle(prisma, { slug: "rascunho-da-pessoa", title: "Rascunho", reviewStatus: "draft", entityType: "person", entityId: richId });
  await seedRelatedArticle(prisma, { slug: "noindex-da-pessoa", title: "Noindex", reviewStatus: "published", indexStatus: "noindex", entityType: "person", entityId: richId });

  const richByAlias = await getPersonPageData("pessoa-rica-antiga");
  record(13, "D. pessoa com 2 blocos publicos retorna dados", richByAlias !== null, `retorno=${richByAlias ? "objeto" : "null"}`);
  record(
    26,
    "4G. noticia relacionada publicada aparece; rascunho/noindex fora; linka /pt/noticias/",
    richByAlias?.relatedNews.length === 1 && richByAlias?.relatedNews[0]?.href === "/pt/noticias/noticia-da-pessoa/",
    `related=[${(richByAlias?.relatedNews ?? []).map((r) => r.href).join(", ")}]`,
  );
  record(14, "D. renderableBlockCount === 2", richByAlias?.view.renderableBlockCount === 2, `count=${richByAlias?.view.renderableBlockCount}`);
  record(15, "D. indexability.decision === index", richByAlias?.indexability.decision === "index", `decision=${richByAlias?.indexability.decision}`);
  record(16, "D. canonicalSlug vem do slug canonico", richByAlias?.canonicalSlug === "pessoa-rica", `canonicalSlug=${richByAlias?.canonicalSlug}`);
  record(17, "D. canonicalUrl usa /pt/pessoas/", richByAlias?.canonicalUrl === "https://thescreen.media/pt/pessoas/pessoa-rica/", `canonicalUrl=${richByAlias?.canonicalUrl}`);
  record(18, "D. nome vem da traducao pt-BR (original preservado)", richByAlias?.view.name === "Pessoa Rica" && richByAlias?.view.originalName === "Original Person", `name=${richByAlias?.view.name} / original=${richByAlias?.view.originalName}`);
  record(19, "D. funcao traduzida e vida/local reais", richByAlias?.view.roleLabel === "Atuacao" && richByAlias?.view.lifeLabel === "Nascimento: 1970" && richByAlias?.view.placeOfBirth === "Sao Paulo, Brasil", `role=${richByAlias?.view.roleLabel} / vida=${richByAlias?.view.lifeLabel}`);
  record(20, "D. imagem local segura aparece", richByAlias?.view.profile?.src === "/media/people/rich-person.webp" && richByAlias?.view.hasRealImage === true, `profile=${richByAlias?.view.profile?.src ?? "null"}`);

  const visibleTypes = (richByAlias?.view.blocks ?? []).map((b) => b.blockType).sort();
  record(21, "D. apenas blocos publicos aparecem", JSON.stringify(visibleTypes) === JSON.stringify(["editorial_intro", "faq"]), `visiveis=[${visibleTypes.join(", ")}]`);

  const credits = richByAlias?.view.credits ?? [];
  record(22, "D. filmografia resolve so alvos com slug (2 de 3 creditos)", credits.length === 2, `credits=${credits.length}`);
  record(23, "D. creditos ordenados por ano desc com hrefs corretos", credits[0]?.href === "/pt/series/serie-nova/" && credits[1]?.href === "/pt/filmes/filme-antigo/", `hrefs=[${credits.map((c) => c.href).join(", ")}]`);
  record(24, "D. papel do credito (character/job) preservado", credits[0]?.roleLabel === "Director" && credits[1]?.roleLabel === "Protagonista", `roles=[${credits.map((c) => c.roleLabel).join(", ")}]`);
  record(25, "D. credito sem slug canonico e omitido (nao inventa link)", !credits.some((c) => c.title === "Movie Without Slug"), `titulos=[${credits.map((c) => c.title).join(", ")}]`);
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-web-person-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_web_person_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_web_person_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_web_person_validation");

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy (schema existente; sem migration nova) ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (idiomas/paises/fontes existentes) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- fluxo da pagina de pessoa no banco real (getPersonPageData) ---");
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const personPage = (await import("../src/server/person-page.ts")) as {
      getPersonPageData: GetPersonPageData;
    };

    const prisma = dbServer.getPrismaClient();
    await runChecks(prisma, personPage.getPersonPageData);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (disconnect) {
      await disconnect();
    }
    if (started) {
      await pg.stop();
    }
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (e) {
      console.warn(
        `Aviso: dir temporario nao removido agora (${(e as Error).message.split("\n")[0]}); sera limpo pelo SO.`,
      );
    }
    console.log("\n=== Postgres efemero derrubado e dir temporario liberado ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Pagina de pessoa validada lendo PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
