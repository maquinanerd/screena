/**
 * bench-sitemap-person-gate-real-postgres.ts — a consulta ANTIGA contra a NOVA,
 * no MESMO PostgreSQL 16 real e efemero, com volume.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao roda no render/build/producao.
 *
 * ============================================================================
 * O QUE ELA PROVA, E POR QUE NAO BASTA "ficou mais rapido"
 * ============================================================================
 * MEDIDO em producao em 22/09/2026, horas depois de o portao de pessoa (D2) e o
 * portao de conteudo de temporada/episodio entrarem no ar:
 *
 *   /sitemap.xml                       3.969 ms  ->  31.662 ms   (cache frio)
 *   /sitemaps/...-people-1.xml            ---    ->  30.270 ms
 *
 * A causa: o portao de pessoa era uma subconsulta CORRELACIONADA, refeita para
 * cada uma das ~73,5 mil pessoas com slug. O LIMIT limitava o trabalho POR
 * pessoa e nunca o numero de pessoas.
 *
 * Um benchmark que so mede o novo nao prova nada: seria rapido tambem se o
 * portao tivesse deixado de barrar alguem. Por isso este script roda as DUAS
 * consultas no mesmo banco e, antes de comparar tempo, exige que elas devolvam
 * EXATAMENTE o mesmo conjunto de pessoas. Resultado diferente reprova, por mais
 * rapida que a nova seja.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";
import { runChild } from "@screena/db/async-child-process";

import { PUBLISHED_LOCALES } from "@screena/config";
import {
  MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY,
  MIN_SYNOPSIS_CHARS,
  TMDB_FALLBACK_SLUG_SQL_PATTERN,
} from "@screena/seo";

// A MESMA lista que o sitemap usa, montada aqui do mesmo lugar: o benchmark
// nao pode inventar o proprio conjunto de locales publicados.
const PUBLISHED_LOCALE_CODES: string[] = [...PUBLISHED_LOCALES];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const DB_DIR = path.join(REPO, "packages", "db");
const SCHEMA = path.join(DB_DIR, "prisma", "schema.prisma");
const LANGUAGE = "pt-BR";

/**
 * Volume do laboratorio. O default aproxima PRODUCAO (medida em 22/09/2026:
 * 92.335 obras no sitemap, ~73,5 mil pessoas com slug) — e o unico ponto em que
 * a diferenca entre varrer uma vez e varrer por pessoa aparece de verdade.
 * `BENCH_ESCALA=0.1` roda um decimo, para iterar rapido.
 */
const ESCALA = Number(process.env["BENCH_ESCALA"] ?? "1");
const OBRAS = Math.max(100, Math.round(90_000 * ESCALA));
const PESSOAS = Math.max(100, Math.round(70_000 * ESCALA));
const CREDITOS_POR_PESSOA = 6;
const SERIES = Math.max(50, Math.round(32_000 * ESCALA));
const TEMPORADAS_POR_SERIE = 4;
const EPISODIOS_POR_TEMPORADA = 10;

// O MESMO resolvedor dos validadores: no layout do pnpm o binario nao fica em
// node_modules/prisma, e um caminho fixo falha com MODULE_NOT_FOUND vazio.
// Resolve a partir de packages/db, que E quem depende do prisma. Resolver a
// partir daqui falha no layout do pnpm: apps/web nao tem o pacote linkado.
const requireFromDb = createRequire(path.join(DB_DIR, "package.json"));

function prismaBin(): string {
  const pkgPath = requireFromDb.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
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
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Semeia catalogo, pessoas e creditos direto em SQL.
 *
 * Por que SQL cru e nao Prisma: sao dezenas de milhares de linhas, e o objetivo
 * aqui e o PLANO da consulta, nao a camada de acesso. `generate_series` cria o
 * volume numa unica ida ao banco.
 */
async function semear(prisma: RawClient): Promise<void> {
  // Uma parte das obras fica FORA do indice (slug de fallback sem traducao), e
  // uma parte das pessoas fica sem foto: sem isso o portao nao barraria ninguem
  // e a comparacao seria vazia.
  // `slugs.language_code` tem FK para `languages`, e o banco recem-migrado nasce
  // sem o dicionario: o vocabulario so vem pelo seed, que o release nao roda.
  await prisma.$executeRawUnsafe(`
    INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
    VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true)
    ON CONFLICT (code) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO movies (id, tmdb_id, title_original, updated_at, created_at)
    SELECT i, 900000 + i, 'Filme ' || i, NOW(), NOW() FROM generate_series(1, ${OBRAS}) i
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, created_at, updated_at)
    SELECT 'movie', i, '${LANGUAGE}',
      CASE WHEN i % 4 = 0 THEN 'tmdb-' || i ELSE 'filme-' || i END,
      true, NOW(), NOW()
    FROM generate_series(1, ${OBRAS}) i
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO people (id, tmdb_id, name, profile_path, updated_at, created_at)
    SELECT i, 800000 + i, 'Pessoa ' || i,
      CASE WHEN i % 5 = 0 THEN NULL ELSE '/foto' || i || '.jpg' END,
      NOW(), NOW()
    FROM generate_series(1, ${PESSOAS}) i
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, created_at, updated_at)
    SELECT 'person', i, '${LANGUAGE}', 'pessoa-' || i, true, NOW(), NOW()
    FROM generate_series(1, ${PESSOAS}) i
  `);
  // Creditos: elenco e equipe, com sobreposicao de proposito (a mesma pessoa no
  // elenco E na equipe do mesmo titulo) — e o caso que exige contar OBRA
  // distinta, nao linha de credito.
  await prisma.$executeRawUnsafe(`
    INSERT INTO cast_members (person_id, entity_type, entity_id, billing_order, created_at, updated_at)
    SELECT p, 'movie', 1 + ((p * 7 + k) % ${OBRAS}), k, NOW(), NOW()
    FROM generate_series(1, ${PESSOAS}) p, generate_series(1, ${CREDITOS_POR_PESSOA}) k
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO crew_members (person_id, entity_type, entity_id, job, department, created_at, updated_at)
    SELECT p, 'movie', 1 + ((p * 7 + k) % ${OBRAS}), 'Director', 'Directing', NOW(), NOW()
    FROM generate_series(1, ${PESSOAS}) p, generate_series(1, 2) k
  `);
  // Series, temporadas e episodios: o outro portao que a mesma leva de
  // 22/09/2026 poe no indice, e que repetia a checagem da SERIE por LINHA.
  await prisma.$executeRawUnsafe(`
    INSERT INTO tv_shows (id, tmdb_id, name_original, updated_at, created_at)
    SELECT i, 700000 + i, 'Serie ' || i, NOW(), NOW() FROM generate_series(1, ${SERIES}) i
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, created_at, updated_at)
    SELECT 'tv', i, '${LANGUAGE}',
      CASE WHEN i % 4 = 0 THEN 'tmdb-s' || i ELSE 'serie-' || i END,
      true, NOW(), NOW()
    FROM generate_series(1, ${SERIES}) i
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO seasons (id, tv_show_id, season_number, overview, episode_count, updated_at, created_at)
    SELECT (i - 1) * ${TEMPORADAS_POR_SERIE} + k, i, k,
      CASE WHEN k % 2 = 0 THEN repeat('sinopse propria da temporada ', 4) ELSE NULL END,
      ${EPISODIOS_POR_TEMPORADA}, NOW(), NOW()
    FROM generate_series(1, ${SERIES}) i, generate_series(1, ${TEMPORADAS_POR_SERIE}) k
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO episodes (id, season_id, tv_show_id, episode_number, overview, still_path, updated_at, created_at)
    SELECT (se.id - 1) * ${EPISODIOS_POR_TEMPORADA} + n, se.id, se.tv_show_id, n,
      CASE WHEN n % 3 <> 0 THEN repeat('sinopse de verdade do episodio ', 3) ELSE NULL END,
      CASE WHEN n % 5 = 0 THEN NULL ELSE '/still' || se.id || '-' || n || '.jpg' END,
      NOW(), NOW()
    FROM seasons se, generate_series(1, ${EPISODIOS_POR_TEMPORADA}) n
  `);
  await prisma.$executeRawUnsafe("ANALYZE");
}

/** A fatia do cliente que este script usa — a mesma porta dos validadores. */
interface RawClient {
  $queryRawUnsafe: <T>(sql: string) => Promise<T>;
  $executeRawUnsafe: (sql: string) => Promise<number>;
}

interface Medida {
  readonly rotulo: string;
  readonly ms: number;
  readonly n: number;
  readonly amostra: readonly string[];
}

async function medir(
  prisma: RawClient,
  rotulo: string,
  sql: string,
): Promise<Medida> {
  const t0 = Date.now();
  const linhas = await prisma.$queryRawUnsafe<{ slug: string }[]>(sql);
  const ms = Date.now() - t0;
  const slugs = linhas.map((l) => l.slug).sort();
  return { rotulo, ms, n: slugs.length, amostra: slugs };
}

/** A consulta como ela estava ANTES: subconsulta correlacionada por pessoa. */
function sqlAntigo(): string {
  return `
    SELECT s.slug AS slug
    FROM slugs s JOIN people p ON p.id = s.entity_id
    WHERE s.entity_type = 'person' AND s.language_code = '${LANGUAGE}' AND s.is_canonical = true
      AND BTRIM(p.name) <> ''
      AND BTRIM(COALESCE(p.profile_path, '')) <> ''
      AND (
        SELECT COUNT(*) FROM (
          SELECT 1
          FROM (
            SELECT cm.entity_type, cm.entity_id FROM cast_members cm
            WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
            UNION
            SELECT rm.entity_type, rm.entity_id FROM crew_members rm
            WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')
          ) obra
          JOIN slugs ws ON ws.entity_type = obra.entity_type AND ws.entity_id = obra.entity_id
            AND ws.language_code = '${LANGUAGE}' AND ws.is_canonical = true
          LEFT JOIN movies wm ON obra.entity_type = 'movie' AND wm.id = obra.entity_id
          LEFT JOIN tv_shows wt ON obra.entity_type = 'tv' AND wt.id = obra.entity_id
          WHERE BTRIM(COALESCE(wm.title_original, wt.name_original, '')) <> ''
            AND NOT (
              ws.slug ~ '${TMDB_FALLBACK_SLUG_SQL_PATTERN}'
              AND NOT EXISTS (
                SELECT 1 FROM entity_translations et
                WHERE et.entity_type = obra.entity_type AND et.entity_id = obra.entity_id
                  AND et.language_code = ANY(ARRAY[${PUBLISHED_LOCALE_CODES.map((c) => `'${c}'`).join(",")}])
                  AND ((BTRIM(COALESCE(et.title, '')) <> ''
                        AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(wm.title_original, wt.name_original, '')))
                    OR BTRIM(COALESCE(et.summary, '')) <> ''
                    OR BTRIM(COALESCE(et.meta_description, '')) <> '')
              )
            )
            AND COALESCE((SELECT wd.decision::text FROM page_indexability_decisions wd
              WHERE wd.entity_type = obra.entity_type AND wd.entity_id = obra.entity_id
                AND wd.language_code = '${LANGUAGE}' AND wd.is_current = true
              LIMIT 1), 'index') = 'index'
          LIMIT ${MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY}
        ) obras_no_indice
      ) >= CASE
        WHEN BTRIM(COALESCE(p.biography, '')) <> ''
          AND p.biography_source_status::text IN ('official','licensed','third_party')
        THEN 1
        ELSE ${MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY}
      END
      AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
        WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id
          AND d.language_code = '${LANGUAGE}' AND d.is_current = true
        LIMIT 1), 'index') = 'index'`;
}

/** A consulta como ela ficou: CTEs materializadas, uma passada. */
function sqlNovo(): string {
  return `
    WITH obra_no_indice AS MATERIALIZED (
      SELECT ws.entity_type AS entity_type, ws.entity_id AS entity_id
      FROM slugs ws
      LEFT JOIN movies wm ON ws.entity_type = 'movie' AND wm.id = ws.entity_id
      LEFT JOIN tv_shows wt ON ws.entity_type = 'tv' AND wt.id = ws.entity_id
      WHERE ws.entity_type IN ('movie','tv')
        AND ws.language_code = '${LANGUAGE}' AND ws.is_canonical = true
        AND BTRIM(COALESCE(wm.title_original, wt.name_original, '')) <> ''
        AND NOT (
          ws.slug ~ '${TMDB_FALLBACK_SLUG_SQL_PATTERN}'
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = ws.entity_type AND et.entity_id = ws.entity_id
              AND et.language_code = ANY(ARRAY[${PUBLISHED_LOCALE_CODES.map((c) => `'${c}'`).join(",")}])
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(wm.title_original, wt.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT wd.decision::text FROM page_indexability_decisions wd
          WHERE wd.entity_type = ws.entity_type AND wd.entity_id = ws.entity_id
            AND wd.language_code = '${LANGUAGE}' AND wd.is_current = true
          LIMIT 1), 'index') = 'index'
    ),
    obras_por_pessoa AS MATERIALIZED (
      SELECT c.person_id AS person_id, COUNT(DISTINCT (c.entity_type, c.entity_id)) AS obras
      FROM (
        SELECT cm.person_id AS person_id, cm.entity_type AS entity_type, cm.entity_id AS entity_id
        FROM cast_members cm WHERE cm.entity_type IN ('movie','tv')
        UNION ALL
        SELECT rm.person_id AS person_id, rm.entity_type AS entity_type, rm.entity_id AS entity_id
        FROM crew_members rm WHERE rm.entity_type IN ('movie','tv')
      ) c
      -- Sem foto a pessoa nao passa no portao de qualquer jeito: contar a
      -- filmografia dela seria trabalho jogado fora. O filtro fica AQUI, e nao
      -- so no WHERE de fora, porque aqui ele corta ANTES da juncao de creditos.
      JOIN people pp ON pp.id = c.person_id AND BTRIM(COALESCE(pp.profile_path, '')) <> ''
      JOIN obra_no_indice o ON o.entity_type = c.entity_type AND o.entity_id = c.entity_id
      GROUP BY c.person_id
    )
    SELECT s.slug AS slug
    FROM slugs s JOIN people p ON p.id = s.entity_id
    LEFT JOIN obras_por_pessoa opp ON opp.person_id = p.id
    WHERE s.entity_type = 'person' AND s.language_code = '${LANGUAGE}' AND s.is_canonical = true
      AND BTRIM(p.name) <> ''
      AND BTRIM(COALESCE(p.profile_path, '')) <> ''
      AND COALESCE(opp.obras, 0) >= CASE
        WHEN BTRIM(COALESCE(p.biography, '')) <> ''
          AND p.biography_source_status::text IN ('official','licensed','third_party')
        THEN 1
        ELSE ${MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY}
      END
      AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
        WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id
          AND d.language_code = '${LANGUAGE}' AND d.is_current = true
        LIMIT 1), 'index') = 'index'`;
}
/** Episodio ANTES: a serie dona conferida em CADA linha de episodio. */
function sqlEpisodiosAntigo(): string {
  return `
    SELECT s.slug || '/' || se.season_number || '/' || e.episode_number AS slug
    FROM episodes e
    JOIN seasons se ON se.id = e.season_id
    JOIN tv_shows t ON t.id = e.tv_show_id
    JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
      AND s.language_code = '${LANGUAGE}' AND s.is_canonical = true
    WHERE BTRIM(t.name_original) <> ''
      AND NOT (
        s.slug ~ '${TMDB_FALLBACK_SLUG_SQL_PATTERN}'
        AND NOT EXISTS (
          SELECT 1 FROM entity_translations et
          WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
            AND et.language_code = ANY(ARRAY[${PUBLISHED_LOCALE_CODES.map((c) => `'${c}'`).join(",")}])
            AND ((BTRIM(COALESCE(et.title, '')) <> ''
                  AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
              OR BTRIM(COALESCE(et.summary, '')) <> ''
              OR BTRIM(COALESCE(et.meta_description, '')) <> '')
        )
      )
      AND COALESCE((SELECT sd.decision::text FROM page_indexability_decisions sd
        WHERE sd.entity_type = 'tv' AND sd.entity_id = s.entity_id
          AND sd.language_code = '${LANGUAGE}' AND sd.is_current = true
        LIMIT 1), 'index') = 'index'
      AND se.season_number >= 1 AND e.episode_number >= 1
      AND char_length(BTRIM(COALESCE(e.overview, ''), ' \t\r\n')) >= ${MIN_SYNOPSIS_CHARS}
      AND BTRIM(COALESCE(e.still_path, '')) <> ''
      AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
        WHERE d.entity_type = 'episode' AND d.entity_id = e.id
          AND d.language_code = '${LANGUAGE}' AND d.is_current = true
        LIMIT 1), 'index') = 'index'`;
}

/** Episodio DEPOIS: a serie dona conferida UMA vez, numa CTE materializada. */
function sqlEpisodiosNovo(): string {
  return `
    WITH serie_no_indice AS MATERIALIZED (
      SELECT s.entity_id AS tv_id, s.slug AS slug
      FROM slugs s JOIN tv_shows t ON t.id = s.entity_id
      WHERE s.entity_type = 'tv' AND s.language_code = '${LANGUAGE}' AND s.is_canonical = true
        AND BTRIM(t.name_original) <> ''
        AND NOT (
          s.slug ~ '${TMDB_FALLBACK_SLUG_SQL_PATTERN}'
          AND NOT EXISTS (
            SELECT 1 FROM entity_translations et
            WHERE et.entity_type = 'tv' AND et.entity_id = s.entity_id
              AND et.language_code = ANY(ARRAY[${PUBLISHED_LOCALE_CODES.map((c) => `'${c}'`).join(",")}])
              AND ((BTRIM(COALESCE(et.title, '')) <> ''
                    AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(t.name_original, '')))
                OR BTRIM(COALESCE(et.summary, '')) <> ''
                OR BTRIM(COALESCE(et.meta_description, '')) <> '')
          )
        )
        AND COALESCE((SELECT sd.decision::text FROM page_indexability_decisions sd
          WHERE sd.entity_type = 'tv' AND sd.entity_id = s.entity_id
            AND sd.language_code = '${LANGUAGE}' AND sd.is_current = true
          LIMIT 1), 'index') = 'index'
    )
    SELECT sni.slug || '/' || se.season_number || '/' || e.episode_number AS slug
    FROM episodes e
    JOIN seasons se ON se.id = e.season_id
    JOIN serie_no_indice sni ON sni.tv_id = e.tv_show_id
    WHERE true
      AND se.season_number >= 1 AND e.episode_number >= 1
      AND char_length(BTRIM(COALESCE(e.overview, ''), ' \t\r\n')) >= ${MIN_SYNOPSIS_CHARS}
      AND BTRIM(COALESCE(e.still_path, '')) <> ''
      AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
        WHERE d.entity_type = 'episode' AND d.entity_id = e.id
          AND d.language_code = '${LANGUAGE}' AND d.is_current = true
        LIMIT 1), 'index') = 'index'`;
}
async function executar(url: string): Promise<boolean> {
  process.env.DATABASE_URL = url;
  const dbServer = (await import("@screena/db/server")) as unknown as {
    getPrismaClient: () => RawClient;
    disconnectPrisma: () => Promise<void>;
  };
  const prisma = dbServer.getPrismaClient();
  try {
    process.stdout.write(
      `semeando ${OBRAS} obras, ${PESSOAS} pessoas e ~${PESSOAS * (CREDITOS_POR_PESSOA + 2)} creditos...\n`,
    );
    await semear(prisma);

    // Aquece: a primeira consulta paga o cache frio do banco, e essa diferenca
    // nao e a que se quer medir.
    await prisma.$queryRawUnsafe("SELECT 1");

    const antigo = await medir(prisma, "pessoa  ANTIGO", sqlAntigo());
    const novo = await medir(prisma, "pessoa  NOVO", sqlNovo());
    const epAntigo = await medir(prisma, "episodio ANTIGO", sqlEpisodiosAntigo());
    const epNovo = await medir(prisma, "episodio NOVO", sqlEpisodiosNovo());

    const mesmasPessoas =
      antigo.n === novo.n && antigo.amostra.every((s, i) => s === novo.amostra[i]);
    const mesmosEpisodios =
      epAntigo.n === epNovo.n && epAntigo.amostra.every((s, i) => s === epNovo.amostra[i]);

    console.log("");
    console.log("RESULTADO");
    console.log("─".repeat(60));
    for (const m of [antigo, novo, epAntigo, epNovo]) {
      console.log(`${m.rotulo.padEnd(26)} ${String(m.ms).padStart(7)} ms   ${m.n} pessoas`);
    }
    console.log("─".repeat(60));
    console.log(
      `ganho pessoa:  ${(antigo.ms / Math.max(novo.ms, 1)).toFixed(1)}x` +
        `   |   ganho episodio: ${(epAntigo.ms / Math.max(epNovo.ms, 1)).toFixed(1)}x`,
    );
    console.log(
      `mesmo conjunto de pessoas: ${mesmasPessoas ? "SIM" : "NAO — o resultado MUDOU"}`,
    );
    if (!mesmasPessoas) {
      const so = (a: readonly string[], b: readonly string[]) =>
        a.filter((x) => !b.includes(x)).slice(0, 5);
      console.log(`  so no antigo: ${so(antigo.amostra, novo.amostra).join(", ") || "-"}`);
      console.log(`  so no novo:   ${so(novo.amostra, antigo.amostra).join(", ") || "-"}`);
    }
    // O portao tem de estar BARRANDO alguem: um portao que aprova todo mundo
    // seria rapido nas duas versoes e nao provaria nada.
    const barrou = antigo.n > 0 && antigo.n < PESSOAS;
    console.log(`portao barra alguem (nao e vacuo): ${barrou ? "SIM" : "NAO"} (${antigo.n}/${PESSOAS})`);
    console.log(
      `mesmo conjunto de episodios: ${mesmosEpisodios ? "SIM" : "NAO — o resultado MUDOU"}`,
    );
    const barrouEp = epAntigo.n > 0;
    return (
      mesmasPessoas && mesmosEpisodios && barrou && barrouEp &&
      novo.ms < antigo.ms && epNovo.ms < epAntigo.ms
    );
  } finally {
    await dbServer.disconnectPrisma();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-bench-pessoa-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_bench`;
  let started = false;
  let ok = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_bench");
    // `runChild`, e nunca um filho SINCRONO: com o embedded-postgres de pe, o
    // log do filho enche o pipe e o processo trava sem erro nenhum.
    await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", SCHEMA], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
      cwd: DB_DIR,
    });
    ok = await executar(url);
  } finally {
    if (started) {
      try {
        await pg.stop();
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  process.exitCode = ok ? 0 : 1;
}

await main();
