/**
 * validate-news-pages-real-postgres.ts - Validacao descartavel das paginas
 * publicas de noticias contra PostgreSQL real efemero.
 *
 * Prova o fluxo:
 *   article + article_translation (pt-BR) -> gate de publicacao/licenca ->
 *   presenter -> gate anti-thin; entity_news_links -> relacionados resolviveis.
 *
 * Nao sobe Next, nao chama rede, nao chama TMDB/Gemini/WordPress/MN26 e nao
 * altera schema. Rejeicao de imagem testada com path cru ("/raw.jpg").
 *
 * `getNewsIndexData` nao recebe args -> chamado UMA vez no estado final semeado
 * (evita memoizacao de `cache`); `getNewsArticleData(slug)` varia por slug.
 *
 * Uso: pnpm --filter @screena/web validate:news-pages
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
const LONG_BODY = "Corpo editorial proprio e substancial. ".repeat(12); // > 200 chars

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
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: { create: (args: unknown) => Promise<unknown> };
  entityNewsLink: { create: (args: unknown) => Promise<unknown> };
  movie: { create: (args: unknown) => Promise<{ id: bigint }> };
  person: { create: (args: unknown) => Promise<{ id: bigint }> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
};

interface SeedLink {
  readonly targetType: "movie" | "person";
  readonly targetId: bigint;
}

async function seedArticle(
  prisma: PrismaLike,
  opts: {
    slug: string;
    title: string;
    reviewStatus: string;
    indexStatus?: string;
    body?: string | null;
    deck?: string | null;
    displayAllowed?: boolean;
    licenseStatus?: string;
    authorName?: string | null;
    category?: string | null;
    heroImagePath?: string | null;
    readTimeMinutes?: number | null;
    aiAssisted?: boolean;
    sourceName?: string | null;
    requiresLinkback?: boolean;
    publishedAt?: Date | null;
    links?: ReadonlyArray<SeedLink>;
  },
): Promise<bigint> {
  const article = await prisma.article.create({
    data: {
      authorName: opts.authorName ?? null,
      category: opts.category ?? null,
      heroImagePath: opts.heroImagePath ?? null,
      publishedAt: opts.publishedAt ?? null,
      readTimeMinutes: opts.readTimeMinutes ?? null,
      aiAssisted: opts.aiAssisted ?? false,
      sourceName: opts.sourceName ?? null,
      sourceUrl: null,
      licenseStatus: opts.licenseStatus ?? "official",
      displayAllowed: opts.displayAllowed ?? true,
      requiresAttribution: false,
      requiresLinkback: opts.requiresLinkback ?? false,
    },
    select: { id: true },
  });

  await prisma.articleTranslation.create({
    data: {
      articleId: article.id,
      languageCode: LANGUAGE,
      slug: opts.slug,
      title: opts.title,
      deck: opts.deck ?? null,
      body: opts.body ?? null,
      metaTitle: null,
      metaDescription: null,
      reviewStatus: opts.reviewStatus,
      indexStatus: opts.indexStatus ?? "noindex",
      publishedAt: opts.publishedAt ?? new Date("2026-06-30T12:00:00.000Z"),
    },
  });

  for (const link of opts.links ?? []) {
    await prisma.entityNewsLink.create({
      data: { articleId: article.id, entityType: link.targetType, entityId: link.targetId },
    });
  }
  return article.id;
}

async function seedMovieTarget(
  prisma: PrismaLike,
  opts: { tmdbId: number; titleOriginal: string; translationTitle?: string; canonicalSlug?: string },
): Promise<bigint> {
  const movie = await prisma.movie.create({
    data: { tmdbId: opts.tmdbId, titleOriginal: opts.titleOriginal, releaseDate: null },
    select: { id: true },
  });
  if (opts.canonicalSlug !== undefined) {
    await prisma.slug.create({
      data: { entityType: "movie", entityId: movie.id, languageCode: LANGUAGE, slug: opts.canonicalSlug, isCanonical: true },
    });
  }
  if (opts.translationTitle !== undefined) {
    await prisma.entityTranslation.create({
      data: { entityType: "movie", entityId: movie.id, languageCode: LANGUAGE, title: opts.translationTitle },
    });
  }
  return movie.id;
}

async function seedPersonTarget(
  prisma: PrismaLike,
  opts: { tmdbId: number; name: string },
): Promise<bigint> {
  const person = await prisma.person.create({
    data: { tmdbId: opts.tmdbId, name: opts.name },
    select: { id: true },
  });
  return person.id; // sem slug canonico de proposito -> deve ser omitido
}

interface ArticleData {
  view: {
    title: string;
    category: string | null;
    dateLabel: string | null;
    author: string | null;
    heroImage: { src: string } | null;
    hasBody: boolean;
    aiAssisted: boolean;
    source: { name: string } | null;
    related: ReadonlyArray<{ entityType: string; title: string; href: string }>;
  };
  indexability: { decision: string };
  canonicalUrl: string;
}
interface IndexData {
  view: {
    featured: { title: string } | null;
    cards: ReadonlyArray<{ title: string }>;
    totalCount: number;
  };
  indexability: { decision: string };
  canonicalUrl: string;
}
type Getters = {
  getNewsArticleData: (slug: string) => Promise<ArticleData | null>;
  getNewsIndexData: () => Promise<IndexData>;
};

async function runChecks(prisma: PrismaLike, g: Getters): Promise<void> {
  record(3, "A. slug inexistente retorna null", (await g.getNewsArticleData("nao-existe-123")) === null, "retorno=null");

  await seedArticle(prisma, { slug: "noticia-rascunho", title: "Rascunho", reviewStatus: "draft", body: LONG_BODY });
  record(4, "B. artigo rascunho nao renderiza (404)", (await g.getNewsArticleData("noticia-rascunho")) === null, "retorno=null");

  await seedArticle(prisma, { slug: "noticia-bloqueada", title: "Bloqueada", reviewStatus: "published", body: LONG_BODY, displayAllowed: false });
  record(5, "C. artigo com display bloqueado nao renderiza (404)", (await g.getNewsArticleData("noticia-bloqueada")) === null, "retorno=null");

  await seedArticle(prisma, { slug: "noticia-fina", title: "Fina", reviewStatus: "published", indexStatus: "index", body: "curto", heroImagePath: "/raw.jpg", publishedAt: new Date("2026-06-15T00:00:00.000Z") });
  const thin = await g.getNewsArticleData("noticia-fina");
  record(6, "D. artigo publicado fino renderiza", thin !== null, `retorno=${thin ? "objeto" : "null"}`);
  record(7, "D. artigo fino -> noindex", thin?.indexability.decision === "noindex", `decision=${thin?.indexability.decision}`);
  record(8, "D. imagem crua vira null (fallback)", thin?.view.heroImage === null, `hero=${thin?.view.heroImage === null ? "null" : "presente"}`);

  const movieId = await seedMovieTarget(prisma, { tmdbId: 55100001, titleOriginal: "Rel Movie", translationTitle: "Filme Rel", canonicalSlug: "filme-rel" });
  const personNoSlugId = await seedPersonTarget(prisma, { tmdbId: 55200001, name: "Pessoa Sem Slug" });
  await seedArticle(prisma, {
   
    slug: "noticia-rica",
    title: "Noticia Rica",
    reviewStatus: "published",
    indexStatus: "index",
    body: LONG_BODY,
    deck: "Deck real.",
    authorName: "Lucas Andrade",
    category: "Marvel",
    heroImagePath: "/media/news/rica.webp",
    readTimeMinutes: 5,
    aiAssisted: true,
    sourceName: "Collider",
    publishedAt: new Date("2026-06-30T12:00:00.000Z"),
    links: [
      { targetType: "movie", targetId: movieId },
      { targetType: "person", targetId: personNoSlugId },
    ],
  });
  const rich = await g.getNewsArticleData("noticia-rica");
  record(9, "E. artigo publicado com corpo suficiente renderiza", rich !== null, `retorno=${rich ? "objeto" : "null"}`);
  record(10, "E. artigo suficiente + index_status index -> index", rich?.indexability.decision === "index", `decision=${rich?.indexability.decision}`);
  record(11, "E. canonicalUrl /pt/noticias/", rich?.canonicalUrl === "https://thescreen.media/pt/noticias/noticia-rica/", `canonicalUrl=${rich?.canonicalUrl}`);
  record(12, "E. imagem local segura aparece", rich?.view.heroImage?.src === "/media/news/rica.webp", `hero=${rich?.view.heroImage?.src ?? "null"}`);
  record(13, "E. autor/categoria/data reais", rich?.view.author === "Lucas Andrade" && rich?.view.category === "Marvel" && rich?.view.dateLabel === "30 de junho de 2026", `autor=${rich?.view.author} data=${rich?.view.dateLabel}`);
  record(14, "E. disclaimer de IA ativo e fonte em texto", rich?.view.aiAssisted === true && rich?.view.source?.name === "Collider", `ai=${rich?.view.aiAssisted} fonte=${rich?.view.source?.name ?? "null"}`);
  record(15, "E. relacionado resolve so alvo com slug (movie), pessoa sem slug omitida", rich?.view.related.length === 1 && rich?.view.related[0]?.href === "/pt/filmes/filme-rel/" && rich?.view.related[0]?.title === "Filme Rel", `related=[${(rich?.view.related ?? []).map((r) => r.href).join(", ")}]`);

  // Mais dois publicaveis para a listagem indexar (>= 3 publicaveis: fina + rica + 2).
  await seedArticle(prisma, { slug: "noticia-rica-2", title: "Rica 2", reviewStatus: "published", indexStatus: "index", body: LONG_BODY, publishedAt: new Date("2026-06-20T00:00:00.000Z") });
  await seedArticle(prisma, { slug: "noticia-rica-3", title: "Rica 3", reviewStatus: "human_reviewed", indexStatus: "index", body: LONG_BODY, publishedAt: new Date("2026-06-10T00:00:00.000Z") });

  const list = await g.getNewsIndexData();
  record(16, "F. listagem canonicalUrl /pt/noticias/", list.canonicalUrl === "https://thescreen.media/pt/noticias/", `canonicalUrl=${list.canonicalUrl}`);
  record(17, "F. so publicaveis entram (rascunho/bloqueada fora) -> totalCount=4", list.view.totalCount === 4, `totalCount=${list.view.totalCount}`);
  record(18, "F. listagem com itens suficientes -> index", list.indexability.decision === "index", `decision=${list.indexability.decision}`);
  record(19, "F. featured e o mais recente (Noticia Rica, 30/06)", list.view.featured?.title === "Noticia Rica", `featured=${list.view.featured?.title ?? "null"}`);
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-web-news-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_web_news_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_web_news_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_web_news_validation");

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy (schema existente; sem migration nova) ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (idiomas/paises/fontes existentes) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- fluxo das paginas de noticias no banco real ---");
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const news = (await import("../src/server/news-pages.ts")) as Getters;

    const prisma = dbServer.getPrismaClient();
    await runChecks(prisma, news);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (disconnect) await disconnect();
    if (started) await pg.stop();
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (e) {
      console.warn(`Aviso: dir temporario nao removido agora (${(e as Error).message.split("\n")[0]}); sera limpo pelo SO.`);
    }
    console.log("\n=== Postgres efemero derrubado e dir temporario liberado ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Paginas de noticias validadas lendo PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
