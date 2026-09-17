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
 *     total), falha de banco que LANCA (5xx, desde 2026-09-11) e a PARIDADE
 *     pagina x sitemap dos portoes de qualidade (D1, D3) e da ausencia armada.
 *   - Redirects persistidos (redirects): 301/302, alias, cadeia, loop, none.
 *   - Sitemap PAGINADO NO BANCO: index por contagem, shard por LIMIT/OFFSET de UM
 *     tipo, exclusao durante a consulta, multiplos shards, 404 estrito, prova de
 *     LIMIT no banco (instrumentacao de SQL), fail-closed.
 *   - Extensao de imagem (compensacao da D1): a URL da ficha anuncia a arte que
 *     a pagina exibe, sob a licenca tmdb/image — sem, com e revogada.
 *   - Gate de noticias: licenca/atribuicao/linkback/publicacao fail-closed.
 *   - Seguranca JSON-LD: escape de </script>, <, >, &, U+2028, U+2029.
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO). O
 * limite de shard usado aqui e REDUZIDO (2) so no teste — nunca muda o de
 * producao. Zero rede, zero Gemini, zero TMDB.
 *
 * Uso: pnpm --filter @screena/web validate:seo-runtime
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { runChild } from "@screena/db/async-child-process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const repoRoot = path.resolve(scriptDir, "..", "..", ".."); // raiz do monorepo
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";
const SITE = "https://cinerie.com";
const LIMIT = 2; // limite de shard REDUZIDO so para o teste (producao = SITEMAP_URL_LIMIT).

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

function locsInXml(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]*)<\/loc>/g;
  let m = re.exec(xml);
  while (m !== null) {
    if (m[1] !== undefined) out.push(m[1]);
    m = re.exec(xml);
  }
  return out;
}

type PrismaLike = {
  movie: {
    create: (args: unknown) => Promise<{ id: bigint }>;
    createMany: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<{ id: bigint; tmdbId: number }[]>;
  };
  slug: { create: (args: unknown) => Promise<unknown>; createMany: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  pageIndexabilityDecision: {
    create: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
    count: (args: unknown) => Promise<number>;
  };
  redirect: { create: (args: unknown) => Promise<unknown> };
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: { create: (args: unknown) => Promise<unknown> };
  sourceLicense: {
    create: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

const BODY = "Corpo editorial proprio e substancial para a noticia. ".repeat(6);

async function seedMovie(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    slug: string;
    title: string;
    withTranslation?: boolean;
    /** A arte da ficha (`movies.poster_path`/`backdrop_path`); ausente = sem arte. */
    posterPath?: string;
    backdropPath?: string;
  },
): Promise<bigint> {
  const movie = await prisma.movie.create({
    data: {
      tmdbId: opts.tmdbId,
      titleOriginal: opts.title,
      posterPath: opts.posterPath ?? null,
      backdropPath: opts.backdropPath ?? null,
    },
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
  // `withTranslation: false` e o caso do portao de localizacao (D3): ficha que
  // chegou do TMDB sem titulo em pt-BR.
  if (opts.withTranslation !== false) {
    await prisma.entityTranslation.create({
      data: {
        entityType: "movie",
        entityId: movie.id,
        languageCode: LANGUAGE,
        title: opts.title,
      },
    });
  }
  return movie.id;
}

async function seedDecision(
  prisma: PrismaLike,
  opts: { entityId: bigint; slug: string; decision: string; isCurrent: boolean; origin?: string },
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

const TMDB_IMAGE_ATTRIBUTION =
  "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.";

/**
 * A licenca de imagem do TMDB (`source_licenses` tmdb/image), na forma que os
 * validadores de ficha ja semeiam. O `db:seed` nao a cria: sem ela, a ficha nao
 * exibe arte do TMDB — e o shard nao pode anunciar imagem.
 */
async function seedTmdbImageLicense(prisma: PrismaLike): Promise<void> {
  await prisma.sourceLicense.create({
    data: {
      sourceKey: "tmdb",
      contentType: "image",
      providerKey: "tmdb",
      territoryCode: null,
      licenseStatus: "official",
      displayAllowed: true,
      logoAllowed: true,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText: TMDB_IMAGE_ATTRIBUTION,
      isCurrent: true,
      decisionOrigin: "validator-harness",
      policyVersion: "cinerie-source-auth/tmdb-image/2026-08-v4",
    },
  });
}

/** Liga ou desliga `display_allowed` da licenca vigente — a revogacao, sem trocar a linha. */
async function setTmdbImageDisplay(prisma: PrismaLike, allowed: boolean): Promise<void> {
  await prisma.sourceLicense.updateMany({
    where: { sourceKey: "tmdb", contentType: "image", isCurrent: true },
    data: { displayAllowed: allowed },
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

interface SitemapXml {
  xml: string;
  contentType: string;
}
interface Seams {
  resolveEntityPageSeo: (key: unknown, facts: unknown, client?: unknown) => Promise<{
    decision: string;
    robots: { index: boolean; follow: boolean };
    includeInSitemap: boolean;
    decisionSource: string;
  }>;
  getCurrentPageIndexabilityDecision: (key: unknown) => Promise<{ decision: string } | null>;
  getMoviePageData: (slug: string) => Promise<{
    seo: { decision: string; decisionSource: string };
    view: { media: { poster: { src: string } | null; backdrop: { src: string } | null } };
  } | null>;
  lookupRedirect: (path: string) => Promise<{ status: string; location: string | null; statusCode: number | null }>;
  clearRedirectCache: () => void;
  getSitemapIndexXml: (opts?: { limit?: number }, client?: unknown) => Promise<SitemapXml>;
  getSitemapShardXml: (id: string, opts?: { limit?: number }, client?: unknown) => Promise<SitemapXml | null>;
  defaultStaticHubDecisions: () => Promise<{
    people: boolean;
    watch: boolean;
    anticipated: boolean;
    watchUpdatedAtIso: string | null;
    authors: readonly { path: string; lastmod: string | null }[];
  }>;
  getNewsArticleData: (slug: string) => Promise<unknown | null>;
  serializeJsonLd: (value: unknown) => string;
  resetDecisionCoverageMemo: () => void;
}

async function runChecks(prisma: PrismaLike, seams: Seams): Promise<void> {
  // ---- Seed --------------------------------------------------------------
  const idIndexed = await seedMovie(prisma, { tmdbId: 96000001, slug: "filme-indexado", title: "Filme Indexado" });
  const idNoindex = await seedMovie(prisma, { tmdbId: 96000002, slug: "filme-noindex", title: "Filme Noindex" });
  const idBlocked = await seedMovie(prisma, { tmdbId: 96000003, slug: "filme-bloqueado", title: "Filme Bloqueado" });
  const idStale = await seedMovie(prisma, { tmdbId: 96000004, slug: "filme-stale", title: "Filme Stale" });
  // Mais 2 filmes elegiveis -> 3 elegiveis, 2 shards com LIMIT=2.
  await seedMovie(prisma, { tmdbId: 96000005, slug: "filme-2", title: "Filme Dois" });
  await seedMovie(prisma, { tmdbId: 96000006, slug: "filme-3", title: "Filme Tres" });

  await seedDecision(prisma, { entityId: idNoindex, slug: "filme-noindex", decision: "index", isCurrent: false });
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
  // 3a noticia elegivel -> 3 elegiveis, 2 shards de news com LIMIT=2.
  await seedArticle(prisma, { slug: "noticia-3", title: "Noticia Tres" });

  // ---- Indexabilidade persistida -----------------------------------------
  const facts = { language: LANGUAGE, hasReliableStructuredData: true, displayedRatings: [], canonicalUrl: `${SITE}/pt/filmes/filme-indexado/` };

  const seoIndexed = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idIndexed, languageCode: LANGUAGE }, facts);
  record(3, "indexacao total: movie sem decisao persistida -> index", seoIndexed.decision === "index" && seoIndexed.includeInSitemap === true, `decision=${seoIndexed.decision}`);

  const movieNoindex = await seams.getMoviePageData("filme-noindex");
  record(4, "decisao persistida noindex chega ao getMoviePageData.seo", movieNoindex?.seo.decision === "noindex" && movieNoindex?.seo.decisionSource === "persisted-decision", `decision=${movieNoindex?.seo.decision}`);

  const current = await seams.getCurrentPageIndexabilityDecision({ entityType: "movie", entityId: idNoindex, languageCode: LANGUAGE });
  record(5, "SO a decisao is_current e consumida (nao a historica index)", current?.decision === "noindex", `is_current=${current?.decision}`);

  const currentCount = await prisma.pageIndexabilityDecision.count({ where: { entityType: "movie", entityId: idNoindex, languageCode: LANGUAGE, isCurrent: true } });
  record(6, "exatamente 1 decisao vigente por entidade/idioma", currentCount === 1, `count=${currentCount}`);

  const seoBlocked = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idBlocked, languageCode: LANGUAGE }, facts);
  record(7, "decisao persistida blocked -> blocked/nofollow/fora do sitemap", seoBlocked.decision === "blocked" && seoBlocked.robots.follow === false, `decision=${seoBlocked.decision}`);

  const seoStale = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idStale, languageCode: LANGUAGE }, facts);
  record(8, "decisao persistida stale -> stale/fora do sitemap", seoStale.decision === "stale" && seoStale.includeInSitemap === false, `decision=${seoStale.decision}`);

  // MUDOU EM 2026-09-11: falha de banco nao e decisao de SEO. Ate essa data este
  // check afirmava `noindex` — que a rota servia com 200 e o ISR GUARDAVA. Agora
  // a leitura que falha LANCA, e a rota responde 5xx (o Next nao cacheia erro).
  // Um `noindex` aqui voltaria a ser regressao, nao "fail-closed".
  const throwingClient = { pageIndexabilityDecision: { findFirst: async () => { throw new Error("db down"); } } };
  let falhaLancou = false;
  let nomeDoErro = "nenhum";
  let decisaoIndevida = "nenhuma";
  try {
    const resolucao = await seams.resolveEntityPageSeo({ entityType: "movie", entityId: idIndexed, languageCode: LANGUAGE }, facts, throwingClient);
    decisaoIndevida = resolucao.decision;
  } catch (error) {
    falhaLancou = true;
    nomeDoErro = (error as Error).name;
  }
  record(9, "falha ao ler decisao vigente LANCA (5xx), nunca vira noindex cacheavel", falhaLancou && nomeDoErro === "IndexabilityDecisionUnavailableError", `lancou=${falhaLancou} erro=${nomeDoErro} decisao-devolvida=${decisaoIndevida}`);

  // ---- Redirects ---------------------------------------------------------
  seams.clearRedirectCache();
  const r301 = await seams.lookupRedirect("/pt/antigo/");
  record(10, "redirect 301 persistido resolve com status 301", r301.status === "resolved" && r301.location === "/pt/filmes/filme-indexado/" && r301.statusCode === 301, `code=${r301.statusCode}`);
  const r302 = await seams.lookupRedirect("/pt/temp/");
  record(11, "redirect 302 persistido resolve com status 302", r302.status === "resolved" && r302.statusCode === 302, `code=${r302.statusCode}`);
  const rAlias = await seams.lookupRedirect("/pt/alias-a/");
  record(12, "alias resolve para o destino", rAlias.status === "resolved" && rAlias.location === "/pt/alias-b/", `loc=${rAlias.location}`);
  const rChain = await seams.lookupRedirect("/pt/c1/");
  record(13, "cadeia A->B->C colapsa no destino final", rChain.status === "resolved" && rChain.location === "/pt/c3/", `loc=${rChain.location}`);
  const rLoop = await seams.lookupRedirect("/pt/loop-a/");
  record(14, "loop detectado -> nenhum redirect emitido", rLoop.status === "loop" && rLoop.location === null, `status=${rLoop.status}`);
  const rNone = await seams.lookupRedirect("/pt/inexistente/");
  record(15, "sem redirect -> none", rNone.status === "none", `status=${rNone.status}`);

  // ---- Sitemap PAGINADO NO BANCO (LIMIT=2) -------------------------------
  const index = await seams.getSitemapIndexXml({ limit: LIMIT });
  const shardEntries = (index.xml.match(/<sitemap>/g) ?? []).length;
  record(16, "index (LIMIT=2): 5 shards incl. movies-2 e news-2 (multiplos shards)",
    shardEntries === 5 && index.xml.includes("sitemap-pt-BR-movies-2.xml") && index.xml.includes("sitemap-pt-BR-news-2.xml") && index.contentType.includes("application/xml"),
    `shards=${shardEntries}`);

  const m1 = await seams.getSitemapShardXml("sitemap-pt-BR-movies-1.xml", { limit: LIMIT });
  const m2 = await seams.getSitemapShardXml("sitemap-pt-BR-movies-2.xml", { limit: LIMIT });
  const m1locs = m1 === null ? [] : locsInXml(m1.xml);
  const m2locs = m2 === null ? [] : locsInXml(m2.xml);
  record(17, "movies shard 1 = 2 URLs (primeira pagina)", m1locs.length === 2, `n=${m1locs.length}`);
  record(18, "movies shard 2 = 1 URL (segunda pagina)", m2locs.length === 1, `n=${m2locs.length}`);
  const movieUnion = new Set([...m1locs, ...m2locs]);
  record(19, "shards de movies: sem repeticao e ordem deterministica (indexado,filme-2|filme-3)",
    movieUnion.size === 3 && (m1locs[0] ?? "").includes("filme-indexado") && (m1locs[1] ?? "").includes("filme-2/") && (m2locs[0] ?? "").includes("filme-3/"),
    `m1=${m1locs.join("|")}`);
  const noExcludedMovie = ![...movieUnion].some((u) => ["filme-noindex", "filme-bloqueado", "filme-stale"].some((s) => u.includes(s)));
  record(20, "movie noindex/blocked/stale EXCLUIDO antes da paginacao", noExcludedMovie, `excluidos_ausentes=${noExcludedMovie}`);

  const n1 = await seams.getSitemapShardXml("sitemap-pt-BR-news-1.xml", { limit: LIMIT });
  const n2 = await seams.getSitemapShardXml("sitemap-pt-BR-news-2.xml", { limit: LIMIT });
  const n1locs = n1 === null ? [] : locsInXml(n1.xml);
  const n2locs = n2 === null ? [] : locsInXml(n2.xml);
  record(21, "news shard 1 = 2 e shard 2 = 1", n1locs.length === 2 && n2locs.length === 1, `n1=${n1locs.length}, n2=${n2locs.length}`);
  const newsUnion = new Set([...n1locs, ...n2locs]);
  const noBadNews = ![...newsUnion].some((u) => ["noticia-bloqueada", "noticia-sem-atrib", "noticia-sem-linkback", "noticia-rascunho"].some((s) => u.includes(s)));
  record(22, "news bloqueada/sem-atrib/sem-linkback/rascunho EXCLUIDA antes da paginacao", noBadNews && newsUnion.size === 3, `distintas=${newsUnion.size}`);

  const m3 = await seams.getSitemapShardXml("sitemap-pt-BR-movies-3.xml", { limit: LIMIT });
  record(23, "shard acima do total -> null (404)", m3 === null, `m3=${m3 === null ? "null" : "obj"}`);

  const badType = await seams.getSitemapShardXml("sitemap-pt-BR-bogus-1.xml", { limit: LIMIT });
  const badPage0 = await seams.getSitemapShardXml("sitemap-pt-BR-movies-0.xml", { limit: LIMIT });
  const badLeadingZero = await seams.getSitemapShardXml("sitemap-pt-BR-movies-01.xml", { limit: LIMIT });
  const badLang = await seams.getSitemapShardXml("sitemap-en-movies-1.xml", { limit: LIMIT });
  const badNoXml = await seams.getSitemapShardXml("sitemap-pt-BR-movies-1", { limit: LIMIT });
  record(24, "shard invalido (tipo/pagina0/zero-a-esquerda/idioma/sem-.xml) -> null",
    badType === null && badPage0 === null && badLeadingZero === null && badLang === null && badNoXml === null,
    `t=${badType === null},p0=${badPage0 === null},lz=${badLeadingZero === null},lang=${badLang === null},xml=${badNoXml === null}`);

  const stat = await seams.getSitemapShardXml("sitemap-pt-BR-static-1.xml", { limit: LIMIT });
  const statLocs = stat === null ? [] : locsInXml(stat.xml);
  // Os hubs que dependem do loader da PROPRIA pagina (pessoas, onde assistir, em
  // breve) entram no shard exatamente quando a pagina diz `index` — a divergencia
  // da auditoria de SEO de 11/09/2026 (secao 3.7). A expectativa vem da mesma
  // funcao que a pagina usa, e nao de um numero fixo desta fixture.
  const hubs = await seams.defaultStaticHubDecisions();
  const hubConfere = (sufixo: string, elegivel: boolean): boolean =>
    statLocs.some((u) => u.endsWith(sufixo)) === elegivel;
  const statOk = statLocs.some((u) => u.endsWith("/pt/filmes/"))
    && statLocs.some((u) => u.endsWith("/pt/noticias/"))
    && statLocs.some((u) => u.endsWith("/pt/explorar/"))
    && !statLocs.some((u) => u.endsWith("/pt/series/"))
    && hubConfere("/pt/pessoas/", hubs.people)
    && hubConfere("/pt/onde-assistir/", hubs.watch)
    && hubConfere("/pt/em-breve/", hubs.anticipated)
    // Autores: a listagem entra quando ha autor com materia no ar, e cada pagina de
    // autor entra com ela — a MESMA lista que as paginas usam.
    && hubConfere("/pt/autores/", hubs.authors.length > 0)
    && hubs.authors.every((author) => statLocs.some((u) => u.endsWith(author.path)))
    // Paginas institucionais: texto fixo, sempre no shard.
    && ["/pt/sobre/", "/pt/politica-editorial/", "/pt/cinerie-score/", "/pt/contato/"].every(
      (sufixo) => statLocs.some((u) => u.endsWith(sufixo)),
    );
  record(25, "shard estatico = rotas elegiveis; pessoas, onde assistir, em breve e autores seguem a decisao da PROPRIA pagina", statOk,
    `n=${statLocs.length} pessoas=${hubs.people} onde_assistir=${hubs.watch} em_breve=${hubs.anticipated} autores=${hubs.authors.length}`);

  const throwing = { $queryRaw: () => { throw new Error("db down"); } };
  const shardFail = await seams.getSitemapShardXml("sitemap-pt-BR-movies-1.xml", { limit: LIMIT }, throwing);
  const idxFail = await seams.getSitemapIndexXml({ limit: LIMIT }, throwing);
  record(26, "fail-closed: erro de banco -> shard null e index sem entradas",
    shardFail === null && idxFail.xml.includes("<sitemapindex") && !idxFail.xml.includes("<sitemap>"),
    `shard=${shardFail === null ? "null" : "obj"}`);

  // Prova de LIMIT no banco: instrumenta o SQL de um shard de movies.
  // @prisma/client e resolvido a partir de @screena/db (dona da dependencia),
  // pois apps/web nao o declara diretamente.
  const prismaClientPath = dbRequire.resolve("@prisma/client");
  const prismaMod = (await import(pathToFileURL(prismaClientPath).href)) as {
    PrismaClient: new (opts: unknown) => unknown;
  };
  const logged = new prismaMod.PrismaClient({ log: [{ emit: "event", level: "query" }] }) as {
    $on: (event: string, cb: (e: { query: string }) => void) => void;
    $disconnect: () => Promise<void>;
  };
  const captured: string[] = [];
  logged.$on("query", (e) => captured.push(e.query));
  await seams.getSitemapShardXml("sitemap-pt-BR-movies-1.xml", { limit: LIMIT }, logged);
  await logged.$disconnect();
  const hasLimit = captured.some((q) => /limit/i.test(q));
  const singleType = !captured.some((q) => /\btv_shows\b|\bpeople\b|\barticle_translations\b/i.test(q));
  record(27, "prova LIMIT no banco: shard de movies aplica LIMIT e nao carrega outros tipos",
    captured.length > 0 && hasLimit && singleType, `queries=${captured.length}, limit=${hasLimit}, single=${singleType}`);

  // ---- Gate de noticias --------------------------------------------------
  record(28, "noticia valida renderiza", (await seams.getNewsArticleData("noticia-valida")) !== null, "ok");
  record(29, "noticia atribuida (fonte+linkback) renderiza", (await seams.getNewsArticleData("noticia-atribuida")) !== null, "ok");
  record(30, "noticia com licenca bloqueada NAO renderiza (404)", (await seams.getNewsArticleData("noticia-bloqueada")) === null, "null");
  record(31, "noticia sem atribuicao exigida NAO renderiza (404)", (await seams.getNewsArticleData("noticia-sem-atrib")) === null, "null");
  record(32, "noticia sem linkback exigido NAO renderiza (404)", (await seams.getNewsArticleData("noticia-sem-linkback")) === null, "null");
  record(33, "noticia nao publicada NAO renderiza (404)", (await seams.getNewsArticleData("noticia-rascunho")) === null, "null");

  // ---- Seguranca JSON-LD -------------------------------------------------
  const js1 = seams.serializeJsonLd({ name: "</script><script>alert(1)</script>" });
  record(34, "JSON-LD neutraliza </script> (sem < > crus)", !js1.includes("</script>") && !js1.includes("<") && !js1.includes(">") && js1.includes("\\u003c"), "ok");
  const js2 = seams.serializeJsonLd({ a: "x & y" });
  record(35, "JSON-LD escapa & -> \\u0026", !js2.includes("&") && js2.includes("\\u0026"), "ok");
  const sep = `linha1${String.fromCharCode(0x2028)}linha2${String.fromCharCode(0x2029)}fim`;
  const js3 = seams.serializeJsonLd({ t: sep });
  record(36, "JSON-LD escapa U+2028/U+2029", js3.includes("\\u2028") && js3.includes("\\u2029") && !js3.includes(String.fromCharCode(0x2028)), "ok");

  // ---- Gate de decisao ARMADO (SQL real, PostgreSQL real) ----------------
  //
  // Tudo acima roda com o gate DESARMADO (3 decisoes vigentes de filme, abaixo
  // do piso) — que e o estado de producao HOJE e o comportamento antigo. Os
  // checks abaixo levam a cobertura ACIMA do piso e provam a regra NOVA contra o
  // SQL de verdade: sem linha vigente `index`, a URL nao entra.
  //
  // Isto existe porque o teste de unidade (tests/governance/sitemap-ceiling)
  // roda contra um banco falso: por mais honesto que o fake seja, quem executa
  // `COALESCE((SELECT ...), $n) = 'index'` e o PostgreSQL. Se o predicado
  // estivesse sintaticamente valido e semanticamente errado, so aqui apareceria.
  const INDEXAVEIS = 600;
  const NOINDEX = 400;
  const SEM_LINHA = 200;
  const TMDB_BASE = 96_100_000;
  const totalArmado = INDEXAVEIS + NOINDEX + SEM_LINHA;
  await prisma.movie.createMany({
    data: Array.from({ length: totalArmado }, (_, i) => ({
      tmdbId: TMDB_BASE + i,
      titleOriginal: `Armado ${i}`,
    })),
  });
  const armados = await prisma.movie.findMany({
    where: { tmdbId: { gte: TMDB_BASE } },
    select: { id: true, tmdbId: true },
    orderBy: { tmdbId: "asc" },
  });
  const rotulo = (i: number): string =>
    i < INDEXAVEIS ? "idx" : i < INDEXAVEIS + NOINDEX ? "no" : "sem";
  await prisma.slug.createMany({
    data: armados.map((m, i) => ({
      entityType: "movie",
      entityId: m.id,
      languageCode: LANGUAGE,
      slug: `armado-${rotulo(i)}-${i}`,
      isCanonical: true,
    })),
  });
  // So os 1.000 primeiros ganham decisao; os 200 ultimos ficam SEM LINHA — que e
  // exatamente a populacao que a regra antiga deixava entrar por omissao.
  await prisma.pageIndexabilityDecision.createMany({
    data: armados.slice(0, INDEXAVEIS + NOINDEX).map((m, i) => ({
      entityType: "movie",
      entityId: m.id,
      languageCode: LANGUAGE,
      url: `${SITE}/pt/filmes/armado-${rotulo(i)}-${i}/`,
      decision: i < INDEXAVEIS ? "index" : "noindex",
      isCurrent: true,
      decisionOrigin: "catalog_policy_engine",
      reason: "seed do validador",
    })),
  });

  const vigentes = await prisma.pageIndexabilityDecision.count({
    where: { entityType: "movie", languageCode: LANGUAGE, isCurrent: true },
  });
  record(37, "cobertura de decisao de filme ultrapassa o piso que arma o gate",
    vigentes >= 1_000, `vigentes=${vigentes}`);

  const BIG = 5_000; // um shard so, para nao paginar 600 URLs de dois em dois
  const armadoShard = await seams.getSitemapShardXml("sitemap-pt-BR-movies-1.xml", { limit: BIG });
  const armadoLocs = armadoShard === null ? [] : locsInXml(armadoShard.xml);
  record(38, "ARMADO: o shard de filmes traz SO os que tem decisao vigente `index`",
    armadoLocs.length === INDEXAVEIS, `n=${armadoLocs.length} (esperado ${INDEXAVEIS})`);

  // O caso central. `filme-indexado`, `filme-2` e `filme-3` NAO tem decisao
  // nenhuma — com a regra antiga eles entravam (checks 17-19 acima provam que
  // entravam, com o gate desarmado). Armado, saem.
  const semLinhaEntrou =
    armadoLocs.some((u) => u.endsWith("/pt/filmes/filme-indexado/")) ||
    armadoLocs.some((u) => u.includes("/pt/filmes/armado-sem-"));
  record(39, "ARMADO: filme SEM linha em page_indexability_decisions NAO entra",
    !semLinhaEntrou, `sem_linha_entrou=${semLinhaEntrou}`);

  record(40, "ARMADO: decisao `index` entra e decisao `noindex` fica fora",
    armadoLocs.some((u) => u.endsWith("/pt/filmes/armado-idx-0/")) &&
      !armadoLocs.some((u) => u.includes("/pt/filmes/armado-no-")),
    `idx_presente=${armadoLocs.some((u) => u.endsWith("/pt/filmes/armado-idx-0/"))}`);

  // A CONTAGEM do index e a PAGINA do shard tem de concordar: se divergirem, o
  // index anuncia N shards que a pagina nao consegue preencher.
  const armadoIndex = await seams.getSitemapIndexXml({ limit: BIG });
  const shardsDeFilme = (armadoIndex.xml.match(/sitemap-pt-BR-movies-\d+\.xml/g) ?? []).length;
  record(41, "ARMADO: contagem do index e pagina do shard concordam (1 shard para 600 URLs)",
    shardsDeFilme === 1, `shards_de_filme=${shardsDeFilme}`);

  // ---- Remediacao 2026-09-11: PAGINA e SITEMAP concordam (SQL real) -------
  //
  // O banco falso da suite de governanca NAO avalia o predicado de localizacao
  // (D3) — ele ignora os parametros que nao conhece. Quem executa
  // `s.slug ~ $n AND NOT EXISTS (...)` e o PostgreSQL. Por isso a prova de que a
  // meta tag e o sitemap dizem a MESMA coisa mora aqui, e nao la.
  //
  // O gate de filme esta ARMADO desde o check 37, e a cobertura da PAGINA e
  // memorizada por um minuto: sem este reset, a pagina leria a cobertura de
  // antes do check 37 (desarmada) e os casos abaixo passariam pelo motivo errado.
  seams.resetDecisionCoverageMemo();

  // (d) A AUSENCIA de decisao, com o gate armado, agora tambem tira da PAGINA.
  const semLinhaNaPagina = await seams.resolveEntityPageSeo(
    { entityType: "movie", entityId: idIndexed, languageCode: LANGUAGE },
    facts,
  );
  record(42, "ARMADO: filme SEM decisao sai tambem da PAGINA (noindex, follow) — o sitemap ja o excluia (39)",
    semLinhaNaPagina.decision === "noindex" &&
      semLinhaNaPagina.robots.follow === true &&
      semLinhaNaPagina.decisionSource === "absent-decision-armed",
    `decision=${semLinhaNaPagina.decision} source=${semLinhaNaPagina.decisionSource}`);

  // D3. Todo filme daqui para baixo recebe decisao vigente `index`: com o gate
  // armado, sem ela a AUSENCIA explicaria a exclusao — e o caso passaria pelo
  // motivo errado. A unica variavel sob teste e o portao.
  // Titulo original em ASCII DE PROPOSITO: o cluster efemero no Windows sobe em
  // WIN1252 e recusa kana (22P05). O portao nao le `title_original` — le so a
  // traducao nos idiomas publicados —, entao a grafia nao muda o que se prova.
  const idFallback = await seedMovie(prisma, {
    tmdbId: 96_200_001,
    slug: "tmdb-96200001",
    title: "Galerie",
    withTranslation: false,
  });
  await seedDecision(prisma, { entityId: idFallback, slug: "tmdb-96200001", decision: "index", isCurrent: true, origin: "catalog_policy_engine" });
  const idLegivel = await seedMovie(prisma, {
    tmdbId: 96_200_002,
    slug: "titulo-legivel",
    title: "Titulo Legivel",
    withTranslation: false,
  });
  await seedDecision(prisma, { entityId: idLegivel, slug: "titulo-legivel", decision: "index", isCurrent: true, origin: "catalog_policy_engine" });

  const locsDeFilme = async (): Promise<string[]> => {
    const shard = await seams.getSitemapShardXml("sitemap-pt-BR-movies-1.xml", { limit: BIG });
    return shard === null ? [] : locsInXml(shard.xml);
  };
  const noSitemap = (locs: string[], slug: string): boolean =>
    locs.some((u) => u.endsWith(`/pt/filmes/${slug}/`));

  const fallbackAntes = await seams.getMoviePageData("tmdb-96200001");
  const locsAntes = await locsDeFilme();
  record(43, "D3: ficha tmdb-N sem titulo e sem descricao => PAGINA noindex pelo portao de qualidade",
    fallbackAntes?.seo.decision === "noindex" && fallbackAntes?.seo.decisionSource === "quality-gate",
    `decision=${fallbackAntes?.seo.decision} source=${fallbackAntes?.seo.decisionSource}`);
  record(44, "D3: a MESMA ficha fica fora do SITEMAP (o predicado rodando no PostgreSQL)",
    !noSitemap(locsAntes, "tmdb-96200001"), `presente=${noSitemap(locsAntes, "tmdb-96200001")}`);

  const legivel = await seams.getMoviePageData("titulo-legivel");
  record(45, "D3: slug LEGIVEL sem traducao nao entra no portao — pagina index E presente no sitemap",
    legivel?.seo.decision === "index" && noSitemap(locsAntes, "titulo-legivel"),
    `decision=${legivel?.seo.decision} presente=${noSitemap(locsAntes, "titulo-legivel")}`);

  // Enriquecida: ganhou titulo em pt-BR. O slug CONTINUA tmdb-N — e mesmo assim a
  // ficha volta, na pagina e no sitemap, sem ninguem rodar comando nenhum.
  await prisma.entityTranslation.create({
    data: { entityType: "movie", entityId: idFallback, languageCode: LANGUAGE, title: "A Galeria" },
  });
  const fallbackDepois = await seams.getMoviePageData("tmdb-96200001");
  const locsDepois = await locsDeFilme();
  record(46, "D3: ao ganhar titulo em pt-BR, a ficha volta a indexar na PAGINA",
    fallbackDepois?.seo.decision === "index", `decision=${fallbackDepois?.seo.decision}`);
  record(47, "D3: e volta ao SITEMAP pelo mesmo motivo — pagina e sitemap concordam nos dois sentidos",
    noSitemap(locsDepois, "tmdb-96200001"), `presente=${noSitemap(locsDepois, "tmdb-96200001")}`);

  // D1: galeria fora do sitemap. O shard antigo responde 404, e o index nao a anuncia.
  const galeriaImagens = await seams.getSitemapShardXml("sitemap-pt-BR-imagens-1.xml", { limit: BIG });
  const galeriaVideos = await seams.getSitemapShardXml("sitemap-pt-BR-videos-1.xml", { limit: BIG });
  const indexFinal = await seams.getSitemapIndexXml({ limit: BIG });
  record(48, "D1: shard de galeria responde 404 e o index nao anuncia galeria",
    galeriaImagens === null && galeriaVideos === null && !/-(imagens|videos)-\d+\.xml/.test(indexFinal.xml),
    `imagens=${galeriaImagens === null ? "404" : "obj"} videos=${galeriaVideos === null ? "404" : "obj"}`);

  // D1, compensacao: a arte da FICHA no sitemap. A galeria saiu do indice; a arte
  // passa a ser anunciada na URL da propria ficha, com `<image:image>`. A licenca
  // e GLOBAL (tmdb/image), entao o MESMO shard e lido sem licenca, com licenca e
  // com a licenca revogada — e em cada estado as imagens dele sao as que a PAGINA
  // exibe. Filme com decisao `index`: o gate de filme esta armado desde o 37.
  const ARTE = { poster: "/posterFilmeComArte.jpg", backdrop: "/backdropFilmeComArte.jpg" };
  const idComArte = await seedMovie(prisma, {
    tmdbId: 96_300_001,
    slug: "filme-com-arte",
    title: "Filme Com Arte",
    posterPath: ARTE.poster,
    backdropPath: ARTE.backdrop,
  });
  await seedDecision(prisma, { entityId: idComArte, slug: "filme-com-arte", decision: "index", isCurrent: true, origin: "catalog_policy_engine" });

  const shardDeFilmes = async (): Promise<string> =>
    (await seams.getSitemapShardXml("sitemap-pt-BR-movies-1.xml", { limit: BIG }))?.xml ?? "";
  /** O conteudo do `<url>` de uma ficha, ou "" quando ela nao esta no shard. */
  const urlDaFicha = (xml: string, slug: string): string =>
    xml
      .split("<url>")
      .slice(1)
      .map((parte) => parte.slice(0, parte.indexOf("</url>")))
      .find((bloco) => bloco.includes(`/pt/filmes/${slug}/</loc>`)) ?? "";
  const imagensDe = (bloco: string): string[] =>
    Array.from(bloco.matchAll(/<image:loc>([^<]*)<\/image:loc>/g), (m) => m[1] ?? "");
  const arteDaPagina = async (slug: string): Promise<string[]> => {
    const media = (await seams.getMoviePageData(slug))?.view.media;
    return [media?.poster?.src, media?.backdrop?.src].filter((src): src is string => src !== undefined);
  };

  const semLicenca = await shardDeFilmes();
  const indexSemLicenca = await seams.getSitemapIndexXml({ limit: BIG });
  const arteSemLicenca = await arteDaPagina("filme-com-arte");
  record(49, "IMAGEM: sem licenca tmdb/image, a ficha fica no shard SEM imagem — e a pagina tambem nao exibe arte",
    urlDaFicha(semLicenca, "filme-com-arte") !== "" && !semLicenca.includes("<image:") && arteSemLicenca.length === 0,
    `ficha=${urlDaFicha(semLicenca, "filme-com-arte") !== ""} imagem=${semLicenca.includes("<image:")} arte-na-pagina=${arteSemLicenca.length}`);

  await seedTmdbImageLicense(prisma);
  const comLicenca = await shardDeFilmes();
  const imagensComLicenca = imagensDe(urlDaFicha(comLicenca, "filme-com-arte"));
  const arteComLicenca = await arteDaPagina("filme-com-arte");
  record(50, "IMAGEM: com licenca, a URL da ficha anuncia EXATAMENTE a arte que a pagina exibe (poster w500, backdrop w1280)",
    comLicenca.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"') &&
      JSON.stringify(imagensComLicenca) ===
        JSON.stringify([`https://image.tmdb.org/t/p/w500${ARTE.poster}`, `https://image.tmdb.org/t/p/w1280${ARTE.backdrop}`]) &&
      JSON.stringify(imagensComLicenca) === JSON.stringify(arteComLicenca),
    `shard=${JSON.stringify(imagensComLicenca)} pagina=${JSON.stringify(arteComLicenca)}`);

  const semArte = urlDaFicha(comLicenca, "titulo-legivel");
  record(51, "IMAGEM: ficha sem arte no banco nao ganha imagem, mesmo com licenca",
    semArte !== "" && imagensDe(semArte).length === 0,
    `ficha=${semArte !== ""} imagens=${imagensDe(semArte).length}`);

  const indexComLicenca = await seams.getSitemapIndexXml({ limit: BIG });
  record(52, "IMAGEM: a imagem nao muda contagem — as MESMAS URLs no shard e os MESMOS shards no index",
    JSON.stringify(locsInXml(comLicenca)) === JSON.stringify(locsInXml(semLicenca)) &&
      JSON.stringify(locsInXml(indexComLicenca.xml)) === JSON.stringify(locsInXml(indexSemLicenca.xml)),
    `urls=${locsInXml(comLicenca).length}/${locsInXml(semLicenca).length} shards=${locsInXml(indexComLicenca.xml).length}/${locsInXml(indexSemLicenca.xml).length}`);

  // Limite do protocolo com a imagem somada (sitemaps.org: 50.000 URLs e
  // 52.428.800 bytes por arquivo): o bloco MEDIDO desta ficha, com as duas
  // imagens, vezes o teto de URLs por shard. O pior caso por comprimento de slug
  // e travado em `packages/seo/src/sitemap-xml-images.test.ts`.
  const bytesPorUrl = Buffer.byteLength(`  <url>${urlDaFicha(comLicenca, "filme-com-arte")}</url>\n`, "utf8");
  const shardCheio = bytesPorUrl * 50_000;
  record(53, "IMAGEM: um shard cheio de URLs como esta (50.000, duas imagens cada) fica abaixo de 50 MB",
    bytesPorUrl > 0 && shardCheio < 52_428_800,
    `bloco=${bytesPorUrl} bytes; 50.000 blocos=${(shardCheio / 1_048_576).toFixed(1)} MB`);

  await setTmdbImageDisplay(prisma, false);
  const revogada = await shardDeFilmes();
  const arteRevogada = await arteDaPagina("filme-com-arte");
  record(54, "IMAGEM: licenca revogada (display_allowed=false) tira a imagem do shard e da pagina, sem tirar a URL",
    !revogada.includes("<image:") &&
      JSON.stringify(locsInXml(revogada)) === JSON.stringify(locsInXml(semLicenca)) &&
      arteRevogada.length === 0,
    `imagem=${revogada.includes("<image:")} urls=${locsInXml(revogada).length} arte-na-pagina=${arteRevogada.length}`);
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
    await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (idiomas/paises/fontes) ---");
    await runChild("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
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
      "getSitemapIndexXml" | "getSitemapShardXml" | "defaultStaticHubDecisions"
    >;
    const newsMod = (await import("../src/server/news-pages.ts")) as Pick<Seams, "getNewsArticleData">;
    const seoMod = (await import("@screena/seo")) as Pick<Seams, "serializeJsonLd">;
    const coverageMod = (await import("../src/server/seo/decision-coverage.ts")) as Pick<
      Seams,
      "resetDecisionCoverageMemo"
    >;

    const seams: Seams = {
      resolveEntityPageSeo: indexabilityMod.resolveEntityPageSeo,
      getCurrentPageIndexabilityDecision: indexabilityMod.getCurrentPageIndexabilityDecision,
      getMoviePageData: moviePageMod.getMoviePageData,
      lookupRedirect: redirectMod.lookupRedirect,
      clearRedirectCache: redirectMod.clearRedirectCache,
      getSitemapIndexXml: sitemapMod.getSitemapIndexXml,
      getSitemapShardXml: sitemapMod.getSitemapShardXml,
      defaultStaticHubDecisions: sitemapMod.defaultStaticHubDecisions,
      getNewsArticleData: newsMod.getNewsArticleData,
      serializeJsonLd: seoMod.serializeJsonLd,
      resetDecisionCoverageMemo: coverageMod.resetDecisionCoverageMemo,
    };

    const prisma = dbServer.getPrismaClient();
    await runChecks(prisma, seams);
  } catch (e) {
    // A causa INTEIRA vai para o log. Ate 2026-09-11 so a primeira linha da
    // mensagem era registrada — e erro do Prisma COMECA com quebra de linha, entao
    // o validador morria dizendo "execucao — " e mais nada. Medido: foi assim que
    // uma queda depois do check 42 apareceu sem causa nenhuma.
    console.error(e);
    const mensagem = e instanceof Error ? e.message : String(e);
    const primeiraLinha =
      mensagem
        .split("\n")
        .map((linha) => linha.trim())
        .find((linha) => linha !== "") ?? "(erro sem mensagem)";
    record(0, "execucao", false, primeiraLinha);
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
  console.log("Resultado: PASSOU. Fase 3 (SEO fonte unica, sitemap paginado no banco) validada.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
