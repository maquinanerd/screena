/**
 * validate-series-page-real-postgres.ts - Validacao descartavel da pagina
 * publica de serie contra PostgreSQL real efemero.
 *
 * Prova o fluxo:
 *   slug pt-BR -> tv_show -> entity_translation -> content_blocks ->
 *   seasons/episodes -> presenter -> gate anti-thin.
 *
 * Nao sobe Next, nao chama rede, nao chama TMDB/Gemini e nao altera schema.
 *
 * Uso: pnpm --filter @screena/web validate:series-page
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
  tvShow: { create: (args: unknown) => Promise<{ id: bigint }> };
  season: { create: (args: unknown) => Promise<{ id: bigint }> };
  episode: { create: (args: unknown) => Promise<unknown> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  contentBlock: { create: (args: unknown) => Promise<unknown> };
};

interface SeedEpisode {
  readonly episodeNumber: number;
  readonly name?: string | null;
  readonly overview?: string | null;
  readonly airDate?: Date | null;
  readonly runtimeMinutes?: number | null;
  readonly stillPath?: string | null;
}

interface SeedSeason {
  readonly seasonNumber: number;
  readonly name?: string | null;
  readonly overview?: string | null;
  readonly airDate?: Date | null;
  readonly episodeCount?: number | null;
  readonly posterPath?: string | null;
  readonly episodes?: ReadonlyArray<SeedEpisode>;
}

async function seedSeries(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    nameOriginal: string;
    firstAirDate: Date | null;
    lastAirDate: Date | null;
    numberOfSeasons: number | null;
    numberOfEpisodes: number | null;
    posterPath?: string | null;
    backdropPath?: string | null;
    canonicalSlug: string;
    aliasSlug?: string;
    translation?: {
      title?: string | null;
      metaTitle?: string | null;
      metaDescription?: string | null;
      summary?: string | null;
    };
    blocks?: ReadonlyArray<{
      blockType: string;
      content: string;
      reviewStatus: string;
      sourceType?: string;
    }>;
    seasons?: ReadonlyArray<SeedSeason>;
  },
): Promise<string> {
  const series = await prisma.tvShow.create({
    data: {
      tmdbId: opts.tmdbId,
      nameOriginal: opts.nameOriginal,
      firstAirDate: opts.firstAirDate,
      lastAirDate: opts.lastAirDate,
      numberOfSeasons: opts.numberOfSeasons,
      numberOfEpisodes: opts.numberOfEpisodes,
      posterPath: opts.posterPath ?? null,
      backdropPath: opts.backdropPath ?? null,
    },
    select: { id: true },
  });
  const entityId = series.id;

  await prisma.slug.create({
    data: {
      entityType: "tv",
      entityId,
      languageCode: LANGUAGE,
      slug: opts.canonicalSlug,
      isCanonical: true,
    },
  });
  if (opts.aliasSlug !== undefined) {
    await prisma.slug.create({
      data: {
        entityType: "tv",
        entityId,
        languageCode: LANGUAGE,
        slug: opts.aliasSlug,
        isCanonical: false,
      },
    });
  }

  if (opts.translation !== undefined) {
    await prisma.entityTranslation.create({
      data: {
        entityType: "tv",
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
        entityType: "tv",
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

  for (const inputSeason of opts.seasons ?? []) {
    const season = await prisma.season.create({
      data: {
        tvShowId: entityId,
        seasonNumber: inputSeason.seasonNumber,
        name: inputSeason.name ?? null,
        overview: inputSeason.overview ?? null,
        airDate: inputSeason.airDate ?? null,
        episodeCount: inputSeason.episodeCount ?? null,
        posterPath: inputSeason.posterPath ?? null,
      },
      select: { id: true },
    });
    for (const episode of inputSeason.episodes ?? []) {
      await prisma.episode.create({
        data: {
          seasonId: season.id,
          tvShowId: entityId,
          episodeNumber: episode.episodeNumber,
          name: episode.name ?? null,
          overview: episode.overview ?? null,
          airDate: episode.airDate ?? null,
          runtimeMinutes: episode.runtimeMinutes ?? null,
          stillPath: episode.stillPath ?? null,
        },
      });
    }
  }

  return entityId.toString();
}

type SeriesPageData = {
  view: {
    title: string;
    firstAirYear: number | null;
    lastAirYear: number | null;
    periodLabel: string | null;
    seasonsCountLabel: string | null;
    episodesCountLabel: string | null;
    metaDescription: string | null;
    blocks: ReadonlyArray<{ blockType: string; content: string }>;
    renderableBlockCount: number;
    media: {
      poster: { src: string; width: number; height: number } | null;
      backdrop: { src: string; width: number; height: number } | null;
      hasRealImage: boolean;
    };
    seasons: ReadonlyArray<{
      seasonNumber: number;
      title: string;
      episodeCountLabel: string | null;
      episodes: ReadonlyArray<{
        episodeNumber: number;
        title: string | null;
        runtimeLabel: string | null;
        still: { src: string; width: number; height: number } | null;
      }>;
    }>;
  };
  indexability: { decision: string };
  canonicalSlug: string;
  canonicalUrl: string;
};
type GetSeriesPageData = (slug: string) => Promise<SeriesPageData | null>;

async function runChecks(
  prisma: PrismaLike,
  getSeriesPageData: GetSeriesPageData,
): Promise<void> {
  const missing = await getSeriesPageData("serie-que-nao-existe-1234");
  record(3, "A. slug inexistente retorna null", missing === null, `retorno=${missing === null ? "null" : "objeto"}`);

  await seedSeries(prisma, {
    tmdbId: 95000001,
    nameOriginal: "Thin Series Zero",
    firstAirDate: new Date("2020-01-01"),
    lastAirDate: null,
    numberOfSeasons: null,
    numberOfEpisodes: null,
    posterPath: "/thin-poster.jpg",
    backdropPath: "/thin-backdrop.jpg",
    canonicalSlug: "serie-thin-zero",
    translation: { title: "Serie Fininha Zero" },
    blocks: [
      { blockType: "editorial_intro", content: "rascunho IA", reviewStatus: "ai_generated", sourceType: "ai" },
      { blockType: "season_guide", content: "aguardando revisao", reviewStatus: "needs_review", sourceType: "ai" },
    ],
  });
  const thinZero = await getSeriesPageData("serie-thin-zero");
  record(4, "B. serie com 0 blocos publicos retorna dados", thinZero !== null, `retorno=${thinZero ? "objeto" : "null"}`);
  record(5, "B. renderableBlockCount === 0", thinZero?.view.renderableBlockCount === 0, `count=${thinZero?.view.renderableBlockCount}`);
  record(6, "B. indexability.decision === noindex", thinZero?.indexability.decision === "noindex", `decision=${thinZero?.indexability.decision}`);
  record(7, "B. metaDescription nao inventada", thinZero?.view.metaDescription === null, `metaDescription=${thinZero?.view.metaDescription === null ? "null" : JSON.stringify(thinZero?.view.metaDescription)}`);
  record(8, "B. nenhum bloco nao-publico aparece", (thinZero?.view.blocks.length ?? -1) === 0, `blocos=${thinZero?.view.blocks.length}`);
  record(9, "B. path raiz cru nao vira imagem local segura", thinZero?.view.media.hasRealImage === false, `hasRealImage=${thinZero?.view.media.hasRealImage}`);
  record(10, "B. sem seasons reais, view.seasons fica vazia", (thinZero?.view.seasons.length ?? -1) === 0, `seasons=${thinZero?.view.seasons.length}`);

  await seedSeries(prisma, {
    tmdbId: 95000002,
    nameOriginal: "One Block Series",
    firstAirDate: new Date("2021-01-01"),
    lastAirDate: null,
    numberOfSeasons: 1,
    numberOfEpisodes: 8,
    canonicalSlug: "serie-um-bloco",
    translation: { title: "Serie de Um Bloco" },
    blocks: [
      { blockType: "editorial_intro", content: "introducao publicada", reviewStatus: "published" },
    ],
  });
  const oneBlock = await getSeriesPageData("serie-um-bloco");
  record(11, "C. renderableBlockCount === 1", oneBlock?.view.renderableBlockCount === 1, `count=${oneBlock?.view.renderableBlockCount}`);
  record(12, "C. indexability.decision === noindex", oneBlock?.indexability.decision === "noindex", `decision=${oneBlock?.indexability.decision}`);

  await seedSeries(prisma, {
    tmdbId: 95000003,
    nameOriginal: "The Rich Show",
    firstAirDate: new Date("2011-04-17"),
    lastAirDate: new Date("2019-05-19"),
    numberOfSeasons: 8,
    numberOfEpisodes: 73,
    posterPath: "/media/series/rich-poster.webp",
    backdropPath: "/uploads/series/rich-backdrop.jpg",
    canonicalSlug: "serie-rica",
    aliasSlug: "serie-rica-antiga",
    translation: {
      title: "Serie Rica",
      metaTitle: "Serie Rica (2011-2019) - Serie",
      metaDescription: "Descricao editorial pt-BR existente no banco.",
    },
    blocks: [
      { blockType: "season_guide", content: "Guia de temporadas revisado.", reviewStatus: "human_reviewed" },
      { blockType: "editorial_intro", content: "Introducao editorial revisada.", reviewStatus: "published" },
      { blockType: "faq", content: "rascunho nao-publico", reviewStatus: "needs_review", sourceType: "ai" },
    ],
    seasons: [
      {
        seasonNumber: 1,
        name: "Temporada 1",
        overview: "Resumo real da temporada.",
        airDate: new Date("2011-04-17"),
        episodeCount: 2,
        posterPath: "/media/series/season-1.webp",
        episodes: [
          {
            episodeNumber: 2,
            name: "Segundo",
            airDate: new Date("2011-04-24"),
            runtimeMinutes: 56,
            stillPath: "/still-root.jpg",
          },
          {
            episodeNumber: 1,
            name: "Piloto",
            overview: "Resumo real do episodio.",
            airDate: new Date("2011-04-17"),
            runtimeMinutes: 58,
            stillPath: "/uploads/series/episode-1.webp",
          },
        ],
      },
    ],
  });
  const richByAlias = await getSeriesPageData("serie-rica-antiga");
  record(13, "D. serie com 2 blocos publicos retorna dados", richByAlias !== null, `retorno=${richByAlias ? "objeto" : "null"}`);
  record(14, "D. renderableBlockCount === 2", richByAlias?.view.renderableBlockCount === 2, `count=${richByAlias?.view.renderableBlockCount}`);
  record(15, "D. indexability.decision === index", richByAlias?.indexability.decision === "index", `decision=${richByAlias?.indexability.decision}`);
  record(16, "D. canonicalSlug vem do slug canonico", richByAlias?.canonicalSlug === "serie-rica", `canonicalSlug=${richByAlias?.canonicalSlug}`);
  record(17, "D. canonicalUrl usa /pt/series/", richByAlias?.canonicalUrl === "https://screena.media/pt/series/serie-rica/", `canonicalUrl=${richByAlias?.canonicalUrl}`);
  record(18, "D. titulo vem da traducao pt-BR", richByAlias?.view.title === "Serie Rica", `title=${richByAlias?.view.title}`);
  record(19, "D. periodo vem de first/last_air_date", richByAlias?.view.periodLabel === "2011-2019", `period=${richByAlias?.view.periodLabel}`);
  record(20, "D. contagens reais aparecem", richByAlias?.view.seasonsCountLabel === "8 temporadas" && richByAlias?.view.episodesCountLabel === "73 episodios", `labels=${richByAlias?.view.seasonsCountLabel} / ${richByAlias?.view.episodesCountLabel}`);
  record(21, "D. imagens locais seguras aparecem", richByAlias?.view.media.poster?.src === "/media/series/rich-poster.webp" && richByAlias?.view.media.backdrop?.src === "/uploads/series/rich-backdrop.jpg", `poster=${richByAlias?.view.media.poster?.src ?? "null"}`);

  const visibleTypes = (richByAlias?.view.blocks ?? []).map((block) => block.blockType).sort();
  record(22, "D. apenas blocos publicos aparecem", JSON.stringify(visibleTypes) === JSON.stringify(["editorial_intro", "season_guide"]), `visiveis=[${visibleTypes.join(", ")}]`);
  record(23, "D. temporada real aparece", richByAlias?.view.seasons[0]?.title === "Temporada 1", `season=${richByAlias?.view.seasons[0]?.title}`);
  record(24, "D. episodios reais aparecem ordenados", JSON.stringify(richByAlias?.view.seasons[0]?.episodes.map((episode) => episode.episodeNumber)) === JSON.stringify([1, 2]), `episodes=[${richByAlias?.view.seasons[0]?.episodes.map((episode) => episode.episodeNumber).join(", ")}]`);
  record(25, "D. still local seguro aparece e path cru vira null", richByAlias?.view.seasons[0]?.episodes[0]?.still?.src === "/uploads/series/episode-1.webp" && richByAlias?.view.seasons[0]?.episodes[1]?.still === null, `still1=${richByAlias?.view.seasons[0]?.episodes[0]?.still?.src ?? "null"}`);
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-web-series-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_web_series_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_web_series_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_web_series_validation");

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

    console.log("\n--- fluxo da pagina de serie no banco real (getSeriesPageData) ---");
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const seriesPage = (await import("../src/server/series-page.ts")) as {
      getSeriesPageData: GetSeriesPageData;
    };

    const prisma = dbServer.getPrismaClient();
    await runChecks(prisma, seriesPage.getSeriesPageData);
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
  console.log("Resultado: PASSOU. Pagina de serie validada lendo PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
