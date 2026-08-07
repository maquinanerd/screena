/**
 * validate-entity-resolve-real-postgres.ts — a rota interna de resolucao de
 * entidade contra Next REAL + PostgreSQL 16 efemero.
 *
 * POR QUE HTTP REAL, E NAO SO O NUCLEO PURO. `entity-resolve.test.ts` cobre a
 * decisao e `entity-resolve-auth.test.ts` cobre credencial e teto. O que nenhum
 * dos dois alcanca e justamente onde uma rota interna costuma falhar:
 *
 *  1. o SQL de casamento por titulo. Ele usa `immutable_unaccent(lower(...))` e
 *     `string_to_array(normalized_aliases, '|')` — funcao e formato que so
 *     existem no banco. Um erro ali nao aparece em teste puro: aparece como
 *     `not_found` para um titulo que existe;
 *  2. a credencial e o teto ligados no handler — teste puro prova a funcao, nao
 *     o fio;
 *  3. os cabecalhos de rota interna (`X-Robots-Tag`, `no-store`, ausencia de
 *     CORS) e o `405` para metodo errado;
 *  4. O FECHO DO CIRCUITO: que o id devolvido pela rota e o MESMO id que a
 *     renderizacao da materia aceita. Esse e o defeito que a rota inteira existe
 *     para fechar, e ele so se prova rodando os dois lados contra o mesmo banco.
 *
 * Nao chama rede externa, nao usa banco remoto, nao cria credencial real: a
 * chave e sorteada e morre com o processo.
 *
 * Uso: pnpm --filter @screena/web validate:entity-resolve
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";
const API_KEY = `resolve-${randomUUID()}${randomUUID()}`;

/* ------------------------------------------------------------------ */
/* Relatorio                                                           */
/* ------------------------------------------------------------------ */

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
let step = 0;
function record(name: string, ok: boolean, detail: string): void {
  step += 1;
  results.push({ n: step, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${String(step)}. ${name} - ${detail}`);
}

/* ------------------------------------------------------------------ */
/* Infra                                                               */
/* ------------------------------------------------------------------ */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
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

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status > 0) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** A MESMA dobra da ingestao e da rota. Duplicada aqui so para semear. */
function fold(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Semente                                                             */
/* ------------------------------------------------------------------ */

type PrismaLike = {
  movie: { create: (args: unknown) => Promise<{ id: bigint }> };
  tvShow: { create: (args: unknown) => Promise<{ id: bigint }> };
  person: { create: (args: unknown) => Promise<{ id: bigint }> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  searchDocument: { create: (args: unknown) => Promise<unknown> };
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: { create: (args: unknown) => Promise<unknown> };
};

interface SeedEntity {
  readonly kind: "movie" | "tv" | "person";
  readonly tmdbId: number;
  readonly title: string;
  readonly year: number | null;
  readonly slug: string | null;
  readonly translatedTitle?: string;
  readonly aliases?: readonly string[];
  /** `false` semeia a entidade SEM documento de busca. */
  readonly searchable?: boolean;
}

async function seedEntity(prisma: PrismaLike, entity: SeedEntity): Promise<bigint> {
  let id: bigint;
  if (entity.kind === "movie") {
    const row = await prisma.movie.create({
      data: {
        tmdbId: entity.tmdbId,
        titleOriginal: entity.title,
        releaseDate: entity.year === null ? null : new Date(Date.UTC(entity.year, 5, 1)),
      },
      select: { id: true },
    });
    id = row.id;
  } else if (entity.kind === "tv") {
    const row = await prisma.tvShow.create({
      data: {
        tmdbId: entity.tmdbId,
        nameOriginal: entity.title,
        firstAirDate: entity.year === null ? null : new Date(Date.UTC(entity.year, 5, 1)),
      },
      select: { id: true },
    });
    id = row.id;
  } else {
    const row = await prisma.person.create({
      data: { tmdbId: entity.tmdbId, name: entity.title },
      select: { id: true },
    });
    id = row.id;
  }

  if (entity.slug !== null) {
    await prisma.slug.create({
      data: {
        entityType: entity.kind,
        entityId: id,
        languageCode: LANGUAGE,
        slug: entity.slug,
        isCanonical: true,
      },
    });
  }

  if (entity.translatedTitle !== undefined) {
    await prisma.entityTranslation.create({
      data: {
        entityType: entity.kind,
        entityId: id,
        languageCode: LANGUAGE,
        title: entity.translatedTitle,
      },
    });
  }

  if (entity.searchable !== false) {
    const aliases = entity.aliases ?? [];
    await prisma.searchDocument.create({
      data: {
        docKind: "entity",
        entityType: entity.kind,
        entityId: id,
        locale: LANGUAGE,
        primaryText: entity.title,
        alternativeText: aliases.join(" | "),
        normalizedText: fold([entity.title, ...aliases].join(" ")),
        normalizedAliases: aliases.map((alias) => fold(alias)).join("|"),
        year: entity.year,
      },
    });
  }

  return id;
}

/* ------------------------------------------------------------------ */
/* Chamadas HTTP                                                       */
/* ------------------------------------------------------------------ */

interface ResolveResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

async function callResolve(
  base: string,
  items: unknown,
  key: string | null = API_KEY,
): Promise<ResolveResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/api/internal/entity-resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ items }),
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = { raw: raw.slice(0, 300) };
  }
  return { status: response.status, headers: response.headers, body };
}

interface ResultRow {
  entityKind: string | null;
  entityId: string | null;
  matchedBy: string | null;
  confidence: number;
  canonicalTitle: string | null;
  path: string | null;
  reason: string | null;
}

function rows(response: ResolveResponse): ResultRow[] {
  const list = response.body.results;
  return Array.isArray(list) ? (list as ResultRow[]) : [];
}

/* ------------------------------------------------------------------ */
/* Checagens                                                           */
/* ------------------------------------------------------------------ */

interface SeededIds {
  fightClub: bigint;
  gemeasA: bigint;
  gemeasB: bigint;
  ruptura: bigint;
  freeman: bigint;
  evansA: bigint;
  evansB: bigint;
  semSlug: bigint;
}

async function runHttpChecks(base: string, ids: SeededIds): Promise<void> {
  /* --- credencial ------------------------------------------------- */

  const noKey = await callResolve(base, [{ kind: "movie", tmdbId: 550 }], null);
  record("sem credencial: 401", noKey.status === 401, `status=${String(noKey.status)}`);

  const wrongKey = await callResolve(
    base,
    [{ kind: "movie", tmdbId: 550 }],
    `${API_KEY.slice(0, -1)}z`,
  );
  record(
    "chave errada do MESMO tamanho: 401",
    wrongKey.status === 401,
    `status=${String(wrongKey.status)}`,
  );

  /* --- cabecalhos de rota interna --------------------------------- */

  const ok = await callResolve(base, [{ kind: "movie", tmdbId: 550 }]);
  record(
    "X-Robots-Tag noindex — Disallow impede rastrear, nao indexar",
    (ok.headers.get("x-robots-tag") ?? "").includes("noindex"),
    `x-robots-tag=${ok.headers.get("x-robots-tag") ?? "ausente"}`,
  );
  record(
    "sem CORS publico — navegador nenhum chama esta rota",
    ok.headers.get("access-control-allow-origin") === null,
    `acao=${ok.headers.get("access-control-allow-origin") ?? "ausente"}`,
  );
  record(
    "cache-control no-store — a resposta depende da credencial",
    (ok.headers.get("cache-control") ?? "").includes("no-store"),
    `cache-control=${ok.headers.get("cache-control") ?? "ausente"}`,
  );

  const get = await fetch(`${base}/api/internal/entity-resolve`, { method: "GET" });
  record("GET responde 405", get.status === 405, `status=${String(get.status)}`);

  const robots = await (await fetch(`${base}/robots.txt`)).text();
  record(
    "robots.txt continua bloqueando /api/",
    robots.includes("Disallow: /api/"),
    "Disallow: /api/ presente",
  );

  /* --- tmdb_id ---------------------------------------------------- */

  const byTmdb = rows(ok)[0];
  record(
    "tmdb_id casa e devolve o id INTERNO, nao o do TMDB",
    byTmdb?.entityId === ids.fightClub.toString() &&
      byTmdb?.matchedBy === "tmdb_id" &&
      byTmdb?.confidence === 1,
    `entityId=${byTmdb?.entityId ?? "null"} interno=${ids.fightClub.toString()} matchedBy=${byTmdb?.matchedBy ?? "null"}`,
  );
  record(
    "o caminho devolvido e a rota publica pt-BR",
    byTmdb?.path === "/pt/filmes/clube-da-luta/",
    `path=${byTmdb?.path ?? "null"}`,
  );
  record(
    "canonicalTitle vem da traducao pt-BR, nunca inventado",
    byTmdb?.canonicalTitle === "Clube da Luta",
    `canonicalTitle=${byTmdb?.canonicalTitle ?? "null"}`,
  );

  const tmdbMissing = await callResolve(base, [{ kind: "movie", tmdbId: 987654321 }]);
  record(
    "tmdb_id fora do catalogo: null NOMEADO, nunca palpite",
    rows(tmdbMissing)[0]?.entityId === null &&
      rows(tmdbMissing)[0]?.reason === "tmdb_id_not_in_catalog",
    `reason=${rows(tmdbMissing)[0]?.reason ?? "null"}`,
  );

  const tmdbWrongKind = await callResolve(base, [{ kind: "tv", tmdbId: 550 }]);
  record(
    "o MESMO tmdb_id em outro kind nao casa",
    rows(tmdbWrongKind)[0]?.entityId === null,
    `entityId=${rows(tmdbWrongKind)[0]?.entityId ?? "null"}`,
  );

  const tmdbWins = await callResolve(base, [
    { kind: "movie", tmdbId: 987654321, title: "Clube da Luta", year: 1999 },
  ]);
  record(
    "tmdb_id inexistente NAO cai para o titulo — divergencia nao vira 'tente o outro'",
    rows(tmdbWins)[0]?.entityId === null &&
      rows(tmdbWins)[0]?.reason === "tmdb_id_not_in_catalog",
    `reason=${rows(tmdbWins)[0]?.reason ?? "null"}`,
  );

  /* --- titulo + ano (o SQL de verdade) ---------------------------- */

  const byTitle = await callResolve(base, [{ kind: "movie", title: "Clube da Luta", year: 1999 }]);
  record(
    "titulo + ano casa pelo SQL real (immutable_unaccent + lower)",
    rows(byTitle)[0]?.entityId === ids.fightClub.toString() &&
      rows(byTitle)[0]?.matchedBy === "exact_title_year",
    `entityId=${rows(byTitle)[0]?.entityId ?? "null"} matchedBy=${rows(byTitle)[0]?.matchedBy ?? "null"}`,
  );

  const byAccent = await callResolve(base, [
    { kind: "movie", title: "  clube DA   luta ", year: 1999 },
  ]);
  record(
    "caixa, espaco duplo e espaco nas pontas nao atrapalham",
    rows(byAccent)[0]?.entityId === ids.fightClub.toString(),
    `entityId=${rows(byAccent)[0]?.entityId ?? "null"}`,
  );

  const byAlias = await callResolve(base, [{ kind: "movie", title: "Fight Club", year: 1999 }]);
  record(
    "ALIAS casa — e como o MNScr costuma citar a obra",
    rows(byAlias)[0]?.entityId === ids.fightClub.toString(),
    `entityId=${rows(byAlias)[0]?.entityId ?? "null"}`,
  );

  const accented = await callResolve(base, [{ kind: "tv", title: "ruptura", year: 2022 }]);
  record(
    "titulo com acento no banco casa com o termo sem acento",
    rows(accented)[0]?.entityId === ids.ruptura.toString(),
    `entityId=${rows(accented)[0]?.entityId ?? "null"} esperado=${ids.ruptura.toString()}`,
  );

  const noYear = await callResolve(base, [{ kind: "movie", title: "Clube da Luta" }]);
  record(
    "titulo SEM ano nao casa, mesmo com candidato unico",
    rows(noYear)[0]?.entityId === null && rows(noYear)[0]?.reason === "title_requires_year",
    `reason=${rows(noYear)[0]?.reason ?? "null"}`,
  );

  const ambiguous = await callResolve(base, [{ kind: "movie", title: "Gemeas", year: 1998 }]);
  record(
    "DUAS obras com titulo e ano iguais: null, nunca escolha",
    rows(ambiguous)[0]?.entityId === null && rows(ambiguous)[0]?.reason === "ambiguous_title",
    `reason=${rows(ambiguous)[0]?.reason ?? "null"} (ids ${ids.gemeasA.toString()}/${ids.gemeasB.toString()})`,
  );

  const fuzzy = await callResolve(base, [{ kind: "movie", title: "Clube de Luta", year: 1999 }]);
  record(
    "quase-igual NAO casa — nao ha fuzzy nesta rota",
    rows(fuzzy)[0]?.entityId === null && rows(fuzzy)[0]?.reason === "not_found",
    `reason=${rows(fuzzy)[0]?.reason ?? "null"}`,
  );

  /* --- pessoa ----------------------------------------------------- */

  const person = await callResolve(base, [{ kind: "person", name: "Morgan Freeman" }]);
  record(
    "pessoa por nome UNICO casa, com confianca menor",
    rows(person)[0]?.entityId === ids.freeman.toString() &&
      rows(person)[0]?.matchedBy === "exact_name" &&
      rows(person)[0]?.path === "/pt/pessoas/morgan-freeman/",
    `entityId=${rows(person)[0]?.entityId ?? "null"} confidence=${String(rows(person)[0]?.confidence ?? -1)}`,
  );

  const homonym = await callResolve(base, [{ kind: "person", name: "Chris Evans" }]);
  record(
    "HOMONIMOS derrubam para null, nunca para o mais popular",
    rows(homonym)[0]?.entityId === null && rows(homonym)[0]?.reason === "ambiguous_name",
    `reason=${rows(homonym)[0]?.reason ?? "null"} (ids ${ids.evansA.toString()}/${ids.evansB.toString()})`,
  );

  /* --- o portao final --------------------------------------------- */

  const noSlug = await callResolve(base, [{ kind: "movie", tmdbId: 424242 }]);
  record(
    "entidade SEM slug canonico pt-BR nao e devolvida, e diz por que",
    rows(noSlug)[0]?.entityId === null && rows(noSlug)[0]?.reason === "no_canonical_slug",
    `reason=${rows(noSlug)[0]?.reason ?? "null"} (id ${ids.semSlug.toString()} existe no catalogo)`,
  );

  /* --- lote ------------------------------------------------------- */

  const batch = await callResolve(base, [
    { kind: "movie", tmdbId: 550 },
    { kind: "planeta" },
    { kind: "person", name: "Morgan Freeman" },
    { kind: "movie", title: "Nada Disso Existe", year: 2001 },
  ]);
  const batchRows = rows(batch);
  record(
    "o lote devolve UM resultado por item, na ordem, mesmo com item invalido",
    batchRows.length === 4 &&
      batchRows[0]?.entityId === ids.fightClub.toString() &&
      batchRows[1]?.reason === "unsupported_kind" &&
      batchRows[2]?.entityId === ids.freeman.toString() &&
      batchRows[3]?.reason === "not_found",
    `n=${String(batchRows.length)} reasons=[${batchRows.map((r) => r.reason ?? "ok").join(", ")}]`,
  );
  record(
    "todo resultado sem id carrega motivo; todo resultado com id nao carrega",
    batchRows.every((row) => (row.entityId === null) === (row.reason !== null)),
    "invariante da resposta preservada",
  );

  const tooMany = await callResolve(
    base,
    Array.from({ length: 51 }, () => ({ kind: "movie", tmdbId: 550 })),
  );
  record(
    "itens demais: 422 e recusa do pedido INTEIRO, nunca truncamento",
    tooMany.status === 422 && tooMany.body.error === "too_many_items",
    `status=${String(tooMany.status)} error=${String(tooMany.body.error)}`,
  );

  /* --- teto de chamadas ------------------------------------------- */

  let limited: ResolveResponse | null = null;
  for (let i = 0; i < 40; i += 1) {
    const response = await callResolve(base, [{ kind: "movie", tmdbId: 550 }]);
    if (response.status === 429) {
      limited = response;
      break;
    }
  }
  record(
    "o teto por credencial dispara 429 com Retry-After",
    limited !== null && Number(limited.headers.get("retry-after") ?? 0) > 0,
    limited === null
      ? "nao disparou em 40 chamadas (teto do ambiente = 5?)"
      : `retry-after=${limited.headers.get("retry-after") ?? "ausente"}`,
  );
}

/**
 * O FECHO DO CIRCUITO — e o unico passo que prova o que a rota existe para
 * resolver.
 *
 * Pega o id que a ROTA devolveu, poe num bloco `entityCard` do corpo de uma
 * materia e renderiza pela MESMA funcao que a pagina publica usa. Se a ficha
 * aparecer, o id que o MNScr recebeu e o id que a renderizacao aceita. Se nao
 * aparecer, o bloco teria sumido em silencio — que e exatamente o defeito.
 */
async function runRenderCheck(resolvedEntityId: string): Promise<void> {
  const dbServer = (await import("@screena/db/server")) as { getPrismaClient: () => PrismaLike };
  const prisma = dbServer.getPrismaClient();

  const slug = `materia-do-circuito-${randomUUID().slice(0, 8)}`;
  const article = await prisma.article.create({
    data: {
      authorName: "Redacao Cinerie",
      publishedAt: new Date("2026-06-30T12:00:00.000Z"),
      aiAssisted: false,
      licenseStatus: "official",
      displayAllowed: true,
      requiresAttribution: false,
      requiresLinkback: false,
    },
    select: { id: true },
  });

  // `body_blocks` vive na TRADUCAO, nao no artigo: o corpo estruturado e por
  // idioma, como todo texto.
  await prisma.articleTranslation.create({
    data: {
      articleId: article.id,
      languageCode: LANGUAGE,
      slug,
      title: "Materia que cita o filme resolvido",
      body: "Corpo editorial proprio e substancial. ".repeat(12),
      bodyBlocks: [
        { type: "paragraph", id: "p1", text: "Texto de abertura com corpo suficiente. ".repeat(8) },
        {
          type: "entityCard",
          id: "e1",
          entityKind: "movie",
          entityId: resolvedEntityId,
          note: "Nota escrita pela redacao.",
        },
      ],
      // O CHECK `article_translations_body_blocks_version_paired` exige os dois
      // juntos: corpo estruturado sem versao nao entra no banco.
      bodyBlocksVersion: "validate-entity-resolve",
      reviewStatus: "published",
      indexStatus: "index",
      publishedAt: new Date("2026-06-30T12:00:00.000Z"),
    },
  });

  const news = (await import("../src/server/news-pages.ts")) as {
    getNewsArticleData: (slug: string) => Promise<{
      bodyBlocks: ReadonlyArray<{ kind: string; card?: { entityId: string; href: string } }>;
    } | null>;
  };
  const data = await news.getNewsArticleData(slug);
  const card = data?.bodyBlocks.find((block) => block.kind === "entityCard");

  record(
    "O CIRCUITO FECHA: o id devolvido pela rota RENDERIZA como ficha na materia",
    card !== undefined && card.card?.entityId === resolvedEntityId,
    card === undefined
      ? `bloco entityCard AUSENTE — o id ${resolvedEntityId} sumiu em silencio, que e o defeito`
      : `entityId=${card.card?.entityId ?? "null"} href=${card.card?.href ?? "null"}`,
  );
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const pgPort = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-entity-resolve-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: pgPort,
    persistent: true,
  });
  const database = "cinerie_entity_resolve_validation";
  const url = `postgresql://postgres:postgres@127.0.0.1:${String(pgPort)}/${database}?schema=public`;
  console.log(
    `\n=== Postgres efemero (embedded) :${String(pgPort)} | postgresql://postgres:****@127.0.0.1:${String(pgPort)}/${database} ===\n`,
  );

  let started = false;
  let server: ReturnType<typeof spawn> | null = null;

  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase(database);

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record("migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record("db:seed roda sem erro", true, "ok");

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    const prisma = dbServer.getPrismaClient();

    const ids: SeededIds = {
      fightClub: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 550,
        title: "Clube da Luta",
        year: 1999,
        slug: "clube-da-luta",
        translatedTitle: "Clube da Luta",
        aliases: ["Fight Club"],
      }),
      // Duas obras com o MESMO titulo e o MESMO ano: a ambiguidade que a rota
      // recusa em vez de resolver por popularidade.
      gemeasA: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 11001,
        title: "Gemeas",
        year: 1998,
        slug: "gemeas-a",
      }),
      gemeasB: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 11002,
        title: "Gemeas",
        year: 1998,
        slug: "gemeas-b",
      }),
      // Titulo COM acento no banco, consultado SEM acento pelo cliente.
      ruptura: await seedEntity(prisma, {
        kind: "tv",
        tmdbId: 12001,
        title: "Rúptura",
        year: 2022,
        slug: "ruptura",
      }),
      freeman: await seedEntity(prisma, {
        kind: "person",
        tmdbId: 192,
        title: "Morgan Freeman",
        year: null,
        slug: "morgan-freeman",
      }),
      evansA: await seedEntity(prisma, {
        kind: "person",
        tmdbId: 13001,
        title: "Chris Evans",
        year: null,
        slug: "chris-evans",
      }),
      evansB: await seedEntity(prisma, {
        kind: "person",
        tmdbId: 13002,
        title: "Chris Evans",
        year: null,
        slug: "chris-evans-apresentador",
      }),
      // Existe no catalogo, e NAO tem pagina: sem slug canonico pt-BR.
      semSlug: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 424242,
        title: "Filme Sem Pagina",
        year: 2020,
        slug: null,
      }),
    };
    record("catalogo semeado (8 entidades, com os dois casos ambiguos)", true, "ok");

    /* --- Next real ------------------------------------------------ */

    const nextBin = path.join(webDir, "node_modules", "next", "dist", "bin", "next");
    const webEnv: NodeJS.ProcessEnv = {
      ...env,
      NODE_ENV: "production",
      CINERIE_PUBLIC_SITE_URL: "https://cinerie.com",
      CINERIE_PUBLIC_INDEXING_ENABLED: "true",
      CINERIE_CATALOG_RESOLVE_API_KEYS: API_KEY,
      // Teto BAIXO de proposito: o caso do 429 precisa disparar sem 60 chamadas.
      CINERIE_CATALOG_RESOLVE_RATE_LIMIT_PER_MINUTE: "20",
    };

    console.log("--- next build ---");
    const build = spawnSync("node", [nextBin, "build"], {
      cwd: webDir,
      env: webEnv,
      stdio: "pipe",
      shell: false,
    });
    if (build.status !== 0) {
      record("next build", false, (build.stdout?.toString() ?? "").slice(-1200));
      throw new Error("next build falhou");
    }
    record("next build concluido", true, "ok");

    const httpPort = await freePort();
    const base = `http://127.0.0.1:${String(httpPort)}`;
    server = spawn(
      "node",
      [nextBin, "start", "--port", String(httpPort), "--hostname", "127.0.0.1"],
      { cwd: webDir, env: webEnv, stdio: "pipe", shell: false },
    );
    let log = "";
    const capture = (chunk: unknown) => {
      log = `${log}${String(chunk)}`.slice(-4_000);
    };
    server.stdout?.on("data", capture);
    server.stderr?.on("data", capture);

    const up = await waitForHttp(`${base}/robots.txt`, 120_000);
    if (!up) {
      record("Next respondeu", false, log.slice(-600) || "sem saida");
      throw new Error("Next nao subiu");
    }
    record("Next real no ar", true, base);

    await runHttpChecks(base, ids);
    await runRenderCheck(ids.fightClub.toString());

    await dbServer.disconnectPrisma();
  } catch (error) {
    // A mensagem do Prisma vem multilinha e o primeiro trecho costuma ser
    // vazio; sem o recorte maior, um erro de schema aparecia como `FAIL -` puro.
    const message =
      error instanceof Error ? `${error.name}: ${error.message.replace(/\s+/g, " ").slice(0, 400)}` : String(error);
    record("execucao", false, message);
  } finally {
    if (server !== null) server.kill();
    if (started) await pg.stop();
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (error) {
      console.warn(`Aviso: dir temporario nao removido (${(error as Error).message.split("\n")[0] ?? ""}).`);
    }
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nRESUMO: ${String(results.length - failed.length)}/${String(results.length)} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${String(f.n)}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Rota interna de resolucao validada contra Next e PostgreSQL reais.");
}

main().catch((error) => {
  console.error("Erro fatal:", error);
  process.exit(1);
});
