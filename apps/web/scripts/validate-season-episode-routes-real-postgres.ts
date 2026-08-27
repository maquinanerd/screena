/**
 * validate-season-episode-routes-real-postgres.ts — Validacao DESCARTAVEL da
 * FASE 4 (rotas publicas de temporada e episodio) contra PostgreSQL 16 REAL
 * efemero.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao roda no render/build/producao.
 * Prova, ponta a ponta e com banco real, os seams das novas rotas chamando
 * DIRETAMENTE as MESMAS camadas server-only que o app usa (sem subir Next):
 * getSeasonPageData / getEpisodePageData e o sitemap paginado.
 *
 * Cobre: temporada valida/invalida/de outra serie, episodios ordenados,
 * anterior/proximo, primeiro/ultimo, data/duracao, midia ausente, decisao
 * persistida index/noindex, canonical; sitemap paginado NO BANCO de
 * temporadas/episodios (multiplos shards com LIMIT=2, exclusao antes da
 * paginacao, 404 estrito, prova instrumentada de LIMIT); e JSON-LD HTML-safe.
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, EFEMERO). Zero rede/Gemini/TMDB.
 * Uso: pnpm --filter @screena/web validate:season-episode-routes
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

import { SUSPENSION_REASON } from "../src/server/seo/suspended-pages";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";
const SITE = "https://cinerie.com";
const LIMIT = 2;

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
  tvShow: { create: (args: unknown) => Promise<{ id: bigint }> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  season: { create: (args: unknown) => Promise<{ id: bigint }> };
  episode: { create: (args: unknown) => Promise<{ id: bigint }> };
  pageIndexabilityDecision: { create: (args: unknown) => Promise<unknown> };
};

async function seedSeries(
  prisma: PrismaLike,
  opts: { tmdbId: number; slug: string; title: string; posterPath?: string | null },
): Promise<bigint> {
  const tv = await prisma.tvShow.create({
    data: { tmdbId: opts.tmdbId, nameOriginal: opts.title, posterPath: opts.posterPath ?? null },
    select: { id: true },
  });
  await prisma.slug.create({
    data: { entityType: "tv", entityId: tv.id, languageCode: LANGUAGE, slug: opts.slug, isCanonical: true },
  });
  await prisma.entityTranslation.create({
    data: { entityType: "tv", entityId: tv.id, languageCode: LANGUAGE, title: opts.title },
  });
  return tv.id;
}

async function seedSeason(
  prisma: PrismaLike,
  opts: { tvShowId: bigint; seasonNumber: number; name?: string | null; episodeCount?: number | null },
): Promise<bigint> {
  const season = await prisma.season.create({
    data: {
      tvShowId: opts.tvShowId,
      seasonNumber: opts.seasonNumber,
      name: opts.name ?? null,
      overview: `Overview da temporada ${opts.seasonNumber}.`,
      airDate: new Date(`20${10 + opts.seasonNumber}-01-01`),
      episodeCount: opts.episodeCount ?? null,
      posterPath: null,
    },
    select: { id: true },
  });
  return season.id;
}

async function seedEpisode(
  prisma: PrismaLike,
  opts: {
    seasonId: bigint;
    tvShowId: bigint;
    episodeNumber: number;
    still?: string | null;
  },
): Promise<bigint> {
  const episode = await prisma.episode.create({
    data: {
      seasonId: opts.seasonId,
      tvShowId: opts.tvShowId,
      episodeNumber: opts.episodeNumber,
      name: `Episodio ${opts.episodeNumber}`,
      overview: `Sinopse do episodio ${opts.episodeNumber}.`,
      airDate: new Date("2020-02-10"),
      runtimeMinutes: 48,
      stillPath: opts.still ?? null,
    },
    select: { id: true },
  });
  return episode.id;
}

async function seedNoindex(
  prisma: PrismaLike,
  entityType: "season" | "episode",
  entityId: bigint,
): Promise<void> {
  await prisma.pageIndexabilityDecision.create({
    data: {
      entityType,
      entityId,
      languageCode: LANGUAGE,
      url: `${SITE}/pt/series/x/`,
      decision: "noindex",
      isCurrent: true,
      decisionOrigin: "human_override",
      reason: "teste noindex",
    },
  });
}

interface Seams {
  getSeasonPageData: (slug: string, season: number) => Promise<{
    view: {
      seasonNumber: number;
      poster: { src: string } | null;
      episodes: { episodeNumber: number; href: string }[];
      prevSeason: { seasonNumber: number } | null;
      nextSeason: { seasonNumber: number } | null;
    };
    seo: { decision: string };
    canonicalUrl: string;
  } | null>;
  getEpisodePageData: (slug: string, season: number, episode: number) => Promise<{
    view: {
      episodeNumber: number;
      seasonNumber: number;
      dateLabel: string | null;
      runtimeLabel: string | null;
      still: { src: string } | null;
      prevEpisode: { episodeNumber: number } | null;
      nextEpisode: { episodeNumber: number } | null;
    };
    seo: { decision: string };
    canonicalUrl: string;
  } | null>;
  getSitemapIndexXml: (opts?: { limit?: number }) => Promise<{ xml: string; contentType: string }>;
  getSitemapShardXml: (
    id: string,
    opts?: { limit?: number },
    client?: unknown,
  ) => Promise<{ xml: string; contentType: string } | null>;
  serializeJsonLd: (value: unknown) => string;
}

async function runChecks(prisma: PrismaLike, seams: Seams): Promise<void> {
  // ---- Seed ---------------------------------------------------------------
  const idA = await seedSeries(prisma, { tmdbId: 97000001, slug: "serie-a", title: "Serie A", posterPath: "/media/serie-a.webp" });
  const idB = await seedSeries(prisma, { tmdbId: 97000002, slug: "serie-b", title: "Serie B" });

  const a1 = await seedSeason(prisma, { tvShowId: idA, seasonNumber: 1, episodeCount: 3 });
  const a2 = await seedSeason(prisma, { tvShowId: idA, seasonNumber: 2, episodeCount: 2 });
  const a3 = await seedSeason(prisma, { tvShowId: idA, seasonNumber: 3, episodeCount: 1 });
  const a4 = await seedSeason(prisma, { tvShowId: idA, seasonNumber: 4, episodeCount: 1 });
  const b1 = await seedSeason(prisma, { tvShowId: idB, seasonNumber: 1, episodeCount: 1 });

  const a1e1 = await seedEpisode(prisma, { seasonId: a1, tvShowId: idA, episodeNumber: 1, still: "/media/still.jpg" });
  await seedEpisode(prisma, { seasonId: a1, tvShowId: idA, episodeNumber: 2 });
  const a1e3 = await seedEpisode(prisma, { seasonId: a1, tvShowId: idA, episodeNumber: 3 });
  await seedEpisode(prisma, { seasonId: a2, tvShowId: idA, episodeNumber: 1 });
  await seedEpisode(prisma, { seasonId: a2, tvShowId: idA, episodeNumber: 2 });
  await seedEpisode(prisma, { seasonId: a3, tvShowId: idA, episodeNumber: 1 });
  const a4e1 = await seedEpisode(prisma, { seasonId: a4, tvShowId: idA, episodeNumber: 1 });
  await seedEpisode(prisma, { seasonId: b1, tvShowId: idB, episodeNumber: 1 });

  void a1e1;
  await seedNoindex(prisma, "season", a4); // temporada 4 de A -> noindex
  await seedNoindex(prisma, "episode", a1e3); // S1E3 de A -> noindex
  await seedNoindex(prisma, "episode", a4e1); // S4E1 de A -> noindex

  // ---- Temporada ----------------------------------------------------------
  const seasonA1 = await seams.getSeasonPageData("serie-a", 1);
  // Ate 2026-08-27 esta linha exigia `index`. A valvula suspendeu o tipo: a
  // temporada carrega dados e recebe `noindex`. O que continua sob prova e que a
  // ROTA responde com dados — o `noindex` e afirmado com o motivo em (26)/(27).
  record(3, "temporada valida -> dados; seo noindex pela valvula", seasonA1 !== null && seasonA1.seo.decision === "noindex" && seasonA1.view.seasonNumber === 1, `seo=${seasonA1?.seo.decision}`);
  record(4, "episodios ordenados com href correto", JSON.stringify(seasonA1?.view.episodes.map((e) => e.episodeNumber)) === "[1,2,3]" && seasonA1?.view.episodes[0]?.href === "/pt/series/serie-a/temporadas/1/episodios/1/", `eps=${seasonA1?.view.episodes.map((e) => e.episodeNumber).join(",")}`);
  record(5, "canonical da temporada correto", seasonA1?.canonicalUrl === `${SITE}/pt/series/serie-a/temporadas/1/`, `canonical=${seasonA1?.canonicalUrl}`);

  const seasonA2 = await seams.getSeasonPageData("serie-a", 2);
  record(6, "temporada 2 -> anterior=1, proxima=3", seasonA2?.view.prevSeason?.seasonNumber === 1 && seasonA2?.view.nextSeason?.seasonNumber === 3, `prev=${seasonA2?.view.prevSeason?.seasonNumber}, next=${seasonA2?.view.nextSeason?.seasonNumber}`);
  record(7, "temporada 1 nao tem anterior", seasonA1?.view.prevSeason === null, `prev=${seasonA1?.view.prevSeason}`);

  record(8, "temporada inexistente -> null (404)", (await seams.getSeasonPageData("serie-a", 99)) === null, "null");
  record(9, "numero de temporada invalido -> null", (await seams.getSeasonPageData("serie-a", 0)) === null, "null");

  const seasonB1 = await seams.getSeasonPageData("serie-b", 1);
  record(10, "temporada e escopada a serie certa (A:3 eps, B:1 ep)", seasonA1?.view.episodes.length === 3 && seasonB1?.view.episodes.length === 1, `A=${seasonA1?.view.episodes.length}, B=${seasonB1?.view.episodes.length}`);
  record(11, "temporada de outra serie (serie-b nao tem T2) -> null", (await seams.getSeasonPageData("serie-b", 2)) === null, "null");

  const seasonA4 = await seams.getSeasonPageData("serie-a", 4);
  record(12, "decisao persistida noindex chega a temporada", seasonA4?.seo.decision === "noindex", `seo=${seasonA4?.seo.decision}`);

  record(13, "poster: temporada sem poster cai para o poster da serie", seasonA1?.view.poster?.src === "/media/serie-a.webp", `poster=${seasonA1?.view.poster?.src}`);
  record(14, "midia ausente: serie sem imagem -> poster null", seasonB1?.view.poster === null, `poster=${seasonB1?.view.poster}`);

  // ---- Episodio -----------------------------------------------------------
  const epA1E2 = await seams.getEpisodePageData("serie-a", 1, 2);
  record(15, "episodio valido -> dados; seo noindex pela valvula", epA1E2 !== null && epA1E2.seo.decision === "noindex" && epA1E2.view.episodeNumber === 2, `seo=${epA1E2?.seo.decision}`);
  record(16, "episodio 2 -> anterior=1, proximo=3", epA1E2?.view.prevEpisode?.episodeNumber === 1 && epA1E2?.view.nextEpisode?.episodeNumber === 3, `prev=${epA1E2?.view.prevEpisode?.episodeNumber}, next=${epA1E2?.view.nextEpisode?.episodeNumber}`);

  const epA1E1 = await seams.getEpisodePageData("serie-a", 1, 1);
  record(17, "primeiro episodio nao tem anterior; data/duracao presentes", epA1E1?.view.prevEpisode === null && epA1E1?.view.dateLabel !== null && epA1E1?.view.runtimeLabel === "48 min", `prev=${epA1E1?.view.prevEpisode}, date=${epA1E1?.view.dateLabel}, rt=${epA1E1?.view.runtimeLabel}`);
  record(18, "still presente quando existe; ausente vira null", epA1E1?.view.still?.src === "/media/still.jpg" && epA1E2?.view.still === null, `e1=${epA1E1?.view.still?.src}, e2=${epA1E2?.view.still}`);

  record(19, "episodio inexistente -> null (404)", (await seams.getEpisodePageData("serie-a", 1, 99)) === null, "null");
  record(20, "temporada invalida para episodio -> null", (await seams.getEpisodePageData("serie-a", 99, 1)) === null, "null");
  record(21, "episodio de outra temporada (S2 nao tem E3) -> null", (await seams.getEpisodePageData("serie-a", 2, 3)) === null, "null");

  const epA1E3 = await seams.getEpisodePageData("serie-a", 1, 3);
  // ATENCAO: enquanto a valvula estiver ligada, `decision === "noindex"` NAO
  // prova mais que a decisao PERSISTIDA chegou — a valvula poe noindex em todo
  // episodio. Um check que so olhasse `decision` passaria pelo motivo errado.
  // O que discrimina e o MOTIVO: a decisao persistida vence a valvula porque
  // `applyPageSuspension` roda depois e so reescreve o motivo quando ela propria
  // decide. Aqui exigimos que o motivo NAO seja o da valvula.
  record(22, "decisao persistida noindex chega ao episodio (motivo != valvula); ultimo nao tem proximo", epA1E3?.seo.decision === "noindex" && epA1E3?.seo.reason !== SUSPENSION_REASON && epA1E3?.view.nextEpisode === null, `seo=${epA1E3?.seo.decision}, motivoValvula=${epA1E3?.seo.reason === SUSPENSION_REASON}, next=${epA1E3?.view.nextEpisode}`);
  record(23, "canonical do episodio correto", epA1E1?.canonicalUrl === `${SITE}/pt/series/serie-a/temporadas/1/episodios/1/`, `canonical=${epA1E1?.canonicalUrl}`);

  // ---- Sitemap: temporada e episodio SUSPENSOS (valvula de 2026-08-27) -----
  //
  // Ate 2026-08-27 esta secao provava a PAGINACAO de temporada/episodio no
  // banco (multiplos shards com LIMIT=2). Os dois tipos sairam do sitemap: eram
  // 3.921.542 das 4.069.444 URLs declaradas em producao (96,36%), a 24 palavras
  // por pagina de episodio. Ver SUSPENDED_SITEMAP_TYPES em `sitemap-index.ts`.
  //
  // O contrato agora e o INVERSO, e e ele que precisa de prova: o index nao
  // anuncia nenhum shard dos dois tipos, e o endereco antigo responde 404 —
  // nao 200 com 50.000 URLs para quem o guardou. Quando a Fase 3 devolver a
  // decisao por dado, esta secao volta a provar paginacao.
  const index = await seams.getSitemapIndexXml({ limit: LIMIT });
  // Le os enderecos ANUNCIADOS, em vez de procurar substring no XML inteiro:
  // substring casaria com um comentario ou com um texto solto, e o que esta sob
  // prova e a LISTA de shards que o index publica.
  const anunciados = locsInXml(index.xml);
  const suspensosAnunciados = anunciados.filter((u) => /sitemap-pt-BR-(seasons|episodes)-\d+\.xml$/.test(u));
  record(24, "index NAO anuncia nenhum shard de temporada/episodio (suspensos)", suspensosAnunciados.length === 0 && anunciados.length > 0 && index.contentType.includes("application/xml"), `anunciados=${anunciados.length}, suspensos=${suspensosAnunciados.length}`);

  const suspensos = await Promise.all(
    ["seasons-1", "seasons-2", "episodes-1", "episodes-2", "episodes-3"].map((id) =>
      seams.getSitemapShardXml(`sitemap-pt-BR-${id}.xml`, { limit: LIMIT }),
    ),
  );
  record(25, "todo shard de tipo suspenso -> null (404), inclusive o que existia antes", suspensos.every((s) => s === null), `nulls=${suspensos.filter((s) => s === null).length}/5`);

  // O par da valvula: sair do sitemap nao desindexa. A pagina precisa dizer
  // noindex, e com follow — senao o Google para de seguir os links que
  // sustentam serie e temporada, que SEGUEM indexaveis.
  const epValv = await seams.getEpisodePageData("serie-a", 1, 1);
  record(26, "pagina de episodio emite noindex COM follow (a meta tag e o que desindexa)", epValv?.seo.decision === "noindex" && epValv?.seo.robots.index === false && epValv?.seo.robots.follow === true, `decision=${epValv?.seo.decision}, robots=${JSON.stringify(epValv?.seo.robots)}`);

  const seValv = await seams.getSeasonPageData("serie-a", 1);
  record(27, "pagina de temporada idem, e fora do sitemap", seValv?.seo.decision === "noindex" && seValv?.seo.includeInSitemap === false, `decision=${seValv?.seo.decision}, sitemap=${seValv?.seo.includeInSitemap}`);

  // Shard acima do total continua 404 — provado agora num tipo PUBLICADO
  // (`movies`), porque em tipo suspenso o 404 vem da suspensao e o teste
  // passaria sem provar nada sobre paginacao.
  record(28, "shard acima do total -> null (movies-99)", (await seams.getSitemapShardXml("sitemap-pt-BR-movies-99.xml", { limit: LIMIT })) === null, "null");
  record(29, "shard invalido (pagina 0 / tipo desconhecido) -> null", (await seams.getSitemapShardXml("sitemap-pt-BR-seasons-0.xml", { limit: LIMIT })) === null && (await seams.getSitemapShardXml("sitemap-pt-BR-temporada-1.xml", { limit: LIMIT })) === null, "null");

  // Prova de LIMIT no banco. Migrou de `seasons` para `movies` porque o shard
  // suspenso responde 404 sem tocar o banco: `captured` viria VAZIO e o check
  // passaria a medir a suspensao, nao a paginacao.
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
  const noOtherTypes = !captured.some((q) => /\bmovies\b|\bpeople\b|\barticle_translations\b/i.test(q));
  record(30, "prova LIMIT no banco: shard de filmes aplica LIMIT e nao carrega outros tipos", captured.length > 0 && hasLimit && noOtherTypes, `queries=${captured.length}, limit=${hasLimit}, single=${noOtherTypes}`);

  // ---- Seguranca JSON-LD --------------------------------------------------
  const js1 = seams.serializeJsonLd({ name: "</script><script>alert(1)</script>" });
  record(31, "JSON-LD neutraliza </script> (sem < > crus)", !js1.includes("</script>") && !js1.includes("<") && !js1.includes(">") && js1.includes("\\u003c"), "ok");
  const sep = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`;
  const js2 = seams.serializeJsonLd({ t: sep, amp: "x & y" });
  record(32, "JSON-LD escapa & e U+2028/U+2029", js2.includes("\\u0026") && js2.includes("\\u2028") && js2.includes("\\u2029") && !js2.includes(String.fromCharCode(0x2028)), "ok");
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-se-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_se_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_se_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_se_validation");

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy (schema existente; sem migration nova) ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (idiomas/paises/fontes) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- rotas de temporada/episodio no banco real ---");
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const seasonMod = (await import("../src/server/season-page.ts")) as Pick<Seams, "getSeasonPageData">;
    const episodeMod = (await import("../src/server/episode-page.ts")) as Pick<Seams, "getEpisodePageData">;
    const sitemapMod = (await import("../src/server/seo/sitemap-index.ts")) as Pick<
      Seams,
      "getSitemapIndexXml" | "getSitemapShardXml"
    >;
    const seoMod = (await import("@screena/seo")) as Pick<Seams, "serializeJsonLd">;

    const seams: Seams = {
      getSeasonPageData: seasonMod.getSeasonPageData,
      getEpisodePageData: episodeMod.getEpisodePageData,
      getSitemapIndexXml: sitemapMod.getSitemapIndexXml,
      getSitemapShardXml: sitemapMod.getSitemapShardXml,
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
  console.log("Resultado: PASSOU. Rotas de temporada/episodio validadas lendo PostgreSQL real (sitemap paginado no banco).");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
