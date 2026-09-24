/**
 * bench-sitemap-relevance-gate-real-postgres.ts — o SQL do sitemap ANTES e
 * DEPOIS do portao de relevancia, com EXPLAIN (ANALYZE, BUFFERS), no MESMO
 * PostgreSQL 16 real e efemero, com volume de producao.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao roda no render/build/producao.
 *
 * POR QUE EXISTE. A PR 323 reverteu um portao escrito em CTE que PIOROU
 * producao (o `/sitemap.xml` foi de 3,9 s para 31 s num portao anterior). O
 * portao de relevancia foi escrito com EXISTS correlacionado; este script prova
 * o custo antes de ir ao ar.
 *
 * COMO NAO MENTE.
 *   - O SQL medido e o que o sitemap EMITE de verdade: as funcoes reais de
 *     `sitemap-index.ts` rodam com um PrismaClient que registra cada consulta e
 *     seus parametros. Nada e copiado a mao.
 *   - O "ANTES" e esse mesmo SQL com SO o bloco do portao removido (regex sobre o
 *     texto emitido). O script exige que o ANTES devolva o MESMO numero de linhas
 *     que a funcao real com `CINERIE_RELEVANCE_GATE=off` — senao a remocao errou.
 *   - O "DEPOIS" tem de devolver MENOS linhas (o portao barra alguem de fato);
 *     um benchmark que so fica rapido porque o portao nao barrou ninguem nao
 *     prova nada.
 *
 * Volume (ESCALA=1): 70 mil filmes + 39 mil series (108.974 titulos em producao
 * em 24/09/2026), 82% com menos de 100 votos, 15% sem pais, oferta BR em ~12%,
 * 3 temporadas e 8 episodios por serie, decisao `index` persistida para filmes e
 * series. `BENCH_ESCALA=0.1` roda um decimo.
 *
 * Uso: pnpm --filter @screena/web bench:sitemap-relevance-gate
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import EmbeddedPostgres from "embedded-postgres";
import { runChild } from "@screena/db/async-child-process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const DB_DIR = path.join(REPO, "packages", "db");
const SCHEMA = path.join(DB_DIR, "prisma", "schema.prisma");
const requireFromDb = createRequire(path.join(DB_DIR, "package.json"));
const LANGUAGE = "pt-BR";
const ENV_VAR = "CINERIE_RELEVANCE_GATE";

const ESCALA = Number(process.env["BENCH_ESCALA"] ?? "1");
const FILMES = Math.max(1000, Math.round(70_000 * ESCALA));
const SERIES = Math.max(500, Math.round(39_000 * ESCALA));
const TEMPORADAS = 3;
const EPISODIOS = 8;

function prismaBin(): string {
  const pkgPath = requireFromDb.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("porta indisponivel")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

interface RawClient {
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  $on: (event: "query", cb: (e: { query: string; params: string }) => void) => void;
  $disconnect: () => Promise<void>;
}

/** Semeia o catalogo com a distribuicao medida em producao, em SQL cru. */
async function semear(db: RawClient): Promise<void> {
  const run = (sql: string) => db.$executeRawUnsafe(sql);
  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true) ON CONFLICT (code) DO NOTHING`);
  await run(`INSERT INTO countries (code, name_pt, name_en) VALUES ('BR','Brasil','Brazil') ON CONFLICT (code) DO NOTHING`);
  // Votos: 82% abaixo de 100 (cauda), ~10% com 500+. Determinístico por id.
  const votos = (col: string) =>
    `CASE WHEN ${col} % 100 < 82 THEN ${col} % 90 WHEN ${col} % 100 < 90 THEN 100 + ${col} % 300 ELSE 500 + ${col} % 5000 END`;
  await run(`INSERT INTO movies (id, tmdb_id, title_original, vote_count_tmdb, updated_at, created_at)
             SELECT i, 900000 + i, 'Filme ' || i, ${votos("i")}, now(), now() FROM generate_series(1, ${FILMES}) i`);
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, vote_count_tmdb, updated_at, created_at)
             SELECT i, 700000 + i, 'Serie ' || i, ${votos("i")}, now(), now() FROM generate_series(1, ${SERIES}) i`);
  // Paises: 15% sem pais; 30% EUA; 3% Brasil; o resto de fora, com coproducao
  // (segunda posicao) em parte dos titulos — o portao olha QUALQUER posicao.
  const pais = (col: string) =>
    `CASE WHEN ${col} % 100 < 30 THEN 'US' WHEN ${col} % 100 < 33 THEN 'BR'
          WHEN ${col} % 100 < 55 THEN 'JP' WHEN ${col} % 100 < 70 THEN 'KR' ELSE 'TH' END`;
  await run(`INSERT INTO movie_production_countries (movie_id, country_code, position)
             SELECT i, ${pais("i")}, 0 FROM generate_series(1, ${FILMES}) i WHERE i % 100 >= 85 OR i % 100 < 70`);
  await run(`INSERT INTO movie_production_countries (movie_id, country_code, position)
             SELECT i, 'US', 1 FROM generate_series(1, ${FILMES}) i WHERE i % 100 BETWEEN 40 AND 44`);
  await run(`INSERT INTO tv_show_origin_countries (tv_show_id, country_code, position)
             SELECT i, ${pais("i")}, 0 FROM generate_series(1, ${SERIES}) i WHERE i % 100 >= 85 OR i % 100 < 70`);
  // Oferta BR em ~12% dos titulos, 3 linhas cada (varios provedores).
  await run(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at)
             SELECT 'movie', i, 'BR', 'Provedor ' || k, 'subscription', now()
               FROM generate_series(1, ${FILMES}) i, generate_series(1, 3) k WHERE i % 25 IN (1, 2, 3)`);
  await run(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at)
             SELECT 'tv', i, 'BR', 'Provedor ' || k, 'subscription', now()
               FROM generate_series(1, ${SERIES}) i, generate_series(1, 3) k WHERE i % 25 IN (1, 2, 3)`);
  // Slugs: ~12% no fallback tmdb-N (titulo que nao gera slug), como em producao.
  // A LICAO DA PR 323: um laboratorio sem traducao e sem decisao mediu um ganho
  // que producao desmentiu. Aqui ha as duas: toda ficha tem linha pt-BR (titulo
  // proprio, ou o original COPIADO nas tmdb-N impares, que a D3 barra) e sinopse
  // em metade delas, e decisao `index` persistida para filme e serie.
  for (const [tipo, n, prefixo, tabela, coluna] of [
    ["movie", FILMES, "filme", "movies", "title_original"],
    ["tv", SERIES, "serie", "tv_shows", "name_original"],
  ] as const) {
    await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, created_at, updated_at)
               SELECT '${tipo}', i, '${LANGUAGE}',
                      CASE WHEN i % 100 >= 88 THEN 'tmdb-' || (${tipo === "movie" ? 900000 : 700000} + i) ELSE '${prefixo}-' || i END,
                      true, now(), now()
                 FROM generate_series(1, ${n}) i`);
    await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, updated_at)
               SELECT '${tipo}', x.id, '${LANGUAGE}',
                      CASE WHEN x.id % 100 >= 88 AND x.id % 2 = 1 THEN x.${coluna} ELSE 'Titulo pt ' || x.id END,
                      CASE WHEN x.id % 2 = 0 THEN repeat('sinopse em portugues ', 6) END,
                      now()
                 FROM ${tabela} x`);
  }
  // Decisao `index` persistida (o gate de filme e serie armado, como em producao).
  for (const [tipo, n, rota] of [["movie", FILMES, "filmes"], ["tv", SERIES, "series"]] as const) {
    await run(`INSERT INTO page_indexability_decisions
                 (entity_type, entity_id, language_code, url, decision, is_current, decision_origin, reason)
               SELECT '${tipo}', i, '${LANGUAGE}', 'https://cinerie.com/pt/${rota}/x-' || i || '/', 'index', true,
                      'catalog_policy_engine', 'bench'
                 FROM generate_series(1, ${n}) i`);
  }
  await run(`INSERT INTO seasons (id, tv_show_id, season_number, overview, updated_at, created_at)
             SELECT (i - 1) * ${TEMPORADAS} + k, i, k,
                    CASE WHEN k % 2 = 1 THEN repeat('sinopse propria da temporada ', 4) END, now(), now()
               FROM generate_series(1, ${SERIES}) i, generate_series(1, ${TEMPORADAS}) k`);
  await run(`INSERT INTO episodes (id, season_id, tv_show_id, episode_number, overview, still_path, updated_at, created_at)
             SELECT (se.id - 1) * ${EPISODIOS} + n, se.id, se.tv_show_id, n,
                    CASE WHEN n % 3 <> 0 THEN repeat('sinopse de verdade do episodio ', 3) END,
                    CASE WHEN n % 5 = 0 THEN NULL ELSE '/still' || se.id || '-' || n || '.jpg' END, now(), now()
               FROM seasons se, generate_series(1, ${EPISODIOS}) n`);
  await run("ANALYZE");
}

/** Uma consulta emitida pelo sitemap, com os parametros como o Prisma os mandou. */
interface Emitida {
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * Troca SO o bloco do portao do SQL emitido por um no-op TIPADO e sempre
 * verdadeiro que ainda cita os mesmos `$n` (o PostgreSQL recusa parametro que
 * nenhum trecho do texto tipa). Com plano customizado, `true OR ...` e dobrado
 * na hora do planejamento: sobra a consulta de antes da decisao. Devolve null
 * quando o bloco nao existe.
 */
function semPortao(sql: string): string | null {
  const re =
    /AND \(\s*\$(\d+)\s+OR COALESCE\([a-z]\.vote_count_tmdb, 0\) >= \$(\d+)[\s\S]*?ANY\(\$(\d+)\)[\s\S]*?rw\.country_code = \$(\d+)\s*\)\s*\)/g;
  const out = sql.replace(
    re,
    (_bloco, chave: string, votos: string, ancoras: string, oferta: string) =>
      `AND (true OR $${chave}::boolean OR $${votos}::int IS NULL OR $${ancoras}::text[] IS NULL OR $${oferta}::text IS NULL)`,
  );
  return out === sql ? null : out;
}

function tempoDoPlano(plano: string): number {
  const m = /Execution Time: ([\d.]+) ms/.exec(plano);
  return m === null ? Number.NaN : Number(m[1]);
}

async function explain(db: RawClient, q: Emitida): Promise<{ ms: number; plano: string }> {
  const rows = await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q.sql}`,
    ...q.params,
  );
  const plano = rows.map((r) => r["QUERY PLAN"]).join("\n");
  return { ms: tempoDoPlano(plano), plano };
}

async function contarLinhas(db: RawClient, q: Emitida): Promise<number> {
  const rows = await db.$queryRawUnsafe<unknown[]>(q.sql, ...q.params);
  // Consulta de contagem devolve UMA linha com `n`; de pagina, as linhas.
  const primeira = rows[0] as { n?: number } | undefined;
  return rows.length === 1 && primeira !== undefined && typeof primeira.n === "number" ? primeira.n : rows.length;
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-bench-relevance-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bench_relevance`;
  let started = false;
  let falhou = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("bench_relevance");
    process.env.DATABASE_URL = url;
    await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", SCHEMA], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
      cwd: DB_DIR,
    });

    const prismaMod = (await import(pathToFileURL(requireFromDb.resolve("@prisma/client")).href)) as {
      PrismaClient: new (opts: unknown) => RawClient;
    };
    const db = new prismaMod.PrismaClient({ datasourceUrl: url, log: [{ emit: "event", level: "query" }] });
    const emitidas: Emitida[] = [];
    let gravando = false;
    db.$on("query", (e) => {
      // O log do Prisma manda os parametros com caractere de controle CRU dentro
      // das strings (a lista de BTRIM da sinopse: espaco, tab, CR, LF). Escapar
      // antes de ler: JSON nao aceita controle literal dentro de string.
      const params = Array.from(e.params, (c) =>
        c.charCodeAt(0) < 0x20 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c,
      ).join("");
      if (gravando) emitidas.push({ sql: e.query, params: JSON.parse(params) as unknown[] });
    });

    const t0 = Date.now();
    await semear(db);
    console.log(`\nsemeado: ${FILMES} filmes, ${SERIES} series, ${SERIES * TEMPORADAS} temporadas, ${SERIES * TEMPORADAS * EPISODIOS} episodios (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

    const sitemap = (await import("../src/server/seo/sitemap-index.ts")) as {
      getSitemapIndexXml: (opts?: { limit?: number }, client?: unknown) => Promise<{ xml: string }>;
      getSitemapShardXml: (id: string, opts?: { limit?: number }, client?: unknown) => Promise<{ xml: string } | null>;
    };

    // Captura o SQL que o sitemap emite com o portao LIGADO: o index (contagens)
    // e o shard 1 de cada tipo.
    delete process.env[ENV_VAR];
    gravando = true;
    const tIndexOn = Date.now();
    await sitemap.getSitemapIndexXml(undefined, db);
    const msIndexOn = Date.now() - tIndexOn;
    for (const tipo of ["movies", "series", "seasons", "episodes"]) {
      await sitemap.getSitemapShardXml(`sitemap-${LANGUAGE}-${tipo}-1.xml`, undefined, db);
    }
    gravando = false;
    // O shard reemite a contagem do index: a mesma consulta, com os mesmos
    // parametros, conta uma vez so.
    const vistas = new Set<string>();
    const comPortao = emitidas.filter((q) => {
      const chave = `${q.sql}\u0000${JSON.stringify(q.params)}`;
      if (semPortao(q.sql) === null || vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    });

    process.env[ENV_VAR] = "off";
    const tIndexOff = Date.now();
    await sitemap.getSitemapIndexXml(undefined, db);
    const msIndexOff = Date.now() - tIndexOff;
    delete process.env[ENV_VAR];

    console.log(`\n/sitemap.xml (funcao real, contagens de todos os tipos): portao off ${msIndexOff} ms · portao on ${msIndexOn} ms`);
    console.log(`consultas do sitemap com o bloco do portao: ${comPortao.length} (esperado 8)\n`);
    if (comPortao.length !== 8) falhou = true;

    console.log("| consulta | linhas antes | linhas depois | antes (ms) | depois (ms) |");
    console.log("|---|---:|---:|---:|---:|");
    for (const depois of comPortao) {
      const antes: Emitida = { sql: semPortao(depois.sql)!, params: depois.params };
      // Temporada primeiro: o guia de episodios da temporada cita `FROM episodes`.
      const nome = /FROM seasons se/.test(depois.sql)
        ? "temporadas"
        : /FROM episodes e/.test(depois.sql)
          ? "episodios"
          : /JOIN movies m/.test(depois.sql)
            ? "filmes"
            : /JOIN tv_shows t/.test(depois.sql)
              ? "series"
              : "?";
      const tipoConsulta = /^\s*SELECT COUNT\(\*\)::int AS n/.test(depois.sql) ? "contagem" : "pagina";
      const linhasDepois = await contarLinhas(db, depois);
      const linhasAntes = await contarLinhas(db, antes);
      const eAntes = await explain(db, antes);
      const eDepois = await explain(db, depois);
      console.log(`| ${tipoConsulta} ${nome} | ${linhasAntes} | ${linhasDepois} | ${eAntes.ms.toFixed(1)} | ${eDepois.ms.toFixed(1)} |`);
      // Contagem: o portao tem de barrar alguem. Pagina: o LIMIT do shard pode
      // igualar os dois lados, mas o depois nunca traz MAIS.
      if (tipoConsulta === "contagem" ? !(linhasDepois < linhasAntes) : linhasDepois > linhasAntes) {
        falhou = true;
      }
      if (process.env["BENCH_PLANOS"] === "1") {
        console.log(`\n--- ANTES ---\n${eAntes.plano}\n--- DEPOIS ---\n${eDepois.plano}\n`);
      }
    }

    // O ANTES derivado tem de bater com a funcao real desligada.
    process.env[ENV_VAR] = "off";
    const offShard = await sitemap.getSitemapShardXml(`sitemap-${LANGUAGE}-movies-1.xml`, undefined, db);
    delete process.env[ENV_VAR];
    const onShard = await sitemap.getSitemapShardXml(`sitemap-${LANGUAGE}-movies-1.xml`, undefined, db);
    const n = (xml: string | undefined) => (xml?.match(/<loc>/g) ?? []).length;
    // Com volume de producao os dois lados enchem o shard (teto de URLs por
    // arquivo): o ligado nunca traz MAIS. Quem prova que o portao barra alguem
    // sao as contagens da tabela acima.
    console.log(`\nshard 1 de filmes: off ${n(offShard?.xml)} URLs · on ${n(onShard?.xml)} URLs`);
    if (n(onShard?.xml) > n(offShard?.xml)) falhou = true;
    await db.$disconnect();
  } catch (error) {
    console.error(error);
    falhou = true;
  } finally {
    delete process.env[ENV_VAR];
    if (started) await pg.stop();
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch {
      /* o SO limpa */
    }
  }
  console.log(falhou ? "\nResultado: REPROVOU." : "\nResultado: PASSOU.");
  process.exit(falhou ? 1 : 0);
}

void main();
