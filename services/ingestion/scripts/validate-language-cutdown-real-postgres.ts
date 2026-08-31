/**
 * validate-language-cutdown-real-postgres.ts — O RECORTE DE IDIOMA, provado
 * contra PostgreSQL 16 efemero com o schema de producao.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nunca roda em render/build/prod.
 * ZERO rede, ZERO TMDB, ZERO Gemini.
 *
 * ============================================================================
 * O QUE SO UM BANCO REAL PROVA
 * ============================================================================
 * O formato previsivel de fracasso desta leva, escrito no proprio prompt, e
 * "reportar N linhas apagadas sem verificar que a cascata levou o que devia e
 * SO o que devia". Nenhum fake reproduz:
 *
 *   1. que `languages` ACEITA o vocabulario ISO 639-1 inteiro — a FK
 *      `movies.original_language -> languages.code` e o que descartava o idioma
 *      real de 41.505 titulos, e so o banco diz se ela agora passa;
 *   2. que o backfill ACHA o payload guardado. A consulta casa `api_cache` por
 *      `endpoint` e atravessa `jsonb`; nenhum fake reproduz isso;
 *   3. que a CASCATA e a que o banco tem, nao a que o schema.prisma sugere —
 *      lida de `pg_constraint`;
 *   4. que as 25 tabelas POLIMORFICAS somem para o titulo apagado e ficam
 *      INTACTAS para o titulo que fica. Este e o "so o que devia";
 *   5. que a pessoa que perdeu TODOS os creditos some e a que perdeu ALGUNS
 *      fica;
 *   6. que a porta (Parte C) impede o titulo apagado de voltar amanha;
 *   7. que o intertravamento RECUSA apagar enquanto houver idioma nulo — e que
 *      o predicado, mesmo forcado, nunca mira uma linha NULA.
 *
 * Uso: pnpm --filter @screena/ingestion validate:language-cutdown
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

import { LANGUAGE_VOCABULARY } from '@screena/db'
import { CATALOG_LANGUAGE_ALLOWLIST_DEFAULT } from '@screena/config'

import { backfillOriginalLanguage } from '../src/persistence/language-backfill.js'
import {
  describeDeleteCascade,
  measureCatalogByLanguage,
  planLanguageCutdown,
  runLanguageCutdown,
  POLYMORPHIC_TITLE_TABLES,
  POLYMORPHIC_TABLES_DELIBERATELY_EXCLUDED,
} from '../src/persistence/language-cutdown.js'
import { createPrismaStore } from '../src/persistence/store.js'
import { createCatalogAdmissionPolicy } from '../src/persistence/admission.js'
import { isUpsertRefused } from '../src/ports.js'
import type { StoreMovieInput } from '../src/ports.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const ingestionDir = path.resolve(scriptDir, '..')
const dbDir = path.resolve(ingestionDir, '..', '..', 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

const RECORTE = CATALOG_LANGUAGE_ALLOWLIST_DEFAULT

let passed = 0
let total = 0
function record(name: string, ok: boolean, detail: string): void {
  total += 1
  if (ok) passed += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${total}. ${name} — ${detail}`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  if (rel === undefined) throw new Error('binario do prisma nao encontrado')
  return path.join(path.dirname(pkgPath), rel)
}

/**
 * Escape hatch para cluster JA de pe em loopback. No checkout acentuado o
 * `initdb --encoding=UTF8` morre, e este e o caminho que funciona.
 *
 * Variavel PROPRIA, nunca `DATABASE_URL` — o `.env` deste checkout aponta para
 * PRODUCAO, e este validador INSERE e APAGA.
 */
function externalDatabaseUrl(): string | null {
  const raw = process.env.CINERIE_VALIDATOR_DATABASE_URL
  if (raw === undefined || raw.trim().length === 0) return null
  const host = new URL(raw).hostname
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `CINERIE_VALIDATOR_DATABASE_URL precisa apontar para loopback (recebeu host "${host}"). ` +
        'Este validador APAGA e INSERE dados; ele nunca fala com banco remoto.',
    )
  }
  return raw
}

async function escalar(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql)
  return Number(rows[0]?.n ?? 0)
}

/**
 * FIXTURE. Estado deliberadamente igual ao de producao em 2026-08-31: parte dos
 * titulos com `original_language` NULO por causa do defeito, e o idioma real
 * dormindo em `api_cache`/`tmdb_raw`.
 *
 *   movie 101 (tmdb 90101) 'pt' JA na coluna       FICA · oferta BR + sinopse pt
 *   movie 102 (tmdb 90102) 'en' JA na coluna       FICA
 *   movie 103 (tmdb 90103) NULO -> 'ja' via cache  FICA  <- o perigo da ordem
 *   movie 104 (tmdb 90104) 'te' JA na coluna       SAI  · oferta BR (colateral)
 *   movie 105 (tmdb 90105) 'ru' JA na coluna       SAI
 *   movie 106 (tmdb 90106) NULO -> 'ko' via raw    FICA  <- o perigo da ordem
 *   tv    301 (tmdb 90301) 'ml' JA na coluna       SAI  · 2 temporadas, 3 eps
 *   tv    302 (tmdb 90302) 'es' JA na coluna       FICA · 1 temporada, 1 ep
 *   person 201 credito SO no 104                   vira ORFA
 *   person 202 creditos no 101 e no 104            SOBREVIVE
 */
async function semear(prisma: PrismaClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql)
  const json = (v: unknown) => JSON.stringify(v).replace(/'/g, "''")

  // O VOCABULARIO INTEIRO. Se a FK nao aceitasse `te`/`ml`/`ja`, o backfill nao
  // teria onde gravar — e era exatamente esse o defeito.
  const valores = LANGUAGE_VOCABULARY.map(
    (l) =>
      `('${l.code}','${l.namePt.replace(/'/g, "''")}','${l.nameEn.replace(/'/g, "''")}',false,false)`,
  ).join(',')
  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true)
             ON CONFLICT (code) DO NOTHING`)
  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ${valores} ON CONFLICT (code) DO NOTHING`)
  await run(`INSERT INTO countries (code, name_pt, name_en)
             VALUES ('BR','Brasil','Brazil') ON CONFLICT (code) DO NOTHING`)
  await run(`INSERT INTO api_providers (key, name, kind)
             VALUES ('tmdb','TMDB','data') ON CONFLICT (key) DO NOTHING`)
  await run(`INSERT INTO api_providers (key, name, kind)
             VALUES ('omdb','OMDb','data') ON CONFLICT (key) DO NOTHING`)
  await run(`INSERT INTO rating_sources (key, label, scale, homepage_url)
             VALUES ('imdb','IMDb',10,'https://www.imdb.com') ON CONFLICT (key) DO NOTHING`)

  await run(`INSERT INTO movies (id, tmdb_id, title_original, original_language, popularity, updated_at) VALUES
             (101, 90101, 'Filme Brasileiro',  'pt',  50.0, now()),
             (102, 90102, 'English Movie',     'en',  40.0, now()),
             (103, 90103, 'Japanese Movie',    NULL,  30.0, now()),
             (104, 90104, 'Telugu Movie',      'te',  20.0, now()),
             (105, 90105, 'Russian Movie',     'ru',  10.0, now()),
             (106, 90106, 'Korean Movie',      NULL,   5.0, now())`)
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, original_language, popularity, updated_at) VALUES
             (301, 90301, 'Malayalam Show', 'ml', 25.0, now()),
             (302, 90302, 'Spanish Show',   'es', 35.0, now())`)
  await run(`INSERT INTO seasons (id, tv_show_id, season_number, name, updated_at) VALUES
             (401, 301, 1, 'T1', now()), (402, 301, 2, 'T2', now()), (403, 302, 1, 'T1', now())`)
  await run(`INSERT INTO episodes (id, season_id, tv_show_id, episode_number, name, updated_at) VALUES
             (501, 401, 301, 1, 'E1', now()), (502, 401, 301, 2, 'E2', now()),
             (503, 402, 301, 1, 'E1', now()), (504, 403, 302, 1, 'E1', now())`)
  await run(`INSERT INTO people (id, tmdb_id, name, updated_at) VALUES
             (201, 90201, 'So No Telugo', now()), (202, 90202, 'Nos Dois', now())`)
  await run(`INSERT INTO cast_members (entity_type, entity_id, person_id, billing_order, character, updated_at) VALUES
             ('movie', 104, 201, 1, 'A', now()),
             ('movie', 104, 202, 2, 'B', now()),
             ('movie', 101, 202, 1, 'C', now())`)

  await run(`SELECT setval(pg_get_serial_sequence('movies','id'), 1000)`)
  await run(`SELECT setval(pg_get_serial_sequence('tv_shows','id'), 1000)`)

  // POLIMORFICAS — as que nao cascateiam. Uma linha para um titulo que SAI
  // (104 / tv 301) e uma para um que FICA (101 / tv 302), sempre em par: e o
  // par que permite provar "levou o que devia E SO o que devia".
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'filme-brasileiro', true, now()),
             ('movie', 104, 'pt-BR', 'filme-telugo', true, now()),
             ('tv', 301, 'pt-BR', 'serie-malaiala', true, now()),
             ('tv', 302, 'pt-BR', 'serie-espanhola', true, now())`)
  await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'Filme Brasileiro', 'Sinopse em portugues.', now()),
             ('movie', 104, 'pt-BR', 'Filme Telugo', 'Sinopse em portugues do filme telugo.', now()),
             ('tv', 301, 'pt-BR', 'Serie Malaiala', NULL, now()),
             ('tv', 302, 'pt-BR', 'Serie Espanhola', 'Sinopse.', now())`)
  // `entities` e mantida por TRIGGER (`*_entity_registry_ins/del` da migration
  // 20260715120000), entao as linhas ja existem. O ON CONFLICT esta aqui para
  // documentar isso, nao para mascarar: a prova de que o trigger tambem LIMPA
  // no delete e um check proprio, mais abaixo.
  await run(`INSERT INTO entities (entity_type, entity_id) VALUES
             ('movie', 101), ('movie', 104), ('tv', 301), ('tv', 302)
             ON CONFLICT (entity_type, entity_id) DO NOTHING`)
  await run(`INSERT INTO watch_availability
               (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES
             ('movie', 101, 'BR', 'Netflix', 'subscription', now()),
             ('movie', 104, 'BR', 'Prime Video', 'subscription', now()),
             ('movie', 104, 'BR', 'Netflix', 'subscription', now())`)
  await run(`INSERT INTO external_ratings
               (entity_type, entity_id, rating_source, rating_label, metric,
                rating_value, rating_scale, provider_api, updated_at) VALUES
             ('movie', 101, 'imdb', 'IMDb Rating', 'user_rating', 8.1, 10, 'omdb', now()),
             ('movie', 104, 'imdb', 'IMDb Rating', 'user_rating', 7.2, 10, 'omdb', now())`)
  await run(`INSERT INTO search_documents
               (entity_type, entity_id, locale, primary_text, normalized_text, canonical_url, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'Filme Brasileiro', 'filme brasileiro', '/pt/filmes/filme-brasileiro/', now()),
             ('movie', 104, 'pt-BR', 'Filme Telugo', 'filme telugo', '/pt/filmes/filme-telugo/', now())`)
  await run(`INSERT INTO page_indexability_decisions
               (entity_type, entity_id, language_code, url, decision) VALUES
             ('movie', 101, 'pt-BR', '/pt/filmes/filme-brasileiro/', 'index'),
             ('movie', 104, 'pt-BR', '/pt/filmes/filme-telugo/', 'index')`)
  // `status='calculated'` exige value/scale/explanation pelo CHECK
  // `cinerie_score_calculations_status_shape`.
  await run(`INSERT INTO cinerie_score_calculations
               (entity_type, entity_id, status, value, scale, explanation, version, inputs_hash, calculated_at) VALUES
             ('movie', 101, 'calculated', 84, 100, '{"pt":"ok"}'::jsonb, 'v1', 'h1', now()),
             ('movie', 104, 'calculated', 72, 100, '{"pt":"ok"}'::jsonb, 'v1', 'h2', now())`)

  // CHAVEADAS POR TMDB ID — o erro classico e usar o id interno aqui.
  await run(`INSERT INTO tmdb_images (entity_type, tmdb_id, image_type, file_path, payload_hash, updated_at) VALUES
             ('movie', 90101, 'poster', '/a.jpg', 'h', now()),
             ('movie', 90104, 'poster', '/b.jpg', 'h', now())`)
  await run(`INSERT INTO tmdb_videos
               (entity_type, tmdb_id, tmdb_video_id, site, video_key, payload_hash, updated_at) VALUES
             ('movie', 90101, 'v1', 'YouTube', 'k1', 'h', now()),
             ('movie', 90104, 'v2', 'YouTube', 'k2', 'h', now())`)
  await run(`INSERT INTO title_recommendations
               (source_media_type, source_tmdb_id, kind, target_media_type, target_tmdb_id, position) VALUES
             ('movie', 90101, 'recommendation', 'movie', 90102, 1),
             ('movie', 90104, 'recommendation', 'movie', 90105, 1)`)

  // PAYLOAD GUARDADO — o idioma que o backfill vai recuperar.
  const cache = (endpoint: string, payload: unknown, chave: string) =>
    run(`INSERT INTO api_cache (provider_api, endpoint, request_key, params_hash, payload, payload_hash, fetched_at)
         VALUES ('tmdb', '${endpoint}', '${endpoint}?append_to_response=credits',
                 '${chave}', '${json(payload)}'::jsonb, '${chave}', now())`)

  await cache('/movie/90101', { id: 90101, original_language: 'pt' }, 'c101')
  await cache('/movie/90103', { id: 90103, original_language: 'ja' }, 'c103')
  await cache('/movie/90104', { id: 90104, original_language: 'te' }, 'c104')
  await cache('/movie/90105', { id: 90105, original_language: 'ru' }, 'c105')
  await cache('/tv/90301', { id: 90301, original_language: 'ml' }, 'c301')
  // 106 SO em `tmdb_raw` — prova a segunda origem de payload.
  await run(`INSERT INTO tmdb_raw (entity_type, tmdb_id, base_language, payload, payload_hash, fetched_at, updated_at)
             VALUES ('movie', 90106, 'pt-BR', '${json({ id: 90106, original_language: 'ko' })}'::jsonb, 'r106', now(), now())`)
}

function movieInput(tmdbId: number, originalLanguage: string | null): StoreMovieInput {
  return {
    movie: {
      tmdbId,
      imdbId: null,
      titleOriginal: 'Novo Telugo',
      originalLanguage,
      releaseDate: null,
      runtimeMinutes: null,
      status: null,
      popularity: null,
      voteAverageTmdb: null,
      voteCountTmdb: null,
      posterPath: null,
      backdropPath: null,
      certification: null,
      budget: null,
      releaseDateBr: null,
    },
    externalIds: [],
    cast: [],
    crew: [],
    castPresent: false,
    crewPresent: false,
    recommendations: [],
    recommendationsPresent: false,
    genres: [],
    genresPresent: false,
    countries: [],
    countriesPresent: false,
    timestamps: { lastSyncedAt: new Date(), staleAfter: null },
  } as unknown as StoreMovieInput
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await semear(prisma)

    // ---------------------------------------------------------------- A
    const idiomas = await escalar(prisma, `SELECT COUNT(*) AS n FROM languages`)
    record(
      'A.2 — `languages` aceita o vocabulario ISO 639-1 inteiro',
      idiomas >= LANGUAGE_VOCABULARY.length,
      `${idiomas} linhas (vocabulario tem ${LANGUAGE_VOCABULARY.length})`,
    )

    const nulosAntes = await escalar(
      prisma,
      `SELECT (SELECT COUNT(*) FROM movies WHERE original_language IS NULL)
            + (SELECT COUNT(*) FROM tv_shows WHERE original_language IS NULL) AS n`,
    )
    record(
      'estado inicial reproduz o defeito: titulos com idioma NULO',
      nulosAntes === 2,
      `${nulosAntes} titulos nulos (103=japones, 106=coreano — DOIS dos que FICAM)`,
    )

    // O PERIGO DA ORDEM, medido: antes do backfill, o japones e indistinguivel
    // do telugo na coluna. Os dois sao NULL.
    const japonesIndistinguivel = await escalar(
      prisma,
      `SELECT COUNT(*) AS n FROM movies WHERE id IN (103, 106) AND original_language IS NULL`,
    )
    record(
      'PERIGO DA ORDEM: japones e coreano estao gravados como os que saem (NULL)',
      japonesIndistinguivel === 2,
      'nenhuma consulta por idioma consegue separa-los antes do backfill',
    )

    // ---- INTERTRAVAMENTO: o apply RECUSA enquanto houver nulo
    const recusado = await runLanguageCutdown(prisma, { allowlist: RECORTE, dryRun: false })
    const filmesAposRecusa = await escalar(prisma, `SELECT COUNT(*) AS n FROM movies`)
    record(
      'D — o `--apply` RECUSA enquanto houver idioma nulo, e nao apaga nada',
      recusado.refused !== null && filmesAposRecusa === 6,
      `${recusado.refused?.slice(0, 80) ?? 'NAO RECUSOU'} · filmes intactos: ${filmesAposRecusa}`,
    )

    // ---- e o predicado, mesmo FORCADO, nunca mira uma linha nula
    const forcado = await planLanguageCutdown(prisma, RECORTE)
    record(
      'FAIL-SAFE: o predicado de apagamento NUNCA mira `original_language IS NULL`',
      forcado.targets.movie === 2,
      `alvos=movie:${forcado.targets.movie} (104 te, 105 ru) — 103 e 106 (NULOS) fora`,
    )

    // ---------------------------------------------------------------- A.3/A.4
    const seco = await backfillOriginalLanguage(prisma, { dryRun: true })
    record(
      'A.3 — o dry-run do backfill NAO grava e nao chama o TMDB',
      seco.written === 0 && seco.externalCallsMade === 0,
      `recuperaveis=${seco.recovered} · gravados=${seco.written} · chamadas=${seco.externalCallsMade}`,
    )

    const backfill = await backfillOriginalLanguage(prisma, { dryRun: false })
    record(
      'A.3 — o backfill recupera o idioma do payload JA guardado',
      backfill.written === 2 && backfill.externalCallsMade === 0,
      `gravados=${backfill.written} · idiomas=${JSON.stringify(backfill.byLanguage)} · chamadas=${backfill.externalCallsMade}`,
    )
    record(
      'A.3 — le as DUAS origens: api_cache e tmdb_raw',
      backfill.byPayloadSource.api_cache === 1 && backfill.byPayloadSource.tmdb_raw === 1,
      `api_cache=${backfill.byPayloadSource.api_cache} · tmdb_raw=${backfill.byPayloadSource.tmdb_raw}`,
    )

    const [{ ja, ko }] = await prisma.$queryRawUnsafe<{ ja: string | null; ko: string | null }[]>(
      `SELECT (SELECT original_language FROM movies WHERE id = 103) AS ja,
              (SELECT original_language FROM movies WHERE id = 106) AS ko`,
    )
    record(
      'A.5 — o japones grava `ja` e o coreano grava `ko` (era NULL nos dois)',
      ja === 'ja' && ko === 'ko',
      `103 -> ${String(ja)} · 106 -> ${String(ko)}`,
    )

    const nulosDepois = await escalar(
      prisma,
      `SELECT (SELECT COUNT(*) FROM movies WHERE original_language IS NULL)
            + (SELECT COUNT(*) FROM tv_shows WHERE original_language IS NULL) AS n`,
    )
    record(
      'A.4 — nenhum titulo continua com idioma nulo',
      nulosDepois === 0,
      `nulos=${nulosDepois}`,
    )

    const segunda = await backfillOriginalLanguage(prisma, { dryRun: false })
    record(
      'A.3 — a SEGUNDA execucao grava zero (idempotente)',
      segunda.written === 0 && segunda.candidates === 0,
      `candidatos=${segunda.candidates} · gravados=${segunda.written}`,
    )

    // ---------------------------------------------------------------- B
    const censo = await measureCatalogByLanguage(prisma, RECORTE)
    const porIdioma = Object.fromEntries(
      censo.rows.map((r) => [
        r.language ?? 'null',
        { fica: r.kept, filmes: r.movies, series: r.tvShows },
      ]),
    )
    record(
      'B.1 — o censo separa FICA de SAI por idioma',
      porIdioma.pt?.fica === true &&
        porIdioma.ja?.fica === true &&
        porIdioma.ko?.fica === true &&
        porIdioma.te?.fica === false &&
        porIdioma.ru?.fica === false &&
        porIdioma.ml?.fica === false,
      JSON.stringify(porIdioma),
    )
    record(
      'B.2 — o total que SAI ja inclui a cascata de temporada e episodio',
      censo.leaving.movies === 2 &&
        censo.leaving.tvShows === 1 &&
        censo.leaving.seasons === 2 &&
        censo.leaving.episodes === 3,
      `filmes=${censo.leaving.movies} series=${censo.leaving.tvShows} temporadas=${censo.leaving.seasons} episodios=${censo.leaving.episodes}`,
    )
    record(
      'B.2 — e o que FICA e contado separado (nulo nao entra em nenhum dos dois)',
      censo.staying.movies === 4 && censo.staying.tvShows === 1 && censo.nullLanguageTitles === 0,
      `fica: filmes=${censo.staying.movies} series=${censo.staying.tvShows} · nulos=${censo.nullLanguageTitles}`,
    )
    const colateral = censo.collateral
    record(
      'B.3 — o titulo que SAI e tem oferta no Brasil aparece, com o provedor',
      colateral.total === 1 &&
        colateral.withBrOffer === 1 &&
        colateral.topByPopularity[0]?.tmdbId === 90104 &&
        colateral.topByPopularity[0]?.brProviders.includes('Netflix'),
      `total=${colateral.total} · top=${colateral.topByPopularity[0]?.title} [${colateral.topByPopularity[0]?.language}] BR=${colateral.topByPopularity[0]?.brProviders.join(',')}`,
    )

    // ---------------------------------------------------------------- D.2
    const cascata = await describeDeleteCascade(prisma)
    const seasonsCascade = cascata.find(
      (e) => e.childTable === 'seasons' && e.parentTable === 'tv_shows',
    )
    const restrict = cascata.filter((e) => e.onDelete === 'restrict')
    record(
      'D.2 — a cascata e LIDA de pg_constraint: seasons <- tv_shows e CASCADE',
      seasonsCascade?.onDelete === 'cascade',
      `${cascata.length} FKs apontam para movies/tv_shows/seasons/episodes/people`,
    )
    record(
      'D.2 — e o ON DELETE RESTRICT que BLOQUEARIA o delete aparece nomeado',
      restrict.some((e) => e.childTable === 'user_episode_progress'),
      restrict.map((e) => `${e.childTable}->${e.parentTable}`).join(', ') || 'nenhum',
    )

    // As polimorficas nao tem FK para movies/tv_shows...
    const polimorficasComFk = cascata.filter((e) => POLYMORPHIC_TITLE_TABLES.includes(e.childTable))
    record(
      'D.2 — nenhuma polimorfica cascateia a partir do TITULO',
      polimorficasComFk.filter((e) => e.parentTable !== 'people').length === 0,
      `com FK para titulo: ${polimorficasComFk.filter((e) => e.parentTable !== 'people').length}`,
    )

    // ...MAS ELAS NAO SAO SEM FK. Apontam para `entities`, tabela-REGISTRO
    // mantida por TRIGGER, com ON DELETE RESTRICT. Este check existe porque a
    // primeira versao deste modulo apagava `entities` junto com as outras e o
    // DELETE ABORTAVA — descoberto aqui, nao em producao.
    const paraEntities = await prisma.$queryRawUnsafe<{ child_table: string; on_delete: string }[]>(
      `SELECT c.conrelid::regclass::text AS child_table,
              CASE c.confdeltype WHEN 'c' THEN 'cascade' WHEN 'r' THEN 'restrict'
                                 WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default'
                                 ELSE 'no action' END AS on_delete
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid::regclass::text = 'entities'
        ORDER BY 1`,
    )
    const restringemEntities = paraEntities.filter((e) => e.on_delete === 'restrict')
    record(
      'D.2 — as polimorficas apontam para `entities` com ON DELETE RESTRICT',
      restringemEntities.length > 0,
      `${restringemEntities.length} de ${paraEntities.length} FKs para entities sao RESTRICT`,
    )
    const restritasNaoLimpas = restringemEntities
      .map((e) => e.child_table)
      .filter((t) => !POLYMORPHIC_TITLE_TABLES.includes(t))
    record(
      'D.2 — TODAS as que restringem sao limpas antes do titulo (senao o DELETE ABORTA)',
      restritasNaoLimpas.length === 0,
      restritasNaoLimpas.length === 0
        ? `${restringemEntities.length} tabelas cobertas`
        : `NAO limpas: ${restritasNaoLimpas.join(', ')}`,
    )
    record(
      'D.2 — `entities` NAO e apagada a mao (o trigger e o dono dela)',
      !POLYMORPHIC_TITLE_TABLES.includes('entities') &&
        POLYMORPHIC_TABLES_DELIBERATELY_EXCLUDED.includes('entities'),
      'fora da lista de apagamento, dentro da lista de exclusao documentada',
    )

    // COBERTURA: uma tabela polimorfica que ninguem listou vira orfa silenciosa.
    const noBanco = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT c.table_name FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.column_name = 'entity_id'
          AND EXISTS (SELECT 1 FROM information_schema.columns c2
                       WHERE c2.table_schema = 'public' AND c2.table_name = c.table_name
                         AND c2.column_name = 'entity_type')
        ORDER BY 1`,
    )
    // Toda polimorfica do banco tem de estar OU na lista de apagamento OU na de
    // exclusao DOCUMENTADA. Uma que nao esteja em nenhuma das duas e omissao.
    const faltando = noBanco
      .map((r) => r.table_name)
      .filter(
        (t) =>
          !POLYMORPHIC_TITLE_TABLES.includes(t) &&
          !POLYMORPHIC_TABLES_DELIBERATELY_EXCLUDED.includes(t),
      )
    record(
      'D.2 — a lista de polimorficas COBRE o banco (nenhuma orfa silenciosa)',
      faltando.length === 0,
      faltando.length === 0
        ? `${noBanco.length} tabelas: ${POLYMORPHIC_TITLE_TABLES.length} apagadas, ${POLYMORPHIC_TABLES_DELIBERATELY_EXCLUDED.length} excluidas com motivo`
        : `NAO cobertas: ${faltando.join(', ')}`,
    )

    // ---------------------------------------------------------------- D.3
    const plano = await planLanguageCutdown(prisma, RECORTE)
    record(
      'D.3 — o dry-run conta linha por tabela, incluindo as orfas',
      plano.rowsByTable.slugs === 2 &&
        plano.rowsByTable.watch_availability === 2 &&
        plano.rowsByTable.episodes === 3 &&
        plano.orphanPeople === 1,
      `slugs=${plano.rowsByTable.slugs} watch=${plano.rowsByTable.watch_availability} eps=${plano.rowsByTable.episodes} orfas=${plano.orphanPeople}`,
    )
    record(
      'D.3 — e conta o deposito bruto (api_cache/tmdb_raw), que e onde ha disco',
      plano.apiCacheRows === 3 && plano.tmdbRawRows === 0,
      `api_cache=${plano.apiCacheRows} (90104, 90105, 90301) · tmdb_raw=${plano.tmdbRawRows}`,
    )

    // ---------------------------------------------------------------- D.4
    let lotes = 0
    const apagado = await runLanguageCutdown(prisma, {
      allowlist: RECORTE,
      dryRun: false,
      batchSize: 1,
      onBatch: () => {
        lotes += 1
      },
    })
    record(
      'D.4 — apagou em LOTES (uma transacao por lote), nao numa transacao so',
      apagado.batches >= 3 && lotes === apagado.batches,
      `lotes=${apagado.batches} (batchSize=1, 3 titulos alvo)`,
    )
    record(
      'D.4 — apagou os titulos certos',
      apagado.deletedTitles.movie === 2 && apagado.deletedTitles.tv === 1,
      `filmes=${apagado.deletedTitles.movie} series=${apagado.deletedTitles.tv}`,
    )

    const sobrou = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `SELECT id FROM movies ORDER BY id`,
    )
    const idsSobrando = sobrou.map((r) => Number(r.id))
    record(
      'D.4 — e SO os certos: os quatro que ficam continuam la',
      JSON.stringify(idsSobrando) === JSON.stringify([101, 102, 103, 106]),
      `movies restantes: ${idsSobrando.join(', ')} (103 japones e 106 coreano SOBREVIVERAM)`,
    )

    // A CASCATA levou o que devia — e so o que devia
    const temporadas = await escalar(prisma, `SELECT COUNT(*) AS n FROM seasons`)
    const episodios = await escalar(prisma, `SELECT COUNT(*) AS n FROM episodes`)
    record(
      'D.4 — a cascata levou temporada e episodio da serie apagada, e SO dela',
      temporadas === 1 && episodios === 1,
      `sobraram: temporadas=${temporadas} episodios=${episodios} (todos da serie 302, que fica)`,
    )

    // AS ORFAS: sumiram para quem saiu, INTACTAS para quem ficou
    const orfas: string[] = []
    const intactas: string[] = []
    for (const [tabela, idSai, idFica, tipo] of [
      ['slugs', 104, 101, 'movie'],
      ['entity_translations', 104, 101, 'movie'],
      ['watch_availability', 104, 101, 'movie'],
      ['external_ratings', 104, 101, 'movie'],
      ['search_documents', 104, 101, 'movie'],
      ['page_indexability_decisions', 104, 101, 'movie'],
      ['cinerie_score_calculations', 104, 101, 'movie'],
    ] as const) {
      const restouSaindo = await escalar(
        prisma,
        `SELECT COUNT(*) AS n FROM ${tabela} WHERE entity_type = '${tipo}'::"EntityType" AND entity_id = ${idSai}`,
      )
      const restouFicando = await escalar(
        prisma,
        `SELECT COUNT(*) AS n FROM ${tabela} WHERE entity_type = '${tipo}'::"EntityType" AND entity_id = ${idFica}`,
      )
      if (restouSaindo !== 0) orfas.push(`${tabela}=${restouSaindo}`)
      if (restouFicando === 0) intactas.push(tabela)
    }
    record(
      'D.4 — nenhuma ORFA sobrou (slug, traducao, oferta, nota, busca, decisao...)',
      orfas.length === 0,
      orfas.length === 0 ? 'as 8 tabelas conferidas ficaram limpas' : `sobrou: ${orfas.join(', ')}`,
    )
    record(
      'D.4 — e o titulo que FICA nao perdeu nada (o "so o que devia")',
      intactas.length === 0,
      intactas.length === 0
        ? 'as 8 linhas do filme 101 continuam la'
        : `PERDEU: ${intactas.join(', ')}`,
    )

    // `entities` NAO esta na lista manual: quem a limpa e o trigger AFTER DELETE.
    // Este check prova que ele realmente roda — inclusive para as temporadas e
    // episodios que sumiram pela cascata, que a lista manual nunca tocou.
    const entSai = await escalar(
      prisma,
      `SELECT COUNT(*) AS n FROM entities WHERE (entity_type, entity_id) IN
         (('movie',104),('movie',105),('tv',301),('season',401),('season',402),
          ('episode',501),('episode',502),('episode',503))`,
    )
    const entFica = await escalar(
      prisma,
      `SELECT COUNT(*) AS n FROM entities WHERE (entity_type, entity_id) IN
         (('movie',101),('tv',302),('season',403),('episode',504))`,
    )
    record(
      'D.2 — o TRIGGER limpou `entities`, inclusive de temporada/episodio em cascata',
      entSai === 0 && entFica === 4,
      `apagadas restantes=${entSai} · das que ficam=${entFica}/4`,
    )

    const imgSai = await escalar(
      prisma,
      `SELECT COUNT(*) AS n FROM tmdb_images WHERE tmdb_id = 90104`,
    )
    const imgFica = await escalar(
      prisma,
      `SELECT COUNT(*) AS n FROM tmdb_images WHERE tmdb_id = 90101`,
    )
    record(
      'D.4 — tmdb_images/videos apagados pelo TMDB ID, nao pelo id interno',
      imgSai === 0 && imgFica === 1,
      `90104 (saiu) -> ${imgSai} · 90101 (ficou) -> ${imgFica}`,
    )

    // D.5 — orfandade
    const pessoas = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `SELECT id FROM people ORDER BY id`,
    )
    record(
      'D.5 — a pessoa que perdeu TODOS os creditos sumiu; a que perdeu ALGUNS ficou',
      apagado.orphanPeopleDeleted === 1 && pessoas.length === 1 && Number(pessoas[0]?.id) === 202,
      `apagadas=${apagado.orphanPeopleDeleted} · restou people#${pessoas.map((p) => p.id).join(',')}`,
    )

    // D.6 — deposito bruto
    const cacheSai = await escalar(
      prisma,
      `SELECT COUNT(*) AS n FROM api_cache WHERE endpoint IN ('/movie/90104','/movie/90105','/tv/90301')`,
    )
    const cacheFica = await escalar(
      prisma,
      `SELECT COUNT(*) AS n FROM api_cache WHERE endpoint = '/movie/90101'`,
    )
    record(
      'D.6 — `api_cache` do titulo removido apagado; o do titulo que fica intacto',
      cacheSai === 0 && cacheFica === 1 && apagado.apiCacheDeleted === 3,
      `apagadas=${apagado.apiCacheDeleted} · restou do 90104/90105/90301=${cacheSai} · do 90101=${cacheFica}`,
    )

    // ---------------------------------------------------------------- C
    const store = createPrismaStore(prisma, createCatalogAdmissionPolicy(RECORTE))
    const tentativa = await store.upsertMovie(movieInput(90104, 'te'))
    const voltou = await escalar(prisma, `SELECT COUNT(*) AS n FROM movies WHERE tmdb_id = 90104`)
    record(
      'C — a PORTA impede o titulo apagado de voltar amanha pela ingestao',
      isUpsertRefused(tentativa) && voltou === 0,
      `recusa=${isUpsertRefused(tentativa) ? JSON.stringify(tentativa.refused) : 'NAO RECUSOU'} · linhas=${voltou}`,
    )
    const permitido = await store.upsertMovie(movieInput(90999, 'ja'))
    const entrou = await escalar(prisma, `SELECT COUNT(*) AS n FROM movies WHERE tmdb_id = 90999`)
    record(
      'C — CONTROLE POSITIVO: um titulo japones novo ENTRA normalmente',
      !isUpsertRefused(permitido) && entrou === 1,
      `linhas=${entrou}`,
    )

    // ---------------------------------------------------------------- idempotencia
    const denovo = await runLanguageCutdown(prisma, { allowlist: RECORTE, dryRun: false })
    record(
      'D — reexecutar o apagamento nao apaga mais nada',
      denovo.totalRows === 0 && denovo.refused === null,
      `linhas=${denovo.totalRows} · recusa=${denovo.refused ?? 'nenhuma'}`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const external = externalDatabaseUrl()
  if (external !== null) {
    console.log('[info] usando CINERIE_VALIDATOR_DATABASE_URL (cluster externo, loopback).')
    try {
      execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
        env: { ...process.env, DATABASE_URL: external },
        stdio: 'inherit',
        cwd: dbDir,
      })
      record('migrate deploy aplica do zero', true, 'ok')
      await runChecks(external)
    } catch (error) {
      record(
        'execucao sem excecao',
        false,
        error instanceof Error ? error.message.split('\n').join(' ').slice(0, 300) : String(error),
      )
      if (error instanceof Error && error.stack) console.error(error.stack)
    }
    console.log(`\nRESUMO: ${passed}/${total} checks OK`)
    process.exitCode = passed === total ? 0 : 1
    return
  }

  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-language-cutdown-pg-'))
  // SEM `initdbFlags`: o cluster default sobe no checkout acentuado; quem morre
  // ali e `--encoding=UTF8`. Os fixtures deste validador sao ASCII de proposito.
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_language_cutdown`
  let started = false

  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_language_cutdown')

    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
      cwd: dbDir,
    })
    record('migrate deploy aplica do zero', true, 'ok')

    await runChecks(url)
  } catch (error) {
    record(
      'execucao sem excecao',
      false,
      error instanceof Error ? error.message.split('\n').join(' ').slice(0, 300) : String(error),
    )
    if (error instanceof Error && error.stack) console.error(error.stack)
  } finally {
    if (started) {
      try {
        await pg.stop()
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch {
      /* o SO limpa */
    }
  }

  console.log(`\nRESUMO: ${passed}/${total} checks OK`)
  process.exitCode = passed === total ? 0 : 1
}

void main()
