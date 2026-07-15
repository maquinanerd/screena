/**
 * validate-entity-indexes-real-postgres.ts - Validacao descartavel das listagens
 * publicas (portas de entrada) contra PostgreSQL real efemero.
 *
 * Prova o fluxo:
 *   slugs canonicos pt-BR -> movies/tv_shows/people -> translations ->
 *   presenter (ordenacao/cap/imagem local) -> indexabilidade (index/noindex).
 *
 * Nao sobe Next, nao chama rede, nao chama TMDB/Gemini e nao altera schema. A
 * imagem de file_path cru ("/raw.jpg") vira URL REMOTA do TMDB; path local permanece local.
 *
 * Cada getter de indice nao recebe argumentos, entao e chamado UMA vez, no estado
 * final semeado (evita qualquer memoizacao de `cache`): politica 2026-07
 * (indexacao total, invariante 5) — qualquer listagem com >= 1 item valido
 * indexa; a quantidade de itens/blocos vira sinal de qualidade
 * (`hasUniqueValue`), nao gate. O caso vazio (0 itens -> noindex, caso tecnico)
 * e coberto pelo teste puro `entity-index-presenter.test.ts`.
 *
 * Uso: pnpm --filter @screena/web validate:entity-indexes
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
  movie: { create: (args: unknown) => Promise<{ id: bigint }> };
  tvShow: { create: (args: unknown) => Promise<{ id: bigint }> };
  person: { create: (args: unknown) => Promise<{ id: bigint }> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
};

async function createSlug(
  prisma: PrismaLike,
  entityType: string,
  entityId: bigint,
  slug: string,
): Promise<void> {
  await prisma.slug.create({
    data: { entityType, entityId, languageCode: LANGUAGE, slug, isCanonical: true },
  });
}

async function createTranslation(
  prisma: PrismaLike,
  entityType: string,
  entityId: bigint,
  title: string,
): Promise<void> {
  await prisma.entityTranslation.create({
    data: { entityType, entityId, languageCode: LANGUAGE, title },
  });
}

async function seedMovie(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    titleOriginal: string;
    releaseDate: Date | null;
    posterPath?: string | null;
    canonicalSlug?: string;
    translationTitle?: string;
  },
): Promise<void> {
  const movie = await prisma.movie.create({
    data: {
      tmdbId: opts.tmdbId,
      titleOriginal: opts.titleOriginal,
      releaseDate: opts.releaseDate,
      posterPath: opts.posterPath ?? null,
    },
    select: { id: true },
  });
  if (opts.canonicalSlug !== undefined) await createSlug(prisma, "movie", movie.id, opts.canonicalSlug);
  if (opts.translationTitle !== undefined) await createTranslation(prisma, "movie", movie.id, opts.translationTitle);
}

async function seedSeries(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    nameOriginal: string;
    firstAirDate: Date | null;
    lastAirDate: Date | null;
    canonicalSlug: string;
    translationTitle?: string;
  },
): Promise<void> {
  const show = await prisma.tvShow.create({
    data: {
      tmdbId: opts.tmdbId,
      nameOriginal: opts.nameOriginal,
      firstAirDate: opts.firstAirDate,
      lastAirDate: opts.lastAirDate,
    },
    select: { id: true },
  });
  await createSlug(prisma, "tv", show.id, opts.canonicalSlug);
  if (opts.translationTitle !== undefined) await createTranslation(prisma, "tv", show.id, opts.translationTitle);
}

async function seedPerson(
  prisma: PrismaLike,
  opts: {
    tmdbId: number;
    name: string;
    knownForDepartment?: string | null;
    profilePath?: string | null;
    canonicalSlug: string;
  },
): Promise<void> {
  const person = await prisma.person.create({
    data: {
      tmdbId: opts.tmdbId,
      name: opts.name,
      knownForDepartment: opts.knownForDepartment ?? null,
      profilePath: opts.profilePath ?? null,
    },
    select: { id: true },
  });
  await createSlug(prisma, "person", person.id, opts.canonicalSlug);
}

interface EntityIndexData {
  view: {
    kind: string;
    cards: ReadonlyArray<{
      kind: string;
      title: string;
      href: string;
      meta: string | null;
      image: { src: string; width: number; height: number } | null;
    }>;
    totalCount: number;
    hasMore: boolean;
  };
  indexability: { decision: string };
  canonicalUrl: string;
}

async function runChecks(
  prisma: PrismaLike,
  getters: {
    getMovieIndexData: () => Promise<EntityIndexData>;
    getSeriesIndexData: () => Promise<EntityIndexData>;
    getPersonIndexData: () => Promise<EntityIndexData>;
  },
): Promise<void> {
  // --- Filmes: 2 validos (indexacao total -> index) + 1 sem slug canonico (excluido) ---
  await seedMovie(prisma, {
    tmdbId: 66000001,
    titleOriginal: "Movie A Original",
    releaseDate: new Date("2010-03-01"),
    posterPath: "/media/movies/a.webp",
    canonicalSlug: "filme-a",
    translationTitle: "Filme A PT",
  });
  await seedMovie(prisma, {
    tmdbId: 66000002,
    titleOriginal: "Movie B Original",
    releaseDate: new Date("2020-07-01"),
    posterPath: "/raw-b.jpg",
    canonicalSlug: "filme-b",
  });
  await seedMovie(prisma, {
    tmdbId: 66000003,
    titleOriginal: "Movie Without Slug",
    releaseDate: new Date("2022-01-01"),
    translationTitle: "Sem Slug",
  });

  const movie = await getters.getMovieIndexData();
  record(3, "Filmes: canonicalUrl /pt/filmes/", movie.canonicalUrl === "https://thescreen.media/pt/filmes/", `canonicalUrl=${movie.canonicalUrl}`);
  record(4, "Filmes: item sem slug canonico e excluido (totalCount=2)", movie.view.totalCount === 2, `totalCount=${movie.view.totalCount}`);
  record(5, "Filmes: 2 itens (indexacao total, invariante 5) -> index", movie.indexability.decision === "index", `decision=${movie.indexability.decision}`);
  record(6, "Filmes: ordem por ano desc (B 2020 antes de A 2010)", movie.view.cards[0]?.title === "Movie B Original" && movie.view.cards[1]?.title === "Filme A PT", `ordem=[${movie.view.cards.map((c) => c.title).join(", ")}]`);
  record(7, "Filmes: href aponta /pt/filmes/[slug]/", movie.view.cards[0]?.href === "/pt/filmes/filme-b/", `href0=${movie.view.cards[0]?.href}`);
  record(8, "Filmes: imagem local segura aparece", movie.view.cards[1]?.image?.src === "/media/movies/a.webp", `imgA=${movie.view.cards[1]?.image?.src ?? "null"}`);
  record(9, "Filmes: path cru do TMDB vira imagem REMOTA (nunca local)", (movie.view.cards[0]?.image?.src?.startsWith("https://") ?? false), `imgB=${movie.view.cards[0]?.image?.src ?? "null"}`);

  // --- Series: 3 validas (suficiente -> index) ---
  await seedSeries(prisma, { tmdbId: 66100001, nameOriginal: "Alfa", firstAirDate: new Date("2021-01-01"), lastAirDate: null, canonicalSlug: "serie-alfa" });
  await seedSeries(prisma, { tmdbId: 66100002, nameOriginal: "Charlie", firstAirDate: new Date("2021-05-01"), lastAirDate: new Date("2023-05-01"), canonicalSlug: "serie-charlie" });
  await seedSeries(prisma, { tmdbId: 66100003, nameOriginal: "Bravo", firstAirDate: new Date("2015-01-01"), lastAirDate: new Date("2015-12-01"), canonicalSlug: "serie-bravo" });

  const series = await getters.getSeriesIndexData();
  record(10, "Series: canonicalUrl /pt/series/", series.canonicalUrl === "https://thescreen.media/pt/series/", `canonicalUrl=${series.canonicalUrl}`);
  record(11, "Series: totalCount=3", series.view.totalCount === 3, `totalCount=${series.view.totalCount}`);
  record(12, "Series: 3 itens (suficiente) -> index", series.indexability.decision === "index", `decision=${series.indexability.decision}`);
  record(13, "Series: ordem por firstAir desc + nome asc (Alfa, Charlie, Bravo)", JSON.stringify(series.view.cards.map((c) => c.title)) === JSON.stringify(["Alfa", "Charlie", "Bravo"]), `ordem=[${series.view.cards.map((c) => c.title).join(", ")}]`);
  record(14, "Series: meta e o periodo (2021 / 2021-2023)", series.view.cards[0]?.meta === "2021" && series.view.cards[1]?.meta === "2021-2023", `metas=[${series.view.cards.map((c) => c.meta).join(", ")}]`);

  // --- Pessoas: 3 validas (suficiente -> index) ---
  await seedPerson(prisma, { tmdbId: 66200001, name: "Zora", canonicalSlug: "pessoa-zora", profilePath: "/raw.jpg" });
  await seedPerson(prisma, { tmdbId: 66200002, name: "Ana", knownForDepartment: "Acting", profilePath: "/media/people/ana.webp", canonicalSlug: "pessoa-ana" });
  await seedPerson(prisma, { tmdbId: 66200003, name: "Bruno", canonicalSlug: "pessoa-bruno" });

  const people = await getters.getPersonIndexData();
  record(15, "Pessoas: canonicalUrl /pt/pessoas/", people.canonicalUrl === "https://thescreen.media/pt/pessoas/", `canonicalUrl=${people.canonicalUrl}`);
  record(16, "Pessoas: totalCount=3", people.view.totalCount === 3, `totalCount=${people.view.totalCount}`);
  record(17, "Pessoas: 3 itens (suficiente) -> index", people.indexability.decision === "index", `decision=${people.indexability.decision}`);
  record(18, "Pessoas: ordem por nome asc (Ana, Bruno, Zora)", JSON.stringify(people.view.cards.map((c) => c.title)) === JSON.stringify(["Ana", "Bruno", "Zora"]), `ordem=[${people.view.cards.map((c) => c.title).join(", ")}]`);
  record(19, "Pessoas: meta e a funcao traduzida (Ana -> Atuacao)", people.view.cards[0]?.meta === "Atuacao", `metaAna=${people.view.cards[0]?.meta ?? "null"}`);
  record(20, "Pessoas: perfil local (Ana) e perfil REMOTO do file_path cru (Zora)", people.view.cards[0]?.href === "/pt/pessoas/pessoa-ana/" && people.view.cards[0]?.image?.src === "/media/people/ana.webp" && (people.view.cards[2]?.image?.src?.startsWith("https://") ?? false), `hrefAna=${people.view.cards[0]?.href}`);
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-web-indexes-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_web_indexes_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_web_indexes_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_web_indexes_validation");

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

    console.log("\n--- fluxo das listagens no banco real (getXIndexData) ---");
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const indexes = (await import("../src/server/entity-indexes.ts")) as {
      getMovieIndexData: () => Promise<EntityIndexData>;
      getSeriesIndexData: () => Promise<EntityIndexData>;
      getPersonIndexData: () => Promise<EntityIndexData>;
    };

    const prisma = dbServer.getPrismaClient();
    await runChecks(prisma, indexes);
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
  console.log("Resultado: PASSOU. Listagens validadas lendo PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
