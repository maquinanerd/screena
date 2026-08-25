/**
 * validate-movie-page-real-postgres.ts — Validacao DESCARTAVEL da pagina publica
 * de filme (Fase 4A) contra PostgreSQL REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do produto:
 * nunca roda no render, no build de app, nem em producao. Prova, ponta a ponta e
 * com banco real, o fluxo de leitura da rota /pt/filmes/[slug]:
 *
 *   slug pt-BR -> movie -> entity_translation -> content_blocks -> presenter ->
 *   indexabilidade (index/noindex, politica 2026-07 de indexacao total).
 *
 * Chama DIRETAMENTE `getMoviePageData(slug)` (a mesma camada server-only que a
 * pagina usa) — NAO sobe servidor Next, NAO renderiza React, NAO abre rede.
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO) — o
 * MESMO padrao de `packages/db` e `services/entity-writer`. A CLI do Prisma
 * (migrate/seed) e o schema sao resolvidos a partir de `@screena/db` (dona do
 * schema): nenhuma migration nova e criada e o schema nao e alterado.
 *
 * Seguranca / regras:
 *  - ZERO rede, ZERO Gemini, ZERO TMDB: so le o PostgreSQL efemero local.
 *  - NAO ha segredo: o instance efemero usa a senha descartavel "postgres" so
 *    para o processo local; nada disso e producao.
 *  - NENHUM DATABASE_URL e persistido em disco/.env: existe so como variavel de
 *    ambiente em memoria e e SEMPRE mascarado nos logs (postgres:****).
 *  - O Postgres efemero e DERRUBADO e o diretorio temporario REMOVIDO no
 *    bloco `finally`, mesmo em caso de erro.
 *
 * Uso: pnpm --filter @screena/web validate:movie-page
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

// Resolve a CLI do Prisma e o schema a partir de @screena/db (dona do schema):
// nenhuma migration nova, schema intocado — so aplicamos o que ja existe.
const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const repoRoot = path.resolve(scriptDir, "..", "..", ".."); // raiz do monorepo
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

// Tipos minimos do client e da camada de dados (resolvidos em runtime via import
// dinamico apos DATABASE_URL estar setado). Mantidos locais para nao acoplar o
// script ao Prisma Client gerado em tempo de typecheck.
type PrismaLike = {
  movie: { create: (args: unknown) => Promise<{ id: bigint }> };
  sourceLicense: {
    create: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  contentBlock: { create: (args: unknown) => Promise<unknown> };
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: { create: (args: unknown) => Promise<unknown> };
  entityNewsLink: { create: (args: unknown) => Promise<unknown> };
};

/**
 * A LICENCA DE IMAGEM, semeada porque o render passou a EXIGI-LA.
 *
 * ============================================================================
 * POR QUE ESTE SEED EXISTE (21/08/2026)
 * ============================================================================
 * Ate a PR #209 o caminho `movie-presenter -> imageAsset -> buildTmdbImageUrl`
 * nao consultava licenca nenhuma: o poster ia ao ar sem que nada perguntasse se
 * podia. O gate entrou (`packages/public-contracts/src/image-authorization.ts`
 * + `apps/web/src/server/image-license.ts`) e passou a ler `source_licenses`
 * para `tmdb`/`image` — FAIL-CLOSED: banco sem a linha nega.
 *
 * O banco EFEMERO deste validador nasce de `migrate deploy` + `db:seed`, e
 * NENHUM dos dois materializa licenca de fonte: quem faz isso e
 * `pnpm legal sources apply`, que e um ato de governanca deliberado e nao roda
 * aqui. Sem este seed, o validador media um ambiente que nao existe em lugar
 * nenhum — nem em producao, nem no desenvolvimento — e reprovava o gate por
 * ausencia de dado de governanca, nao por defeito de codigo.
 *
 * Os valores abaixo espelham a entrada "TMDB (imagens)" de
 * `services/legal/src/authorization-spec.ts` (decisao do proprietario,
 * 21/08/2026). Divergir deles faria este validador provar uma licenca que
 * ninguem decidiu.
 */
const TMDB_IMAGE_ATTRIBUTION =
  "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.";

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
      policyVersion: "cinerie-source-auth/tmdb-image/2026-08-v3",
    },
  });
}

/**
 * Liga/desliga a exibicao na licenca VIGENTE — o interruptor do controle
 * negativo.
 *
 * Nao ha `data_usage_decisions` penduradas nesta licenca no harness, entao o
 * trigger `source_licenses_no_downgrade_guard` (migration 20260812120000) nao
 * dispara: ele so recusa rebaixar licenca que sustenta decisao viva.
 */
async function setTmdbImageDisplay(prisma: PrismaLike, allowed: boolean): Promise<void> {
  await prisma.sourceLicense.updateMany({
    where: { sourceKey: "tmdb", contentType: "image", isCurrent: true },
    data: { displayAllowed: allowed },
  });
}

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

/** Cria um movie completo (movie + slugs + translation? + blocks) e retorna o id. */
async function seedMovie(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    titleOriginal: string;
    releaseDate: Date | null;
    runtimeMinutes: number | null;
    posterPath?: string | null;
    backdropPath?: string | null;
    canonicalSlug: string;
    aliasSlug?: string;
    translation?: { title?: string | null; metaTitle?: string | null; metaDescription?: string | null; summary?: string | null };
    blocks?: ReadonlyArray<{ blockType: string; content: string; reviewStatus: string; sourceType?: string }>;
  },
): Promise<string> {
  const movie = await prisma.movie.create({
    data: {
      tmdbId: opts.tmdbId,
      titleOriginal: opts.titleOriginal,
      releaseDate: opts.releaseDate,
      runtimeMinutes: opts.runtimeMinutes,
      posterPath: opts.posterPath ?? null,
      backdropPath: opts.backdropPath ?? null,
    },
    select: { id: true },
  });
  const entityId = movie.id;

  await prisma.slug.create({
    data: { entityType: "movie", entityId, languageCode: LANGUAGE, slug: opts.canonicalSlug, isCanonical: true },
  });
  if (opts.aliasSlug !== undefined) {
    await prisma.slug.create({
      data: { entityType: "movie", entityId, languageCode: LANGUAGE, slug: opts.aliasSlug, isCanonical: false },
    });
  }

  if (opts.translation !== undefined) {
    await prisma.entityTranslation.create({
      data: {
        entityType: "movie",
        entityId,
        languageCode: LANGUAGE,
        title: opts.translation.title ?? null,
        metaTitle: opts.translation.metaTitle ?? null,
        metaDescription: opts.translation.metaDescription ?? null,
        summary: opts.translation.summary ?? null,
      },
    });
  }

  for (const block of opts.blocks ?? []) {
    const sourceType = block.sourceType ?? "human";
    await prisma.contentBlock.create({
      data: {
        entityType: "movie",
        entityId,
        languageCode: LANGUAGE,
        blockType: block.blockType,
        content: block.content,
        sourceType,
        // modelProvider so e exigido por CHECK quando sourceType != human.
        modelProvider: sourceType === "human" ? null : "test-provider",
        modelName: sourceType === "human" ? null : "test-model",
        promptVersion: "test-v1",
        inputHash: "test-input-hash",
        outputHash: "test-output-hash",
        reviewStatus: block.reviewStatus,
      },
    });
  }

  return entityId.toString();
}

/** getMoviePageData tipado minimamente (resolvido por import dinamico). */
type MoviePageData = {
  view: {
    title: string;
    year: number | null;
    runtimeLabel: string | null;
    metaDescription: string | null;
    blocks: ReadonlyArray<{ blockType: string; content: string }>;
    renderableBlockCount: number;
    media: {
      poster: { src: string; width: number; height: number } | null;
      backdrop: { src: string; width: number; height: number } | null;
      hasRealImage: boolean;
    };
  };
  indexability: { decision: string };
  canonicalSlug: string;
  canonicalUrl: string;
  relatedNews: ReadonlyArray<{ title: string; href: string }>;
};
type GetMoviePageData = (slug: string) => Promise<MoviePageData | null>;

async function runChecks(prisma: PrismaLike, getMoviePageData: GetMoviePageData): Promise<void> {
  // A LICENCA DE IMAGEM VEM ANTES DE TUDO: desde 21/08/2026 o poster e o
  // backdrop passam pelo gate de `source_licenses` (tmdb/image). Sem esta linha
  // o banco efemero nega toda arte do TMDB — ver `seedTmdbImageLicense`.
  await seedTmdbImageLicense(prisma);

  // --- A. Filme inexistente -> null. ---------------------------------------
  const missing = await getMoviePageData("slug-que-nao-existe-1234");
  record(3, "A. slug inexistente retorna null", missing === null, `retorno=${missing === null ? "null" : "objeto"}`);

  // --- B. Filme com 0 blocos publicos (so ai_generated/needs_review). ------
  await seedMovie(prisma, {
    tmdbId: 94000001,
    titleOriginal: "Thin Movie Zero",
    releaseDate: new Date("2019-05-10"),
    runtimeMinutes: 95,
    posterPath: "/thin-poster.jpg",
    backdropPath: "/thin-backdrop.jpg",
    canonicalSlug: "filme-thin-zero",
    // Sem metaDescription nem summary -> metaDescription deve sair null (nao inventa).
    translation: { title: "Filme Fininho Zero" },
    blocks: [
      { blockType: "editorial_intro", content: "rascunho IA", reviewStatus: "ai_generated", sourceType: "ai" },
      { blockType: "faq", content: "aguardando revisao", reviewStatus: "needs_review", sourceType: "ai" },
    ],
  });
  const thinZero = await getMoviePageData("filme-thin-zero");
  record(4, "B. filme com 0 blocos publicos retorna dados (nao null)", thinZero !== null, `retorno=${thinZero ? "objeto" : "null"}`);
  record(5, "B. renderableBlockCount === 0", thinZero?.view.renderableBlockCount === 0, `count=${thinZero?.view.renderableBlockCount}`);
  record(6, "B. indexability.decision === index (indexacao total; 0 blocos e sinal de qualidade, nao gate)", thinZero?.indexability.decision === "index", `decision=${thinZero?.indexability.decision}`);
  record(
    7,
    "B/G. metaDescription NAO inventada (null sem dado)",
    thinZero?.view.metaDescription === null,
    `metaDescription=${thinZero?.view.metaDescription === null ? "null" : JSON.stringify(thinZero?.view.metaDescription)}`,
  );
  record(
    8,
    "B/E. nenhum bloco ai_generated/needs_review em view.blocks",
    (thinZero?.view.blocks.length ?? -1) === 0,
    `blocos visiveis=${thinZero?.view.blocks.length}`,
  );
  record(
    24,
    "H. path cru do TMDB vira imagem REMOTA (nunca local/filesystem)",
    thinZero?.view.media.hasRealImage === true &&
      (thinZero?.view.media.poster?.src?.startsWith("https://") ?? false) &&
      (thinZero?.view.media.backdrop?.src?.startsWith("https://") ?? false),
    `poster=${thinZero?.view.media.poster?.src}`,
  );

  // --- C. Filme com 1 bloco publico -> ainda index (indexacao total; o ------
  // bloco vira sinal de qualidade/ranqueamento, nao pre-requisito). ---------
  await seedMovie(prisma, {
    tmdbId: 94000002,
    titleOriginal: "One Block Movie",
    releaseDate: new Date("2020-01-01"),
    runtimeMinutes: 100,
    canonicalSlug: "filme-um-bloco",
    translation: { title: "Filme de Um Bloco" },
    blocks: [
      { blockType: "editorial_intro", content: "introducao publicada", reviewStatus: "published" },
      { blockType: "cast_intro", content: "rascunho IA", reviewStatus: "ai_generated", sourceType: "ai" },
    ],
  });
  const oneBlock = await getMoviePageData("filme-um-bloco");
  record(9, "C. renderableBlockCount === 1", oneBlock?.view.renderableBlockCount === 1, `count=${oneBlock?.view.renderableBlockCount}`);
  record(10, "C. indexability.decision === index (indexacao total; 1 bloco nao gateia mais)", oneBlock?.indexability.decision === "index", `decision=${oneBlock?.indexability.decision}`);

  // --- D. Filme com 2 blocos publicos -> index (e hasUniqueValue=true). ----
  // Tambem cobre E (seguranca de blocos), F (canonical) e G (presenter).
  const richId = await seedMovie(prisma, {
    tmdbId: 94000003,
    titleOriginal: "Interstellar",
    releaseDate: new Date("2014-11-06"),
    runtimeMinutes: 169,
    posterPath: "/media/movies/rich-poster.webp",
    backdropPath: "/uploads/movies/rich-backdrop.jpg",
    canonicalSlug: "interestelar",
    aliasSlug: "interestelar-antigo",
    translation: {
      title: "Interestelar",
      metaTitle: "Interestelar (2014) — Filme",
      metaDescription: "Descricao editorial pt-BR ja existente no banco.",
    },
    blocks: [
      { blockType: "editorial_intro", content: "Introducao editorial revisada.", reviewStatus: "published" },
      { blockType: "faq", content: "Perguntas frequentes revisadas.", reviewStatus: "human_reviewed" },
      { blockType: "cast_intro", content: "rascunho IA (nao deve aparecer)", reviewStatus: "ai_generated", sourceType: "ai" },
      { blockType: "where_to_watch_text", content: "aguardando revisao (nao deve aparecer)", reviewStatus: "needs_review", sourceType: "ai" },
      { blockType: "summary_without_spoilers", content: "draft (nao deve aparecer)", reviewStatus: "draft", sourceType: "ai" },
      { blockType: "news_context", content: "arquivado (nao deve aparecer)", reviewStatus: "archived", sourceType: "ai" },
    ],
  });
  // 4G: noticias relacionadas reais via EntityNewsLink. A publicada aparece; o
  // rascunho e noindex sao descartados pelo gate de related news.
  await seedRelatedArticle(prisma, { slug: "noticia-do-filme", title: "Noticia do Filme", reviewStatus: "published", entityType: "movie", entityId: BigInt(richId) });
  await seedRelatedArticle(prisma, { slug: "rascunho-do-filme", title: "Rascunho", reviewStatus: "draft", entityType: "movie", entityId: BigInt(richId) });
  await seedRelatedArticle(prisma, { slug: "noindex-do-filme", title: "Noindex", reviewStatus: "published", indexStatus: "noindex", entityType: "movie", entityId: BigInt(richId) });

  // F: consulta pelo slug ALIAS (nao-canonico) para provar que o canonical
  // resolvido vem do slug canonico, nao do slug consultado.
  const richByAlias = await getMoviePageData("interestelar-antigo");
  record(11, "D. filme com 2 blocos publicos retorna dados", richByAlias !== null, `retorno=${richByAlias ? "objeto" : "null"}`);
  record(12, "D. renderableBlockCount === 2", richByAlias?.view.renderableBlockCount === 2, `count=${richByAlias?.view.renderableBlockCount}`);
  record(13, "D. indexability.decision === index", richByAlias?.indexability.decision === "index", `decision=${richByAlias?.indexability.decision}`);
  record(
    27,
    "4G. noticia relacionada publicada aparece; rascunho/noindex fora; linka /pt/noticias/",
    richByAlias?.relatedNews.length === 1 && richByAlias?.relatedNews[0]?.href === "/pt/noticias/noticia-do-filme/",
    `related=[${(richByAlias?.relatedNews ?? []).map((r) => r.href).join(", ")}]`,
  );

  const visibleTypes = (richByAlias?.view.blocks ?? []).map((b) => b.blockType).sort();
  record(
    14,
    "E. apenas published/human_reviewed aparecem (editorial_intro, faq)",
    JSON.stringify(visibleTypes) === JSON.stringify(["editorial_intro", "faq"]),
    `visiveis=[${visibleTypes.join(", ")}]`,
  );
  const leakedNonPublic = visibleTypes.some((t) =>
    ["cast_intro", "where_to_watch_text", "summary_without_spoilers", "news_context"].includes(t),
  );
  record(15, "E. nenhum bloco nao-publico vazou para view.blocks", !leakedNonPublic, `vazou=${leakedNonPublic}`);

  record(16, "F. canonicalSlug e o slug canonico (nao o alias consultado)", richByAlias?.canonicalSlug === "interestelar", `canonicalSlug=${richByAlias?.canonicalSlug}`);
  record(
    17,
    "F. canonicalUrl usa o slug canonico pt-BR",
    richByAlias?.canonicalUrl === "https://cinerie.com/pt/filmes/interestelar/",
    `canonicalUrl=${richByAlias?.canonicalUrl}`,
  );

  record(18, "G. titulo vem da traducao pt-BR", richByAlias?.view.title === "Interestelar", `title=${richByAlias?.view.title}`);
  record(19, "G. ano derivado de release_date (2014)", richByAlias?.view.year === 2014, `year=${richByAlias?.view.year}`);
  record(20, "G. runtimeLabel derivado (169 min -> 2 h 49 min)", richByAlias?.view.runtimeLabel === "2 h 49 min", `runtimeLabel=${richByAlias?.view.runtimeLabel}`);
  record(
    21,
    "G. metaDescription preservada quando existe (nao inventada)",
    richByAlias?.view.metaDescription === "Descricao editorial pt-BR ja existente no banco.",
    `metaDescription=${JSON.stringify(richByAlias?.view.metaDescription)}`,
  );
  record(
    25,
    "H. poster local seguro aparece na view",
    richByAlias?.view.media.poster?.src === "/media/movies/rich-poster.webp",
    `poster=${richByAlias?.view.media.poster?.src ?? "null"}`,
  );
  record(
    26,
    "H. backdrop local seguro aparece na view",
    richByAlias?.view.media.backdrop?.src === "/uploads/movies/rich-backdrop.jpg",
    `backdrop=${richByAlias?.view.media.backdrop?.src ?? "null"}`,
  );

  // --- G(extra). Sem traducao -> titulo cai para titleOriginal. ------------
  await seedMovie(prisma, {
    tmdbId: 94000004,
    titleOriginal: "Original Title Only",
    releaseDate: null,
    runtimeMinutes: null,
    canonicalSlug: "filme-sem-traducao",
    blocks: [],
  });
  const noTranslation = await getMoviePageData("filme-sem-traducao");
  record(22, "G. sem traducao, titulo cai para titleOriginal", noTranslation?.view.title === "Original Title Only", `title=${noTranslation?.view.title}`);
  record(23, "G. sem release_date/runtime, ano e runtimeLabel sao null", noTranslation?.view.year === null && noTranslation?.view.runtimeLabel === null, `year=${noTranslation?.view.year}, runtimeLabel=${noTranslation?.view.runtimeLabel}`);

  // --- I. O GATE DE LICENCA DA IMAGEM, contra o banco REAL. ----------------
  //
  // O check 24 acima prova que a arte do TMDB APARECE. Sozinho, ele passaria
  // igual se o gate nao existisse — que e exatamente o estado de antes da PR
  // #209. O que falta provar e o outro lado: que `display_allowed` MANDA.
  //
  // E aqui, e nao no teste puro, porque so aqui existe a consulta real:
  // `getImageDisplayAuthorization` -> Prisma -> `source_licenses`. Um teste
  // puro alimenta a autorizacao a mao e nunca descobre que o adapter le a
  // coluna errada, a chave errada ou a linha nao vigente.
  //
  // CADA CASO USA UM SLUG NOVO, nunca consultado antes. `getMoviePageData` e
  // envolvido por `cache()` do React; reconsultar o MESMO slug depois de virar
  // o flag poderia devolver memoria em vez de banco e o controle negativo
  // passaria pelo motivo errado.
  await seedMovie(prisma, {
    tmdbId: 94000005,
    titleOriginal: "Gated Movie Off",
    releaseDate: new Date("2021-03-03"),
    runtimeMinutes: 100,
    posterPath: "/gated-off-poster.jpg",
    backdropPath: "/gated-off-backdrop.jpg",
    canonicalSlug: "filme-licenca-negada",
    blocks: [],
  });
  await seedMovie(prisma, {
    tmdbId: 94000006,
    titleOriginal: "Gated Movie On",
    releaseDate: new Date("2021-04-04"),
    runtimeMinutes: 100,
    posterPath: "/gated-on-poster.jpg",
    backdropPath: "/gated-on-backdrop.jpg",
    canonicalSlug: "filme-licenca-restaurada",
    blocks: [],
  });

  await setTmdbImageDisplay(prisma, false);
  const licenseOff = await getMoviePageData("filme-licenca-negada");
  record(
    28,
    "I. CONTROLE NEGATIVO: display_allowed=false em source_licenses APAGA poster e backdrop",
    licenseOff !== null &&
      licenseOff.view.media.poster === null &&
      licenseOff.view.media.backdrop === null &&
      licenseOff.view.media.hasRealImage === false,
    `poster=${licenseOff?.view.media.poster?.src ?? "null"}, backdrop=${licenseOff?.view.media.backdrop?.src ?? "null"}`,
  );

  await setTmdbImageDisplay(prisma, true);
  const licenseOn = await getMoviePageData("filme-licenca-restaurada");
  record(
    29,
    "I. a arte VOLTA quando a licenca vigente volta a permitir (o flag manda)",
    (licenseOn?.view.media.poster?.src?.startsWith("https://") ?? false) &&
      (licenseOn?.view.media.backdrop?.src?.startsWith("https://") ?? false),
    `poster=${licenseOn?.view.media.poster?.src ?? "null"}`,
  );
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-web-pg-"));
  // persistent:true evita o cleanup interno (um `fs.rm` sem retry logo apos o
  // taskkill) que no Windows corre com o handle do data dir; NOS removemos o
  // mkdtemp unico no finally.
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_web_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_web_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_web_validation");

    // DATABASE_URL so em memoria (nunca em disco/.env); o singleton do Prisma o le.
    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy (schema existente; sem migration nova) ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (idiomas/paises/fontes existentes) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- fluxo da pagina de filme no banco real (getMoviePageData) ---");
    // Import dinamico DEPOIS de DATABASE_URL: o singleton do Prisma e criado sob
    // demanda na 1a query, ja apontando para o Postgres efemero.
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const moviePage = (await import("../src/server/movie-page.ts")) as {
      getMoviePageData: GetMoviePageData;
    };

    const prisma = dbServer.getPrismaClient();
    await runChecks(prisma, moviePage.getMoviePageData);
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
    // Windows pode segurar o handle do data dir por instantes apos pg.stop():
    // rmSync com retries cobre o EBUSY/EPERM tipico. Best-effort se ainda falhar.
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
  console.log("Resultado: PASSOU. Pagina de filme validada lendo PostgreSQL real (indexacao total, invariante 5).");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
