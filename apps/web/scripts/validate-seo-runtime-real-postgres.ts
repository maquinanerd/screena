/**
 * validate-seo-runtime-real-postgres.ts — Validacao DESCARTAVEL da FASE 3 (SEO
 * como fonte unica de verdade) contra PostgreSQL 16 REAL efemero.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao roda no render/build/producao.
 * Prova, ponta a ponta e com banco real, os seams de runtime da Fase 3 chamando
 * DIRETAMENTE as MESMAS camadas server-only que o app usa (sem subir Next):
 *
 *   - Indexabilidade persistida (page_indexability_decisions): decisao vigente
 *     (is_current), historico, index/noindex/blocked/stale, ausencia (indexacao
 *     total) e fail-closed em falha de banco.
 *   - Redirects persistidos (redirects): 301/302, alias, cadeia, loop, none.
 *   - Sitemap index + shards: XML valido, URLs absolutas, exclusao por decisao
 *     persistida e por publicacao, shard inexistente -> null.
 *   - Gate de noticias: licenca/atribuicao/linkback/publicacao fail-closed.
 *   - Seguranca JSON-LD: escape de </script>, <, >, &, U+2028, U+2029.
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO) — o
 * MESMO padrao dos demais validadores. Zero rede, zero Gemini, zero TMDB.
 *
 * Uso: pnpm --filter @screena/web validate:seo-runtime
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const repoRoot = path.resolve(scriptDir, "..", "..", ".."); // raiz do monorepo
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";
const SITE = "https://thescreen.media";

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
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

// Tipos minimos (resolvidos por import dinamico apos DATABASE_URL setado).
type PrismaLike = {
  movie: { create: (args: unknown) => Promise<{ id: bigint }> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  pageIndexabilityDecision: {
    create: (args: unknown) => Promise<unknown>;
    count: (args: unknown) => Promise<number>;
  };
  redirect: { create: (args: unknown) => Promise<unknown> };
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: { create: (args: unknown) => Promise<unknown> };
};

const BODY = "Corpo editorial proprio e substancial para a noticia. ".repeat(6);

async function seedMovie(
  prisma: PrismaLike,
  opts: { tmdbId: number; slug: string; title: string },
): Promise<bigint> {
  const movie = await prisma.movie.create({
    data: { tmdbId: opts.tmdbId, titleOriginal: opts.title },
    select: { id: true },
  });
  await prisma.slug.create({
    data: {
      entityType: "movie",
      entityId: movie.id,
      languageCode: LANGUAGE,
      slug: opts.slug,
      isCanonical: true,
    },
  });
  await prisma.entityTranslation.create({
    data: {
      entityType: "movie",
      entityId: movie.id,
      languageCode: LANGUAGE,
      title: opts.title,
    },
  });
  return movie.id;
}

async function seedDecision(
  prisma: PrismaLike,
  opts: {
    entityId: bigint;
    slug: string;
    decision: string;
    isCurrent: boolean;
    origin?: string;
  },
): Promise<void> {
  await prisma.pageIndexabilityDecision.create({
    data: {
      entityType: "movie",
      entityId: opts.entityId,
      languageCode: LANGUAGE,
      url: `${SITE}/pt/filmes/${opts.slug}/`,
      decision: opts.decision,
      isCurrent: opts.isCurrent,
      decisionOrigin: opts.origin ?? "seo_policy_engine",
      reason: `teste decision=${opts.decision}`,
    },
  });
}

async function seedArticle(
  prisma: PrismaLike,
  opts: {
    slug: string;
    title: string;
    licenseStatus?: string;
    displayAllowed?: boolean;
    requiresAttribution?: boolean;
    requiresLinkback?: boolean;
    sourceName?: string | null;
    sourceUrl?: string | null;
    reviewStatus?: string;
    indexStatus?: string;
    published?: boolean;
  },
): Promise<void> {
  const publishedAt = opts.published === false ? null : new Date("2026-06-30T12:00:00.000Z");
  const article = await prisma.article.create({
    data: {
      licenseStatus: opts.licenseStatus ?? "official",
      displayAllowed: opts.displayAllowed ?? true,
      requiresAttribution: opts.requiresAttribution ?? false,
      requiresLinkback: opts.requiresLinkback ?? false,
      sourceName: opts.sourceName ?? null,
      sourceUrl: opts.sourceUrl ?? null,
      publishedAt,
    },
    select: { id: true },
  });
  await prisma.articleTranslation.create({
    data: {
      articleId: article.id,
      languageCode: LANGUAGE,
      slug: opts.slug,
      title: opts.title,
      body: BODY,
      reviewStatus: opts.reviewStatus ?? "published",
      indexStatus: opts.indexStatus ?? "index",
      publishedAt,
    },
  });
}

interface Seams {
  resolveEntityPageSeo: (key: unknown, facts: unknown, client?: unknown) => Promise<{
    decision: string;
    robots: { index: boolean; follow: boolean };
    includeInSitemap: boolean;
    decisionSource: string;
  }>;
  getCurrentPageIndexabilityDecision: (
    key: unknown,
  ) => Promise<{ decision: string } | null>;
  getMoviePageData: (slug: string) => Promise<{ seo: { decision: string; decisionSource: string } } | null>;
  lookupRedirect: (path: string) => Promise<{ status: string; location: string | null; statusCode: number | null }>;
  clearRedirectCache: () => void;
  getAllSitemapUrls: () => Promise<{ loc: string; type: string }[]>;
  getSitemapIndexXml: () => Promise<{ xml: string; contentType: string }>;
  getSitemapShardXml: (id: string) => Promise<{ xml: string; contentType: string } | null>;
  getNewsArticleData: (slug: string) => Promise<unknown | null>;
  serializeJsonLd: (value: unknown) => string;
}

async function runChecks(prisma: PrismaLike, seams: Seams): Promise<void> {
  // ---- Seed --------------------------------------------------------------
  const idIndexed = await seedMovie(prisma, { tmdbId: 96000001, slug: "filme-indexado", title: "Filme Indexado" });
  const idNoindex = await seedMovie(prisma, { tmdbId: 96000002, slug: "filme-noindex", title: "Filme Noindex" });
  const idBlocked = await seedMovie(prisma, { tmdbId: 96000003, slug: "filme-bloqueado", title: "Filme Bloqueado" });
  const idStale = await seedMovie(prisma, { tmdbId: 96000004, slug: "filme-stale", title: "Filme Stale" });

  // Historico: uma decisao antiga (is_current=false) + a vigente (is_current=true).
  await seedDecision(prisma, { entityId: idNoindex, slug: "filme-noindex", decision: "index", isCurrent: false, origin: "seo_policy_engine" });
  await seedDecision(prisma, { entityId: idNoindex, slug: "filme-noindex", decision: "noindex", isCurrent: true, origin: "human_override" });
  await seedDecision(prisma, { entityId: idBlocked, slug: "filme-bloqueado", decision: "blocked", isCurrent: true });
  await seedDecision(prisma, { entityId: idStale, slug: "filme-stale", decision: "stale", isCurrent: true });

  await prisma.redirect.create({ data: { fromPath: "/pt/antigo/", toPath: "/pt/filmes/filme-indexado/", statusCode: 301 } });
  await prisma.redirect.create({ data: { fromPath: "/pt/temp/", toPath: "/pt/filmes/filme-indexado/", statusCode: 302 } });
  await prisma.redirect.create({ data: { fromPath: "/pt/alias-a/", toPath: "/pt/alias-b/", statusCode: 301, reason: "compat alias" } });
  await prisma.redirect.create({ data: { fromPath: "/pt/c1/", toPath: "/pt/c2/", statusCode: 301 } });
  await prisma.redirect.create({ data: { fromPath: "/pt/c2/", toPath: "/pt/c3/", statusCode: 301 } });
  await prisma.redirect.create({ data: { fromPath: "/pt/loop-a/", toPath: "/pt/loop-b/", statusCode: 301 } });
  await prisma.redirect.create({ data: { fromPath: "/pt/loop-b/", toPath: "/pt/loop-a/", statusCode: 301 } });

  await seedArticle(prisma, { slug: "noticia-valida", title: "Noticia Valida" });
  await seedArticle(prisma, { slug: "noticia-atribuida", title: "Noticia Atribuida", requiresAttribution: true, sourceName: "Fonte X", requiresLinkback: true, sourceUrl: "https://fonte.example/materia" });
  await seedArticle(prisma, { slug: "noticia-bloqueada", title: "Noticia Bloqueada", licenseStatus: "blocked", displayAllowed: false });
  await seedArticle(prisma, { slug: "noticia-sem-atrib", title: "Noticia Sem Atribuicao", requiresAttribution: true, sourceName: null });
  await seedArticle(prisma, { slug: "noticia-sem-linkback", title: "Noticia Sem Linkback", requiresLinkback: true, sourceUrl: null });
  await seedArticle(prisma, { slug: "noticia-rascunho", title: "Noticia Rascunho", reviewStatus: "draft", published: false });

  // ---- Indexabilidade persistida -----------------------------------------
  const facts = { language: LANGUAGE, hasReliableStructuredData: true, displayedRatings: [], canonicalUrl: `${SITE}/pt/filmes/filme-indexado/` };

  const seoIndexed = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idIndexed, languageCode: LANGUAGE }, facts);
  record(3, "indexacao total: movie sem decisao persistida -> index", seoIndexed.decision === "index" && seoIndexed.includeInSitemap === true, `decision=${seoIndexed.decision}, source=${seoIndexed.decisionSource}`);

  const movieNoindex = await seams.getMoviePageData("filme-noindex");
  record(4, "decisao persistida noindex chega ao getMoviePageData.seo", movieNoindex?.seo.decision === "noindex" && movieNoindex?.seo.decisionSource === "persisted-decision", `decision=${movieNoindex?.seo.decision}, source=${movieNoindex?.seo.decisionSource}`);

  const current = await seams.getCurrentPageIndexabilityDecision({ entityType: "movie", entityId: idNoindex, languageCode: LANGUAGE });
  record(5, "SO a decisao is_current e consumida (nao a historica index)", current?.decision === "noindex", `is_current=${current?.decision}`);

  const currentCount = await prisma.pageIndexabilityDecision.count({ where: { entityType: "movie", entityId: idNoindex, languageCode: LANGUAGE, isCurrent: true } });
  record(6, "exatamente 1 decisao vigente por entidade/idioma", currentCount === 1, `count(is_current)=${currentCount}`);

  const seoBlocked = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idBlocked, languageCode: LANGUAGE }, facts);
  record(7, "decisao persistida blocked -> blocked/nofollow/fora do sitemap", seoBlocked.decision === "blocked" && seoBlocked.robots.follow === false && seoBlocked.includeInSitemap === false, `decision=${seoBlocked.decision}`);

  const seoStale = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idStale, languageCode: LANGUAGE }, facts);
  record(8, "decisao persistida stale -> stale/fora do sitemap", seoStale.decision === "stale" && seoStale.includeInSitemap === false, `decision=${seoStale.decision}`);

  // Fail-closed: leitura da decisao vigente falha -> noindex.
  const throwingClient = { pageIndexabilityDecision: { findFirst: async () => { throw new Error("db down"); } } };
  const seoFailClosed = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idIndexed, languageCode: LANGUAGE }, facts, throwingClient);
  record(9, "fail-closed: erro ao ler decisao vigente -> noindex", seoFailClosed.decision === "noindex" && seoFailClosed.includeInSitemap === false, `decision=${seoFailClosed.decision}`);

  // ---- Redirects ---------------------------------------------------------
  seams.clearRedirectCache();
  const r301 = await seams.lookupRedirect("/pt/antigo/");
  record(10, "redirect 301 persistido resolve com status 301", r301.status === "resolved" && r301.location === "/pt/filmes/filme-indexado/" && r301.statusCode === 301, `status=${r301.status}, loc=${r301.location}, code=${r301.statusCode}`);

  const r302 = await seams.lookupRedirect("/pt/temp/");
  record(11, "redirect 302 persistido resolve com status 302", r302.status === "resolved" && r302.statusCode === 302, `code=${r302.statusCode}`);

  const rAlias = await seams.lookupRedirect("/pt/alias-a/");
  record(12, "alias resolve para o destino", rAlias.status === "resolved" && rAlias.location === "/pt/alias-b/", `loc=${rAlias.location}`);

  const rChain = await seams.lookupRedirect("/pt/c1/");
  record(13, "cadeia A->B->C colapsa no destino final", rChain.status === "resolved" && rChain.location === "/pt/c3/", `loc=${rChain.location}`);

  const rLoop = await seams.lookupRedirect("/pt/loop-a/");
  record(14, "loop detectado -> nenhum redirect emitido", rLoop.status === "loop" && rLoop.location === null, `status=${rLoop.status}`);

  const rNone = await seams.lookupRedirect("/pt/inexistente/");
  record(15, "sem redirect -> none", rNone.status === "none" && rNone.location === null, `status=${rNone.status}`);

  // ---- Sitemap index + shards --------------------------------------------
  const urls = await seams.getAllSitemapUrls();
  const locs = urls.map((u) => u.loc);
  const hasIndexed = locs.includes(`${SITE}/pt/filmes/filme-indexado/`);
  const hasExcluded = locs.some((l) => ["filme-noindex", "filme-bloqueado", "filme-stale"].some((s) => l.includes(s)));
  record(16, "sitemap inclui indexado e EXCLUI entidades com decisao != index", hasIndexed && !hasExcluded, `indexado=${hasIndexed}, excluidas_presentes=${hasExcluded}`);

  const hasValidNews = locs.includes(`${SITE}/pt/noticias/noticia-valida/`);
  const hasBlockedNews = locs.some((l) => ["noticia-bloqueada", "noticia-sem-atrib", "noticia-sem-linkback", "noticia-rascunho"].some((s) => l.includes(s)));
  record(17, "sitemap inclui noticia valida e EXCLUI bloqueada/sem-atrib/rascunho", hasValidNews && !hasBlockedNews, `valida=${hasValidNews}, invalidas_presentes=${hasBlockedNews}`);

  const index = await seams.getSitemapIndexXml();
  record(18, "sitemap index e XML valido com Content-Type xml", index.xml.includes("<sitemapindex") && index.xml.includes("<?xml") && index.contentType.includes("application/xml"), `contentType=${index.contentType}`);

  const shard = await seams.getSitemapShardXml("sitemap-pt-BR-movies-0.xml");
  const shardOk = shard !== null && shard.xml.includes("<urlset") && shard.xml.includes(`${SITE}/pt/filmes/filme-indexado/`) && !shard.xml.includes("filme-noindex");
  record(19, "shard de movies serve urlset com URL absoluta do indexado e sem excluido", shardOk, `shard=${shard === null ? "null" : "ok"}`);

  const missingShard = await seams.getSitemapShardXml("sitemap-pt-BR-inexistente-9.xml");
  record(20, "shard inexistente -> null (404 na rota)", missingShard === null, `retorno=${missingShard === null ? "null" : "objeto"}`);

  // ---- Gate de noticias --------------------------------------------------
  record(21, "noticia valida renderiza (getNewsArticleData != null)", (await seams.getNewsArticleData("noticia-valida")) !== null, "ok");
  record(22, "noticia atribuida (fonte+linkback presentes) renderiza", (await seams.getNewsArticleData("noticia-atribuida")) !== null, "ok");
  record(23, "noticia com licenca bloqueada NAO renderiza (404)", (await seams.getNewsArticleData("noticia-bloqueada")) === null, "null");
  record(24, "noticia sem atribuicao exigida NAO renderiza (404)", (await seams.getNewsArticleData("noticia-sem-atrib")) === null, "null");
  record(25, "noticia sem linkback exigido NAO renderiza (404)", (await seams.getNewsArticleData("noticia-sem-linkback")) === null, "null");
  record(26, "noticia nao publicada NAO renderiza (404)", (await seams.getNewsArticleData("noticia-rascunho")) === null, "null");

  // ---- Seguranca JSON-LD -------------------------------------------------
  const js1 = seams.serializeJsonLd({ name: "</script><script>alert(1)</script>" });
  record(27, "JSON-LD neutraliza </script> (sem < > crus)", !js1.includes("</script>") && !js1.includes("<") && !js1.includes(">") && js1.includes("\\u003c"), "ok");

  const js2 = seams.serializeJsonLd({ a: "x & y" });
  record(28, "JSON-LD escapa & -> \\u0026", !js2.includes("&") && js2.includes("\\u0026"), "ok");

  const sep = `linha1${String.fromCharCode(0x2028)}linha2${String.fromCharCode(0x2029)}fim`;
  const js3 = seams.serializeJsonLd({ t: sep });
  record(29, "JSON-LD escapa U+2028/U+2029", js3.includes("\\u2028") && js3.includes("\\u2029") && !js3.includes(String.fromCharCode(0x2028)), "ok");
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-seo-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_seo_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_seo_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_seo_validation");

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy (schema existente; sem migration nova) ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (idiomas/paises/fontes) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- seams de runtime da Fase 3 (banco real) ---");
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const indexabilityMod = (await import("../src/server/seo/indexability-decision.ts")) as Pick<
      Seams,
      "resolveEntityPageSeo" | "getCurrentPageIndexabilityDecision"
    >;
    const moviePageMod = (await import("../src/server/movie-page.ts")) as Pick<Seams, "getMoviePageData">;
    const redirectMod = (await import("../src/server/seo/redirect-lookup.ts")) as Pick<Seams, "lookupRedirect" | "clearRedirectCache">;
    const sitemapMod = (await import("../src/server/seo/sitemap-index.ts")) as Pick<
      Seams,
      "getAllSitemapUrls" | "getSitemapIndexXml" | "getSitemapShardXml"
    >;
    const newsMod = (await import("../src/server/news-pages.ts")) as Pick<Seams, "getNewsArticleData">;
    const seoMod = (await import("@screena/seo")) as Pick<Seams, "serializeJsonLd">;

    const seams: Seams = {
      resolveEntityPageSeo: indexabilityMod.resolveEntityPageSeo,
      getCurrentPageIndexabilityDecision: indexabilityMod.getCurrentPageIndexabilityDecision,
      getMoviePageData: moviePageMod.getMoviePageData,
      lookupRedirect: redirectMod.lookupRedirect,
      clearRedirectCache: redirectMod.clearRedirectCache,
      getAllSitemapUrls: sitemapMod.getAllSitemapUrls,
      getSitemapIndexXml: sitemapMod.getSitemapIndexXml,
      getSitemapShardXml: sitemapMod.getSitemapShardXml,
      getNewsArticleData: newsMod.getNewsArticleData,
      serializeJsonLd: seoMod.serializeJsonLd,
    };

    const prisma = dbServer.getPrismaClient();
    await runChecks(prisma, seams);
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
  console.log("Resultado: PASSOU. Fase 3 (SEO como fonte unica) validada lendo PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
