/**
 * validate-relevance-gate-real-postgres.ts — o PORTAO DE RELEVANCIA (decisao do
 * dono, 24/09/2026) provado contra PostgreSQL 16 REAL e efemero.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao roda no render/build/producao.
 * Zero rede, zero TMDB, zero Gemini.
 *
 * O QUE SO O BANCO REAL PROVA
 *   1. que a PAGINA (`getMoviePageData`, `getSeriesPageData`, temporada e
 *      episodio) e o SITEMAP (o SQL de `sitemap-index.ts` rodando no PostgreSQL)
 *      dao o MESMO veredito para cada titulo da fixture mista;
 *   2. que temporada e episodio saem JUNTO com a serie que sai;
 *   3. que o titulo que ganha pais EUA volta aos dois, sem comando nenhum;
 *   4. que `CINERIE_RELEVANCE_GATE=off` devolve pagina e sitemap ao que eram
 *      antes da decisao — lida em runtime, sem reiniciar nada;
 *   5. que o SQL de simulacao (`docs/operations/simulacao-portao-relevancia.sql`)
 *      roda so-leitura, devolve UMA celula JSON e conta exatamente o que o
 *      sitemap deixou de anunciar.
 *
 * Uso: pnpm --filter @screena/web validate:relevance-gate
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { runChild } from "@screena/db/async-child-process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));
const SIMULATION_SQL = path.join(repoRoot, "docs", "operations", "simulacao-portao-relevancia.sql");

const LANGUAGE = "pt-BR";
const BIG = 50_000;
const ENV_VAR = "CINERIE_RELEVANCE_GATE";

let passed = 0;
let total = 0;
function record(name: string, ok: boolean, detail: string): void {
  total += 1;
  if (ok) passed += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${total}. ${name} — ${detail}`);
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
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

function locsInXml(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]*)<\/loc>/g), (m) => m[1] ?? "");
}

type Raw = {
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
  $transaction: <T>(fn: (tx: Raw) => Promise<T>) => Promise<T>;
};

interface SeoOut {
  seo: { decision: string; decisionSource: string; reason: string; robots: { index: boolean; follow: boolean } };
}
interface Seams {
  getMoviePageData: (slug: string) => Promise<SeoOut | null>;
  getSeriesPageData: (slug: string) => Promise<SeoOut | null>;
  getSeasonPageData: (seriesSlug: string, season: number) => Promise<SeoOut | null>;
  getEpisodePageData: (seriesSlug: string, season: number, episode: number) => Promise<SeoOut | null>;
  getSitemapShardXml: (id: string, opts?: { limit?: number }) => Promise<{ xml: string } | null>;
}

const SINOPSE =
  "Uma familia descobre, na mesma noite, o segredo que o pai guardou por vinte anos.";

/** O pedaco da celula JSON do SQL de simulacao que este validador confere. */
interface SimulationCell {
  readonly titulos_que_saem?: {
    readonly total: number;
    readonly filmes: number;
    readonly series: number;
    readonly pct_do_catalogo: number;
    readonly com_oferta_br: number;
    readonly sem_pais: { readonly filmes: number; readonly series: number };
    readonly com_pais_fora_de_eua_br: { readonly filmes: number; readonly series: number };
  };
  readonly paginas_de_titulo_indexadas?: { readonly saem_total: number };
  readonly urls_que_saem_junto_com_a_serie?: { readonly temporadas: number; readonly episodios: number };
  readonly top50_mais_votados_que_saem?: { tipo: string; tmdb_id: number; votos: number }[] | null;
  readonly sem_pais_que_saem_e_tem_pais_no_payload_api_cache?: { readonly total: number };
}

/** A fixture mista. `fica` e o veredito que a decisao do dono manda. */
interface TitleFixture {
  readonly kind: "movie" | "tv";
  readonly id: number;
  readonly tmdbId: number;
  readonly slug: string;
  readonly countries: readonly string[];
  readonly votes: number;
  readonly offerBr: boolean;
  readonly fica: boolean;
}

const FIXTURE: readonly TitleFixture[] = [
  { kind: "movie", id: 1, tmdbId: 7001, slug: "eua-de-cauda", countries: ["US"], votes: 3, offerBr: false, fica: true },
  { kind: "movie", id: 2, tmdbId: 7002, slug: "tailandes-sem-oferta", countries: ["TH"], votes: 3, offerBr: false, fica: false },
  { kind: "movie", id: 3, tmdbId: 7003, slug: "coreano-com-oferta-br", countries: ["KR"], votes: 0, offerBr: true, fica: true },
  { kind: "movie", id: 4, tmdbId: 7004, slug: "britanico-600-votos", countries: ["GB"], votes: 600, offerBr: false, fica: true },
  { kind: "movie", id: 5, tmdbId: 7005, slug: "sem-pais-zero-votos", countries: [], votes: 0, offerBr: false, fica: false },
  { kind: "movie", id: 6, tmdbId: 7006, slug: "sem-pais-com-oferta-br", countries: [], votes: 0, offerBr: true, fica: true },
  { kind: "movie", id: 7, tmdbId: 7007, slug: "sem-pais-600-votos", countries: [], votes: 600, offerBr: false, fica: true },
  { kind: "movie", id: 8, tmdbId: 7008, slug: "frances-499-votos", countries: ["FR"], votes: 499, offerBr: false, fica: false },
  { kind: "movie", id: 9, tmdbId: 7009, slug: "frances-500-votos", countries: ["FR"], votes: 500, offerBr: false, fica: true },
  { kind: "movie", id: 10, tmdbId: 7010, slug: "coproducao-br-segunda-posicao", countries: ["PT", "BR"], votes: 1, offerBr: false, fica: true },
  { kind: "tv", id: 21, tmdbId: 8021, slug: "serie-tailandesa", countries: ["TH"], votes: 10, offerBr: false, fica: false },
  { kind: "tv", id: 22, tmdbId: 8022, slug: "serie-americana", countries: ["US"], votes: 2, offerBr: false, fica: true },
  { kind: "tv", id: 23, tmdbId: 8023, slug: "serie-sem-pais", countries: [], votes: 0, offerBr: false, fica: false },
  { kind: "tv", id: 24, tmdbId: 8024, slug: "serie-coreana-com-oferta-br", countries: ["KR"], votes: 0, offerBr: true, fica: true },
];

async function seed(prisma: Raw): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  // Paises fora do seed (TH, KR) para a oferta e a FK de watch_availability;
  // os vinculos de pais nao tem FK (so CHECK de forma).
  await run(`INSERT INTO countries (code, name_pt, name_en) VALUES ('TH','Tailandia','Thailand'),('KR','Coreia do Sul','South Korea')
             ON CONFLICT (code) DO NOTHING`);
  await run(`INSERT INTO api_providers (key, name, kind) VALUES ('tmdb','TMDB','data') ON CONFLICT (key) DO NOTHING`);

  for (const t of FIXTURE) {
    const titulo = t.slug.replace(/-/g, " ");
    if (t.kind === "movie") {
      await run(`INSERT INTO movies (id, tmdb_id, title_original, vote_count_tmdb, updated_at)
                 VALUES (${t.id}, ${t.tmdbId}, '${titulo}', ${t.votes}, now())`);
      for (const [pos, code] of t.countries.entries()) {
        await run(`INSERT INTO movie_production_countries (movie_id, country_code, position) VALUES (${t.id}, '${code}', ${pos})`);
      }
    } else {
      await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, vote_count_tmdb, updated_at)
                 VALUES (${t.id}, ${t.tmdbId}, '${titulo}', ${t.votes}, now())`);
      for (const [pos, code] of t.countries.entries()) {
        await run(`INSERT INTO tv_show_origin_countries (tv_show_id, country_code, position) VALUES (${t.id}, '${code}', ${pos})`);
      }
      // Uma temporada com sinopse e um episodio com sinopse E imagem: passam no
      // portao de conteudo de 22/09 — so a serie dona decide se ficam.
      await run(`INSERT INTO seasons (id, tv_show_id, season_number, name, overview, updated_at)
                 VALUES (${t.id * 10}, ${t.id}, 1, 'Temporada 1', '${SINOPSE}', now())`);
      await run(`INSERT INTO episodes (id, season_id, tv_show_id, episode_number, name, overview, still_path, updated_at)
                 VALUES (${t.id * 100}, ${t.id * 10}, ${t.id}, 1, 'Piloto', '${SINOPSE}', '/still-${t.id}.jpg', now())`);
    }
    const tipo = t.kind;
    await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at)
               VALUES ('${tipo}', ${t.id}, '${LANGUAGE}', '${t.slug}', true, now())`);
    await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, updated_at)
               VALUES ('${tipo}', ${t.id}, '${LANGUAGE}', 'Titulo ${titulo}', now())`);
    if (t.offerBr) {
      await run(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at)
                 VALUES ('${tipo}', ${t.id}, 'BR', 'Provedor', 'subscription', now())`);
    }
  }
  // Oferta FORA do Brasil nao conta: o tailandes tem oferta nos EUA e continua saindo.
  await run(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at)
             VALUES ('movie', 2, 'US', 'Provedor', 'subscription', now())`);
  // O sem-pais que sai tem pais no payload do api_cache: e o caso que o backfill
  // de pais devolve ao indice.
  await run(`INSERT INTO api_cache (provider_api, endpoint, request_key, params_hash, payload, payload_hash)
             VALUES ('tmdb', '/movie/7005', '/movie/7005?x', 'h',
                     '{"id":7005,"production_countries":[{"iso_3166_1":"US","name":"United States of America"}]}'::jsonb, 'p')`);
  for (const tabela of ["movies", "tv_shows", "seasons", "episodes"]) {
    await run(`SELECT setval(pg_get_serial_sequence('${tabela}','id'), 10000)`);
  }
}

/** O arquivo SQL como o dono roda no DbGate, numa transacao READ ONLY. */
async function runReadOnlySqlFile(
  prisma: Raw,
  file: string,
): Promise<{ firstLine: string; rows: Record<string, unknown>[] }> {
  const text = readFileSync(file, "utf8");
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const statements = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt !== "");
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    let last: Record<string, unknown>[] = [];
    for (const stmt of statements) {
      if (/^SET\s/i.test(stmt)) await tx.$executeRawUnsafe(stmt);
      else last = await tx.$queryRawUnsafe<Record<string, unknown>[]>(stmt);
    }
    // O SET do arquivo e de SESSAO; nao pode vazar para o resto do validador.
    await tx.$executeRawUnsafe("RESET default_transaction_read_only");
    await tx.$executeRawUnsafe("RESET statement_timeout");
    return last;
  });
  return { firstLine, rows };
}

async function snapshot(seams: Seams): Promise<{
  pages: Map<string, SeoOut["seo"] | null>;
  sitemap: Set<string>;
}> {
  const pages = new Map<string, SeoOut["seo"] | null>();
  for (const t of FIXTURE) {
    const data =
      t.kind === "movie" ? await seams.getMoviePageData(t.slug) : await seams.getSeriesPageData(t.slug);
    pages.set(`${t.kind}:${t.slug}`, data?.seo ?? null);
    if (t.kind === "tv") {
      pages.set(`season:${t.slug}`, (await seams.getSeasonPageData(t.slug, 1))?.seo ?? null);
      pages.set(`episode:${t.slug}`, (await seams.getEpisodePageData(t.slug, 1, 1))?.seo ?? null);
    }
  }
  const sitemap = new Set<string>();
  for (const tipo of ["movies", "series", "seasons", "episodes"]) {
    const shard = await seams.getSitemapShardXml(`sitemap-${LANGUAGE}-${tipo}-1.xml`, { limit: BIG });
    for (const loc of locsInXml(shard?.xml ?? "")) sitemap.add(loc);
  }
  return { pages, sitemap };
}

const urlOf = (key: string): string => {
  const [tipo, slug] = key.split(":") as [string, string];
  if (tipo === "movie") return `/pt/filmes/${slug}/`;
  if (tipo === "tv") return `/pt/series/${slug}/`;
  if (tipo === "season") return `/pt/series/${slug}/temporadas/1/`;
  return `/pt/series/${slug}/temporadas/1/episodios/1/`;
};

function inSitemap(sitemap: Set<string>, key: string): boolean {
  const path = urlOf(key);
  return [...sitemap].some((loc) => loc.endsWith(path));
}

async function runChecks(prisma: Raw, seams: Seams): Promise<void> {
  await seed(prisma);
  delete process.env[ENV_VAR];

  // ---- 1. Fixture mista: pagina e sitemap, com o portao LIGADO (default) ----
  const on = await snapshot(seams);
  const esperado = new Map<string, boolean>();
  for (const t of FIXTURE) {
    esperado.set(`${t.kind}:${t.slug}`, t.fica);
    if (t.kind === "tv") {
      esperado.set(`season:${t.slug}`, t.fica);
      esperado.set(`episode:${t.slug}`, t.fica);
    }
  }
  const erradosPagina: string[] = [];
  const divergentes: string[] = [];
  for (const [key, fica] of esperado) {
    const seo = on.pages.get(key);
    const indexa = seo?.decision === "index";
    if (seo === null || seo === undefined) erradosPagina.push(`${key}=404`);
    else if (indexa !== fica) erradosPagina.push(`${key}=${seo.decision}`);
    if (indexa !== inSitemap(on.sitemap, key)) divergentes.push(key);
  }
  record(
    "portao LIGADO por padrao (variavel ausente): cada pagina da fixture mista tem o veredito da decisao",
    erradosPagina.length === 0,
    erradosPagina.length === 0 ? `${esperado.size} paginas conferidas` : erradosPagina.join(" "),
  );
  record(
    "PARIDADE: pagina x sitemap concordam para TODA pagina da fixture (filme, serie, temporada, episodio)",
    divergentes.length === 0,
    divergentes.length === 0 ? `${esperado.size} paginas` : `divergem: ${divergentes.join(" ")}`,
  );

  const tailandes = on.pages.get("movie:tailandes-sem-oferta");
  record(
    "tailandes sem oferta: noindex, FOLLOW, pelo portao de qualidade, com motivo de pais",
    tailandes?.decision === "noindex" &&
      tailandes.robots.follow === true &&
      tailandes.decisionSource === "quality-gate" &&
      tailandes.reason.includes("TH"),
    `decision=${tailandes?.decision} follow=${tailandes?.robots.follow} source=${tailandes?.decisionSource}`,
  );
  const semPais = on.pages.get("movie:sem-pais-zero-votos");
  record(
    "sem pais com 0 votos: sai, com o motivo 'SEM pais' (distinto de pais fora de EUA/BR)",
    semPais?.decision === "noindex" && semPais.reason.includes("SEM pais"),
    `decision=${semPais?.decision}`,
  );
  record(
    "EUA de cauda fica; coreano com oferta BR fica; britanico com 600 votos fica",
    on.pages.get("movie:eua-de-cauda")?.decision === "index" &&
      on.pages.get("movie:coreano-com-oferta-br")?.decision === "index" &&
      on.pages.get("movie:britanico-600-votos")?.decision === "index",
    "ok",
  );
  record(
    "fronteira: 499 votos sai, 500 fica (pagina e sitemap)",
    on.pages.get("movie:frances-499-votos")?.decision === "noindex" &&
      !inSitemap(on.sitemap, "movie:frances-499-votos") &&
      on.pages.get("movie:frances-500-votos")?.decision === "index" &&
      inSitemap(on.sitemap, "movie:frances-500-votos"),
    "ok",
  );
  record(
    "serie tailandesa sai e LEVA JUNTO temporada e episodio (pagina e sitemap)",
    on.pages.get("season:serie-tailandesa")?.decision === "noindex" &&
      on.pages.get("episode:serie-tailandesa")?.decision === "noindex" &&
      !inSitemap(on.sitemap, "season:serie-tailandesa") &&
      !inSitemap(on.sitemap, "episode:serie-tailandesa"),
    `temporada=${on.pages.get("season:serie-tailandesa")?.decision} episodio=${on.pages.get("episode:serie-tailandesa")?.decision}`,
  );
  record(
    "CONTROLE: serie americana e a coreana com oferta mantem temporada e episodio no sitemap",
    inSitemap(on.sitemap, "season:serie-americana") &&
      inSitemap(on.sitemap, "episode:serie-americana") &&
      inSitemap(on.sitemap, "episode:serie-coreana-com-oferta-br"),
    "ok",
  );

  // ---- 2. SQL de simulacao: o que ele conta e o que o sitemap deixou de anunciar ----
  process.env[ENV_VAR] = "off";
  const offParaSimular = await snapshot(seams);
  delete process.env[ENV_VAR];
  const sairam = [...offParaSimular.sitemap].filter((loc) => !on.sitemap.has(loc));
  const simulacao = await runReadOnlySqlFile(prisma, SIMULATION_SQL);
  const cell = simulacao.rows[0]?.simulacao as SimulationCell | undefined;
  record(
    "simulacao: primeira linha poe a sessao em so-leitura; UMA linha, UMA coluna JSON",
    simulacao.firstLine === "SET default_transaction_read_only = on;" &&
      simulacao.rows.length === 1 &&
      Object.keys(simulacao.rows[0] ?? {}).length === 1 &&
      cell !== undefined,
    `linhas=${simulacao.rows.length} colunas=${Object.keys(simulacao.rows[0] ?? {}).join(",")}`,
  );
  const saem = cell?.titulos_que_saem;
  record(
    "simulacao: titulos que saem por tipo, sem pais e com pais fora de EUA/BR",
    Number(saem?.total) === 5 &&
      Number(saem?.filmes) === 3 &&
      Number(saem?.series) === 2 &&
      Number(saem?.sem_pais?.filmes) === 1 &&
      Number(saem?.sem_pais?.series) === 1 &&
      Number(saem?.com_pais_fora_de_eua_br?.filmes) === 2 &&
      Number(saem?.com_pais_fora_de_eua_br?.series) === 1,
    JSON.stringify({ total: saem?.total, filmes: saem?.filmes, series: saem?.series, sem_pais: saem?.sem_pais }),
  );
  record(
    "simulacao: 0 titulo sai com oferta no Brasil",
    Number(saem?.com_oferta_br) === 0,
    `com_oferta_br=${saem?.com_oferta_br}`,
  );
  const paginas = cell?.paginas_de_titulo_indexadas;
  const urls = cell?.urls_que_saem_junto_com_a_serie;
  const sairamTitulos = sairam.filter((loc) => !loc.includes("/temporadas/"));
  const sairamTemporadas = sairam.filter((loc) => /\/temporadas\/\d+\/$/.test(loc));
  const sairamEpisodios = sairam.filter((loc) => loc.includes("/episodios/"));
  record(
    "simulacao x sitemap: paginas de titulo, temporadas e episodios que saem batem com o que o sitemap deixou de anunciar",
    Number(paginas?.saem_total) === sairamTitulos.length &&
      Number(urls?.temporadas) === sairamTemporadas.length &&
      Number(urls?.episodios) === sairamEpisodios.length &&
      sairamTitulos.length === 5,
    `sql=${paginas?.saem_total}/${urls?.temporadas}/${urls?.episodios} sitemap=${sairamTitulos.length}/${sairamTemporadas.length}/${sairamEpisodios.length}`,
  );
  const top = cell?.top50_mais_votados_que_saem ?? [];
  record(
    "simulacao: top mais votados que saem, em ordem de votos",
    top.length === 5 && top[0]?.tmdb_id === 7008 && top[0]?.votos === 499,
    JSON.stringify(top.map((t) => `${t.tipo}:${t.tmdb_id}:${t.votos}`)),
  );
  record(
    "simulacao: sem pais que sai e TEM pais no payload do api_cache = 1 (o 7005)",
    Number(cell?.sem_pais_que_saem_e_tem_pais_no_payload_api_cache?.total) === 1,
    JSON.stringify(cell?.sem_pais_que_saem_e_tem_pais_no_payload_api_cache),
  );
  record(
    "simulacao: percentual do catalogo que sai",
    Number(saem?.pct_do_catalogo) === Number(((100 * 5) / FIXTURE.length).toFixed(2)),
    `pct=${saem?.pct_do_catalogo}`,
  );

  // ---- 3. Volta automatica: ganhou pais EUA, volta aos dois -----------------
  await prisma.$executeRawUnsafe(
    `INSERT INTO movie_production_countries (movie_id, country_code, position) VALUES (2, 'US', 1)`,
  );
  const depoisDoPais = await snapshot(seams);
  record(
    "titulo que GANHA pais EUA volta ao indice na pagina E no sitemap, sem comando",
    depoisDoPais.pages.get("movie:tailandes-sem-oferta")?.decision === "index" &&
      inSitemap(depoisDoPais.sitemap, "movie:tailandes-sem-oferta"),
    `decision=${depoisDoPais.pages.get("movie:tailandes-sem-oferta")?.decision}`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM movie_production_countries WHERE movie_id = 2 AND country_code = 'US'`);

  // ---- 4. Chave de emergencia: off = pagina e sitemap de antes -------------
  process.env[ENV_VAR] = "off";
  const off = await snapshot(seams);
  const naoIndexaOff = [...off.pages].filter(([, seo]) => seo?.decision !== "index").map(([k]) => k);
  const foraDoSitemapOff = [...esperado.keys()].filter((key) => !inSitemap(off.sitemap, key));
  record(
    "CINERIE_RELEVANCE_GATE=off: TODA pagina da fixture volta a index (o estado anterior a decisao)",
    naoIndexaOff.length === 0,
    naoIndexaOff.length === 0 ? `${off.pages.size} paginas index` : naoIndexaOff.join(" "),
  );
  record(
    "CINERIE_RELEVANCE_GATE=off: o sitemap volta a anunciar TODAS (titulos, temporadas, episodios)",
    foraDoSitemapOff.length === 0 && off.sitemap.size === on.sitemap.size + sairam.length,
    `fora=${foraDoSitemapOff.join(" ") || "nenhuma"} on=${on.sitemap.size} off=${off.sitemap.size}`,
  );
  process.env[ENV_VAR] = "  OFF ";
  const offMaiusculo = await snapshot(seams);
  process.env[ENV_VAR] = "desligado";
  const valorInvalido = await snapshot(seams);
  delete process.env[ENV_VAR];
  const deVolta = await snapshot(seams);
  record(
    "a chave e lida em RUNTIME: '  OFF ' desliga; qualquer outro valor liga; remover religa",
    offMaiusculo.sitemap.size === off.sitemap.size &&
      valorInvalido.sitemap.size === on.sitemap.size &&
      deVolta.sitemap.size === on.sitemap.size &&
      deVolta.pages.get("movie:tailandes-sem-oferta")?.decision === "noindex",
    `OFF=${offMaiusculo.sitemap.size} invalido=${valorInvalido.sitemap.size} religado=${deVolta.sitemap.size}`,
  );
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-relevance-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_relevance?schema=public`;
  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_relevance");
    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };
    await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    await runChild("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    record("migrate deploy + db seed", true, "ok");

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => Raw;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const seams: Seams = {
      getMoviePageData: ((await import("../src/server/movie-page.ts")) as Pick<Seams, "getMoviePageData">).getMoviePageData,
      getSeriesPageData: ((await import("../src/server/series-page.ts")) as Pick<Seams, "getSeriesPageData">).getSeriesPageData,
      getSeasonPageData: ((await import("../src/server/season-page.ts")) as Pick<Seams, "getSeasonPageData">).getSeasonPageData,
      getEpisodePageData: ((await import("../src/server/episode-page.ts")) as Pick<Seams, "getEpisodePageData">).getEpisodePageData,
      getSitemapShardXml: ((await import("../src/server/seo/sitemap-index.ts")) as Pick<Seams, "getSitemapShardXml">).getSitemapShardXml,
    };
    await runChecks(dbServer.getPrismaClient(), seams);
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error);
    record("execucao sem excecao", false, msg.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "?");
  } finally {
    delete process.env[ENV_VAR];
    if (disconnect) await disconnect();
    if (started) await pg.stop();
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch {
      /* o SO limpa */
    }
  }
  console.log(`\nRESUMO: ${passed}/${total} checks OK.`);
  if (passed !== total) process.exit(1);
  console.log("Resultado: PASSOU. Portao de relevancia validado contra PostgreSQL real.");
}

main().catch((error) => {
  console.error("Erro fatal:", error);
  process.exit(1);
});
