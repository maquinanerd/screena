/**
 * validate-real-postgres.ts — Validacao DESCARTAVEL da Fase 1 em PostgreSQL real.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do produto:
 * nunca roda no render, no build de app, nem em producao. Usada apenas para
 * revalidar a migration + o seed em qualquer maquina/CI, sem Docker e sem
 * Postgres global.
 *
 * Motor: `embedded-postgres@16.14.0-beta.17` (PostgreSQL 16 real, binario
 * portatil, EFEMERO). O sufixo "-beta" e a maturidade do wrapper npm; o motor e
 * Postgres real. Esta dependencia e devDependency-only de @screena/db.
 *
 * Seguranca:
 *  - NAO ha senha real nem segredo: o instance efemero usa a senha descartavel
 *    "postgres" apenas para o processo local; nada disso e producao.
 *  - NENHUM DATABASE_URL e persistido em disco/.env: ele so existe como variavel
 *    de ambiente em memoria, passada aos subprocessos durante a execucao, e e
 *    SEMPRE mascarado nos logs (postgres:****).
 *  - O Postgres efemero e DERRUBADO e o diretorio temporario e REMOVIDO no
 *    bloco `finally`, mesmo em caso de erro.
 *
 * Fluxo: sobe PG efemero -> prisma migrate deploy -> prisma db seed -> 18 checks
 * no banco real -> derruba tudo. NAO altera schema/migration/seed, nao toca
 * producao, nao commita nada.
 *
 * Uso: pnpm --filter @screena/db db:validate:real
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(scriptDir, "..");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");

type Row = Record<string, unknown>;
interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${n}. ${name} — ${detail}`);
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
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

/**
 * Remove um diretorio temporario com BEST-EFFORT. No Windows, o
 * embedded-postgres pode manter o diretorio de dados travado por alguns
 * milissegundos apos `stop()`; retentar resolve. Uma limpeza que falha NUNCA
 * deve derrubar a suite (o diretorio fica no %TEMP% e o SO limpa).
 */
async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.warn(`[cleanup] nao foi possivel remover ${dir} (deixado para o SO limpar).`);
}

const EXPECTED_TABLES = [
  "movies", "tv_shows", "seasons", "episodes", "people", "cast_members", "crew_members",
  "entity_translations", "content_blocks", "entity_writer_jobs", "entity_writer_logs",
  "external_ratings", "source_licenses", "watch_availability", "page_indexability_decisions",
  "countries", "languages", "slugs", "redirects", "api_sync_logs", "api_cache",
  "rating_sources", "api_providers", "entity_external_ids",
  // Fase 4F-A — ambiente editorial/blog.
  "articles", "article_translations", "entity_news_links",
  // P0-00a — raw sync TMDB (schema-only; worker-only, nao lido no render).
  "tmdb_raw", "tmdb_image_config",
  // Data governance hardening (2026-07) — registro polimorfico + quarentenas auditaveis.
  "entities", "entity_reference_orphans", "data_migration_quarantine",
];
const EXPECTED_ENUMS = [
  "EntityType", "ContentBlockType", "ContentSource", "ReviewStatus", "TranslationStatus",
  "IndexDecision", "JobType", "JobStatus", "LicenseStatus", "OfferType", "SyncStatus",
  "ValidationStatus", "ProviderKind",
  // P0-00a — discriminador dedicado do raw sync TMDB.
  "TmdbEntityKind",
  // Data governance hardening (2026-07).
  "SourceLicenseContentType",
];
const EXPECTED_SCALES: Record<string, number> = {
  imdb: 10, rotten_tomatoes: 100, metacritic: 100, letterboxd: 5, filmaffinity: 10,
};

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const q = <T = Row>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);

  /** Espera que `fn` LANCE (constraint deve barrar). */
  async function expectViolation(n: number, name: string, sql: string): Promise<void> {
    try {
      await exec(sql);
      record(n, name, false, "INSERT proibido foi ACEITO (constraint nao barrou)");
    } catch (e) {
      record(n, name, true, `barrado: ${(e as Error).message.split("\n")[0].slice(0, 90)}`);
    }
  }

  try {
    // 3. 32 tabelas esperadas (27 Fase 1/4F-A + tmdb_raw + tmdb_image_config do
    // P0-00a + entities + entity_reference_orphans + data_migration_quarantine)
    const tables = (await q<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    )).map((r) => r.table_name).filter((t) => t !== "_prisma_migrations");
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    record(3, "32 tabelas esperadas", tables.length === 32 && missing.length === 0,
      `encontradas ${tables.length}${missing.length ? ", faltando " + missing.join(",") : ""}`);

    // 4. 15 enums esperados (13 + TmdbEntityKind do P0-00a + SourceLicenseContentType do hardening 2026-07)
    const enums = (await q<{ typname: string }>(
      "SELECT typname FROM pg_type WHERE typtype='e' AND typnamespace='public'::regnamespace",
    )).map((r) => r.typname);
    const missingEnums = EXPECTED_ENUMS.filter((e) => !enums.includes(e));
    record(4, "15 enums esperados", enums.length === 15 && missingEnums.length === 0,
      `encontrados ${enums.length}${missingEnums.length ? ", faltando " + missingEnums.join(",") : ""}`);

    // 5/6/7. languages
    const langs = await q<{ code: string; is_published: boolean; index_default: boolean }>(
      "SELECT code, is_published, index_default FROM languages ORDER BY code",
    );
    const byCode = Object.fromEntries(langs.map((l) => [l.code, l]));
    record(5, "languages contem pt-BR, en, es", ["pt-BR", "en", "es"].every((c) => c in byCode),
      `codigos: ${langs.map((l) => l.code).join(", ")}`);
    record(6, "pt-BR publicado/indexavel", byCode["pt-BR"]?.is_published === true && byCode["pt-BR"]?.index_default === true,
      `is_published=${byCode["pt-BR"]?.is_published}, index_default=${byCode["pt-BR"]?.index_default}`);
    record(7, "en/es nao publicados/noindex",
      ["en", "es"].every((c) => byCode[c]?.is_published === false && byCode[c]?.index_default === false),
      `en(${byCode["en"]?.is_published}/${byCode["en"]?.index_default}) es(${byCode["es"]?.is_published}/${byCode["es"]?.index_default})`);

    // 8. rating_sources
    const rs = await q<{ key: string; scale: number }>("SELECT key, scale FROM rating_sources");
    const scaleByKey = Object.fromEntries(rs.map((r) => [r.key, Number(r.scale)]));
    const scalesOk = Object.entries(EXPECTED_SCALES).every(([k, v]) => scaleByKey[k] === v) && rs.length === 5;
    record(8, "rating_sources: fontes e escalas corretas", scalesOk, JSON.stringify(scaleByKey));

    // 9. disjuncao api_providers x rating_sources
    const ap = (await q<{ key: string }>("SELECT key FROM api_providers")).map((r) => r.key);
    const inter = ap.filter((k) => k in scaleByKey);
    record(9, "api_providers.key disjunto de rating_sources.key", inter.length === 0,
      `providers: ${ap.join(",")}; intersecao: [${inter.join(",")}]`);

    // 10/11. display_allowed default false
    for (const [n, table] of [[10, "external_ratings"], [11, "watch_availability"]] as const) {
      const def = (await q<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns WHERE table_name='${table}' AND column_name='display_allowed'`,
      ))[0]?.column_default;
      record(n, `${table}.display_allowed default false`, def === "false", `default=${def}`);
    }

    // 12. slug canonico: unique parcial barra 2o canonico
    // Entidade REAL necessaria: as tabelas polimorficas agora tem FK composta
    // para `entities` (hardening 2026-07); entity_id=1 solto nao existe mais.
    const seedMovieRow = (await q<{ id: bigint }>(
      "INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (900001, 'Validation Movie', now()) RETURNING id",
    ))[0];
    const movieId = Number(seedMovieRow.id);
    await exec(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', ${movieId}, 'pt-BR', 'slug-a', true, now())`);
    await expectViolation(12, "indice unico parcial de slug canonico",
      `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', ${movieId}, 'pt-BR', 'slug-b', true, now())`);

    // 13. job ativo: unique parcial barra 2o ativo
    await exec(`INSERT INTO entity_writer_jobs (entity_type, entity_id, language_code, job_type, status, updated_at) VALUES ('movie', ${movieId}, 'pt-BR', 'generate_block', 'queued', now())`);
    await expectViolation(13, "indice unico parcial de job ativo",
      `INSERT INTO entity_writer_jobs (entity_type, entity_id, language_code, job_type, status, updated_at) VALUES ('movie', ${movieId}, 'pt-BR', 'generate_block', 'queued', now())`);

    // 14. redirect from_path <> to_path
    await expectViolation(14, "CHECK redirect from_path <> to_path",
      "INSERT INTO redirects (from_path, to_path) VALUES ('/x', '/x')");

    // 15. watch price exige currency
    await expectViolation(15, "CHECK watch price/currency",
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, updated_at) VALUES ('movie', ${movieId}, 'BR', 'TestProv', 'rent', 9.90, now())`);


    // 16. FK composta episodes(season_id, tv_show_id) -> seasons(id, tv_show_id)
    const tv = (await q<{ id: bigint }>("INSERT INTO tv_shows (tmdb_id, name_original, updated_at) VALUES (999001, 'Test Show', now()) RETURNING id"))[0];
    const tvId = Number(tv.id);
    const season = (await q<{ id: bigint }>(`INSERT INTO seasons (tv_show_id, season_number, updated_at) VALUES (${tvId}, 1, now()) RETURNING id`))[0];
    const seasonId = Number(season.id);
    let positiveOk = false;
    try {
      await exec(`INSERT INTO episodes (season_id, tv_show_id, episode_number, updated_at) VALUES (${seasonId}, ${tvId}, 1, now())`);
      positiveOk = true;
    } catch (e) {
      record(16, "FK composta episodes (positivo)", false, `episodio valido REJEITADO: ${(e as Error).message.split("\n")[0]}`);
    }
    if (positiveOk) {
      try {
        await exec(`INSERT INTO episodes (season_id, tv_show_id, episode_number, updated_at) VALUES (${seasonId}, ${tvId + 1}, 2, now())`);
        record(16, "FK composta episodes(season_id,tv_show_id)", false, "episodio com tv_show_id divergente foi ACEITO");
      } catch (e) {
        record(16, "FK composta episodes(season_id,tv_show_id)", true,
          `valido aceito; divergente barrado: ${(e as Error).message.split("\n")[0].slice(0, 70)}`);
      }
    }

    // 17. episodes sem season_number
    const epSeasonNum = Number((await q<{ c: bigint }>(
      "SELECT count(*) AS c FROM information_schema.columns WHERE table_name='episodes' AND column_name='season_number'",
    ))[0].c);
    record(17, "episodes NAO tem coluna season_number", epSeasonNum === 0, `colunas season_number em episodes: ${epSeasonNum}`);

    // 18. seasons tem season_number
    const seSeasonNum = Number((await q<{ c: bigint }>(
      "SELECT count(*) AS c FROM information_schema.columns WHERE table_name='seasons' AND column_name='season_number'",
    ))[0].c);
    record(18, "seasons TEM coluna season_number", seSeasonNum === 1, `colunas season_number em seasons: ${seSeasonNum}`);

    // ============================================================
    // Data governance hardening (2026-07) — checks 19+
    // ============================================================

    // 19. trigger de insert: `entities` e populada automaticamente ao criar movie/tv/season/episode
    const entityRows = await q<{ entity_type: string; entity_id: bigint }>(
      `SELECT entity_type, entity_id FROM entities WHERE (entity_type = 'movie' AND entity_id = ${movieId})
          OR (entity_type = 'tv' AND entity_id = ${tvId})
          OR (entity_type = 'season' AND entity_id = ${seasonId})`,
    );
    record(19, "trigger populate entities on insert", entityRows.length === 3,
      `esperado 3 linhas (movie/tv/season), encontrado ${entityRows.length}`);

    // 20. FK composta bloqueia referencia polimorfica orfa (entidade inexistente).
    // Usa um person_id REAL (isola o teste na FK de entities; um person_id
    // tambem invalido violaria a FK de people e mascararia o que estamos testando).
    const seedPersonRow = (await q<{ id: bigint }>(
      "INSERT INTO people (tmdb_id, name, updated_at) VALUES (900001, 'Validation Person', now()) RETURNING id",
    ))[0];
    const personId = Number(seedPersonRow.id);
    await expectViolation(20, "FK entities barra orfao em cast_members",
      `INSERT INTO cast_members (person_id, entity_type, entity_id, updated_at) VALUES (${personId}, 'movie', 999999999, now())`,
    );

    // 21. trigger de delete + FK RESTRICT: nao da pra apagar uma entidade que ainda tem dependente polimorfico
    await expectViolation(21, "entities RESTRICT barra delete de movie com slug dependente",
      `DELETE FROM movies WHERE id = ${movieId}`,
    );

    // 22. source_licenses: content_type default 'rating' + rating_source_key FK real (RatingSource != ApiProvider)
    const imdbLicense = (await q<{ content_type: string; rating_source_key: string | null; provider_key: string | null }>(
      "SELECT content_type, rating_source_key, provider_key FROM source_licenses WHERE source_key = 'imdb'",
    ))[0];
    record(22, "source_licenses.imdb: content_type=rating e rating_source_key=imdb",
      imdbLicense?.content_type === "rating" && imdbLicense?.rating_source_key === "imdb",
      `content_type=${imdbLicense?.content_type}, rating_source_key=${imdbLicense?.rating_source_key}`);

    // 23. source_licenses: chave natural funcional barra duplicata (source_key+content_type+provider/territorio)
    await expectViolation(23, "chave natural funcional de source_licenses",
      "INSERT INTO source_licenses (source_key, content_type, rating_source_key, updated_at) VALUES ('imdb', 'rating', 'imdb', now())",
    );

    // 24. source_licenses: CHECK exige rating_source_key quando content_type='rating'
    await expectViolation(24, "CHECK source_licenses_rating_requires_source",
      "INSERT INTO source_licenses (source_key, content_type, updated_at) VALUES ('imdb_v2', 'rating', now())",
    );

    // 25. watch_availability: chave natural cai para provider_name quando provider_key falta
    //     (duas plataformas SEM provider_key para a mesma entidade/pais/modalidade sao ofertas DISTINTAS)
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Max', 'subscription', now())`);
    let distinctProvidersOk = false;
    try {
      await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Prime Video', 'subscription', now())`);
      distinctProvidersOk = true;
    } catch (e) {
      record(25, "watch_availability natural key: plataformas distintas sem provider_key nao colidem", false,
        `INSERT legitimo REJEITADO: ${(e as Error).message.split("\n")[0]}`);
    }
    if (distinctProvidersOk) {
      await expectViolation(25, "watch_availability natural key: mesma plataforma/oferta duplicada e barrada",
        `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Max', 'subscription', now())`,
      );
    }

    // 26. page_indexability_decisions: so 1 decisao "vigente" por entidade/idioma; historico preservado
    await exec(`INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision) VALUES ('movie', ${movieId}, 'pt-BR', '/pt/filmes/validation-movie/', 'index')`);
    await expectViolation(26, "indice unico parcial de decisao vigente (is_current)",
      `INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision) VALUES ('movie', ${movieId}, 'pt-BR', '/pt/filmes/validation-movie/', 'index')`,
    );
    let historyOk = false;
    try {
      await exec(`INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, is_current) VALUES ('movie', ${movieId}, 'pt-BR', '/pt/filmes/validation-movie/', 'noindex', false)`);
      historyOk = true;
    } catch {
      // Falha ja e refletida por historyOk=false abaixo; nada a fazer aqui.
    }
    record(27, "historico preservado: linha is_current=false coexiste com a vigente", historyOk,
      historyOk ? "insercao historica aceita" : "insercao historica REJEITADA (deveria ser aceita)");

    // 28. Concorrencia: 2 inserts SIMULTANEOS tentando ser is_current=true para o MESMO
    // (entity_type, entity_id, language_code) -> exatamente 1 deve vencer.
    const concurrent = await Promise.allSettled([
      exec(`INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, is_current) VALUES ('movie', ${movieId}, 'en', '/en/movies/validation-movie/', 'draft', true)`),
      exec(`INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, is_current) VALUES ('movie', ${movieId}, 'en', '/en/movies/validation-movie/', 'draft', true)`),
    ]);
    const fulfilledCount = concurrent.filter((r) => r.status === "fulfilled").length;
    record(28, "concorrencia: so 1 decisao concorrente vira is_current", fulfilledCount === 1,
      `insercoes aceitas=${fulfilledCount}/2`);

    // 29. articles: CHECK barra category/author_name vazios (nao apenas NULL)
    await expectViolation(29, "CHECK articles_category_not_empty",
      "INSERT INTO articles (category, updated_at) VALUES ('', now())",
    );

    // 30. entity_reference_orphans existe (quarentena auditavel, ainda vazia neste banco fresco)
    const orphanCount = Number((await q<{ c: bigint }>("SELECT count(*) AS c FROM entity_reference_orphans"))[0].c);
    record(30, "entity_reference_orphans existe e comeca vazia (banco fresco)", orphanCount === 0, `linhas=${orphanCount}`);

    // 31. source_licenses: territorio distingue a chave natural (uma licenca BR
    //     de imdb coexiste com a licenca global do seed, mesma fonte).
    let territoryOk = false;
    try {
      await exec(`INSERT INTO source_licenses (source_key, content_type, rating_source_key, territory_code, updated_at) VALUES ('imdb', 'rating', 'imdb', 'BR', now())`);
      territoryOk = true;
    } catch (e) {
      record(31, "source_licenses: territorio distingue a chave natural", false,
        `INSERT legitimo REJEITADO: ${(e as Error).message.split("\n")[0]}`);
    }
    if (territoryOk) {
      record(31, "source_licenses: territorio distingue a chave natural (BR coexiste com global)", true, "aceito");
    }

    // 32. source_licenses: CHECK rating_source_key <> provider_key existe
    //     (RatingSource != ApiProvider mesmo quando o texto coincide — inv. 2).
    const neCheck = Number((await q<{ c: bigint }>(
      "SELECT count(*) AS c FROM pg_constraint WHERE conname = 'source_licenses_rating_source_ne_provider'",
    ))[0].c);
    record(32, "CHECK source_licenses_rating_source_ne_provider existe", neCheck === 1, `constraints=${neCheck}`);

    // 33. watch_availability: linha com forma de PROMOCAO (licenca + atribuicao +
    //     linkback + revisor + fingerprint do payload aprovado) persiste e le de volta.
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, provider_key, offer_type, license_status, display_allowed, requires_attribution, requires_linkback, attribution_text, attribution_url, reviewed_by, reviewed_at, approved_payload_hash, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Apple TV', 'apple_tv', 'buy', 'official', true, true, true, 'Oferta via Apple TV', 'https://tv.apple.com/', 'revisor@screen', now(), 'sha256:deadbeef', now())`);
    const promoted = (await q<{ approved_payload_hash: string | null; reviewed_by: string | null; attribution_url: string | null }>(
      `SELECT approved_payload_hash, reviewed_by, attribution_url FROM watch_availability WHERE entity_id = ${movieId} AND provider_key = 'apple_tv'`,
    ))[0];
    record(33, "watch_availability guarda fingerprint/atribuicao/revisor da promocao",
      promoted?.approved_payload_hash === "sha256:deadbeef" &&
        promoted?.reviewed_by === "revisor@screen" &&
        promoted?.attribution_url === "https://tv.apple.com/",
      `hash=${promoted?.approved_payload_hash}, revisor=${promoted?.reviewed_by}`);

    // 34. troca ATOMICA de decisao vigente: UPDATE atual->false + INSERT novo->true
    //     numa unica transacao (o indice unico parcial nunca ve duas vigentes).
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`UPDATE page_indexability_decisions SET is_current = false WHERE entity_type='movie' AND entity_id=${movieId} AND language_code='pt-BR' AND is_current = true`),
      prisma.$executeRawUnsafe(`INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, is_current, policy_version, decision_origin) VALUES ('movie', ${movieId}, 'pt-BR', '/pt/filmes/validation-movie/', 'noindex', true, 'total-indexing-2026-07', 'test_atomic_swap')`),
    ]);
    const afterSwapCurrent = Number((await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM page_indexability_decisions WHERE entity_type='movie' AND entity_id=${movieId} AND language_code='pt-BR' AND is_current = true`,
    ))[0].c);
    record(34, "troca atomica de decisao vigente: continua com exatamente 1 vigente", afterSwapCurrent === 1, `vigentes=${afterSwapCurrent}`);

    // 35. colunas de governanca presentes (web_url/package/approved_payload_hash/
    //     attribution_url em watch_availability; territory_code/valid_from/
    //     valid_until/decided_by em source_licenses) — 8 no total.
    const govCols = Number((await q<{ c: bigint }>(
      "SELECT count(*) AS c FROM information_schema.columns WHERE (table_name='watch_availability' AND column_name IN ('web_url','package','approved_payload_hash','attribution_url')) OR (table_name='source_licenses' AND column_name IN ('territory_code','valid_from','valid_until','decided_by'))",
    ))[0].c);
    record(35, "colunas de governanca presentes (watch_availability + source_licenses)", govCols === 8, `colunas=${govCols}/8`);

    // 36. provider_key NAO e derivado de provider_name: uma oferta sem provider
    //     tecnico permanece com provider_key NULL (sinal missing-provider).
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Netflix', 'rent', now())`);
    const netflixKey = (await q<{ provider_key: string | null }>(
      `SELECT provider_key FROM watch_availability WHERE entity_id=${movieId} AND provider_name='Netflix' AND offer_type='rent'`,
    ))[0]?.provider_key ?? null;
    record(36, "provider_key permanece NULL (nao inventado do provider_name)", netflixKey === null, `provider_key=${netflixKey}`);

    // 37. Acentos/caixa produzem IDENTIDADES DISTINTAS: 'Max' e 'Max acentuado'
    //     nao colapsam (fingerprint preserva acento; identidades diferentes ate a
    //     API fornecer o ID tecnico).
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Max', 'free', now())`);
    let accentDistinct = false;
    try {
      await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie', ${movieId}, 'BR', 'M` + "á" + `x', 'free', now())`);
      accentDistinct = true;
    } catch {
      accentDistinct = false;
    }
    record(37, "acentos geram identidade distinta ('Max' != 'Max' acentuado)", accentDistinct, accentDistinct ? "ambas aceitas" : "colidiram (nao deveriam)");

    // 38. Mesma plataforma/modalidade/qualidade, PRECOS diferentes = ofertas
    //     DISTINTAS (nao colapsam).
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, currency, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Prime Video', 'rent', 9.90, 'BRL', now())`);
    let priceDistinct = false;
    try {
      await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, currency, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Prime Video', 'rent', 19.90, 'BRL', now())`);
      priceDistinct = true;
    } catch {
      priceDistinct = false;
    }
    record(38, "precos diferentes = ofertas distintas (nao colapsam)", priceDistinct, priceDistinct ? "ambas aceitas" : "colidiram (nao deveriam)");

    // 39. external_offer_id e a IDENTIDADE quando presente: duas linhas com o
    //     MESMO id externo sao a MESMA oferta (mudanca de preco = update, nao nova
    //     oferta) -> a 2a e barrada.
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, external_offer_id, provider_name, offer_type, price, currency, updated_at) VALUES ('movie', ${movieId}, 'BR', 'EXT-OFFER-1', 'HBO', 'rent', 5.00, 'BRL', now())`);
    await expectViolation(39, "external_offer_id define identidade (mesmo id + preco diferente = mesma oferta)",
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, external_offer_id, provider_name, offer_type, price, currency, updated_at) VALUES ('movie', ${movieId}, 'BR', 'EXT-OFFER-1', 'HBO', 'rent', 99.00, 'BRL', now())`);

    // 40. source_licenses HISTORICO: supersede a licenca global de imdb (marca a
    //     anterior is_current=false + insere nova vigente com supersedes_id).
    const imdbGlobal = (await q<{ id: bigint }>(
      `SELECT id FROM source_licenses WHERE source_key='imdb' AND territory_code IS NULL AND provider_key IS NULL AND is_current=true`,
    ))[0];
    const imdbGlobalId = Number(imdbGlobal.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`UPDATE source_licenses SET is_current=false WHERE id=${imdbGlobalId}`),
      prisma.$executeRawUnsafe(`INSERT INTO source_licenses (source_key, content_type, rating_source_key, is_current, supersedes_id, decision_origin, updated_at) VALUES ('imdb', 'rating', 'imdb', true, ${imdbGlobalId}, 'test_history', now())`),
    ]);
    const imdbCurrent = Number((await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM source_licenses WHERE source_key='imdb' AND territory_code IS NULL AND provider_key IS NULL AND is_current=true`,
    ))[0].c);
    const imdbTotal = Number((await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM source_licenses WHERE source_key='imdb' AND territory_code IS NULL AND provider_key IS NULL`,
    ))[0].c);
    record(40, "source_licenses historico: 1 vigente + supersede preserva anterior", imdbCurrent === 1 && imdbTotal >= 2, `vigentes=${imdbCurrent}, total=${imdbTotal}`);

    // 41. enum content_type='video' usavel (Fase 7 — biblioteca de video TMDB).
    let videoOk = false;
    try {
      await exec(`INSERT INTO source_licenses (source_key, content_type, updated_at) VALUES ('tmdb_video_lib', 'video', now())`);
      videoOk = true;
    } catch (e) {
      record(41, "content_type='video' aceito", false, `rejeitado: ${(e as Error).message.split("\n")[0]}`);
    }
    if (videoOk) record(41, "content_type='video' aceito (contrato de licenca cobre video)", true, "aceito");

    // 42. page_indexability: guarda estrutural barra supersedes_id de OUTRO grupo
    //     (entidade/idioma diferente). Usa uma decisao de movie/en (do check 28).
    const enDecision = (await q<{ id: bigint }>(
      `SELECT id FROM page_indexability_decisions WHERE entity_type='movie' AND entity_id=${movieId} AND language_code='en' LIMIT 1`,
    ))[0];
    await expectViolation(42, "supersedes_id de outro (entidade/idioma) e barrado pelo trigger",
      `INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, is_current, supersedes_id) VALUES ('movie', ${movieId}, 'pt-BR', '/pt/filmes/validation-movie/', 'noindex', false, ${Number(enDecision.id)})`);

    // 43. PACKAGES diferentes = ofertas DISTINTAS (mesma plataforma/modalidade,
    //     package na identidade). package so existe pos-Fase 2, entao e testado aqui.
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, package, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Disney', 'subscription', 'Basico', now())`);
    let packageDistinct = false;
    try {
      await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, package, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Disney', 'subscription', 'Premium', now())`);
      packageDistinct = true;
    } catch {
      packageDistinct = false;
    }
    record(43, "packages diferentes = ofertas distintas (nao colapsam)", packageDistinct, packageDistinct ? "ambas aceitas" : "colidiram (nao deveriam)");
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_validation?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/screena_validation?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_validation");

    const env = { ...process.env, DATABASE_URL: url };
    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- checks no banco real ---");
    await runChecks(url);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (started) {
      // pg.stop() pode lancar EBUSY no Windows ao limpar o dataDir; best-effort.
      try {
        await pg.stop();
      } catch (e) {
        console.warn(`[cleanup] pg.stop: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado e dir temporario removido ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Migration + seed validados em PostgreSQL real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
