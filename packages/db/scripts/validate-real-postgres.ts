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
  // Prompt 10 - cadeia de entrada editorial (fonte -> item -> proveniencia).
  "editorial_sources", "source_items", "article_source_links",
  // P0-00a — raw sync TMDB (schema-only; worker-only, nao lido no render).
  "tmdb_raw", "tmdb_image_config",
  // Data governance hardening (2026-07) — registro polimorfico + quarentenas auditaveis.
  "entities", "entity_reference_orphans", "data_migration_quarantine",
  // Fases 6-8 — generos normalizados, biblioteca de midia e checkpoint de sync.
  "genres", "tmdb_images", "tmdb_videos", "tmdb_sync_checkpoint",
  // Backend A — fila duravel de jobs do catalogo + projecao de busca PostgreSQL.
  "catalog_jobs", "search_documents",
  // Backend A — entidades de referencia do catalogo + snapshots de descoberta.
  "collections", "movie_collection_memberships",
  "production_companies", "movie_production_companies", "tv_production_companies",
  "networks", "tv_networks",
  "keywords", "entity_keywords",
  "entity_alternative_titles",
  "discovery_snapshots", "discovery_snapshot_items",
  // Backend B — eixo use_case da governanca, provedores canonicos de streaming
  // e historico do Cinerie Score.
  "data_usage_decisions", "watch_providers", "watch_provider_aliases",
  "cinerie_score_calculations",
  // Backend C — user product platform (usuarios, auth, tracking, listas,
  // ratings, reviews, historico, recomendacoes, LGPD, importacao).
  "users", "user_profiles", "user_password_credentials", "user_accounts",
  "user_sessions", "user_verification_tokens", "user_auth_throttles",
  "user_auth_audit_logs", "user_watch_states", "user_episode_progress",
  "user_viewing_events", "user_lists", "user_list_items", "user_ratings",
  "user_reviews", "user_review_reports", "user_blocks", "user_stats_snapshots",
  "user_recommendation_snapshots", "user_consent_records", "user_data_requests",
  "user_import_jobs",
  // C7A — fundacao de persistencia: feedback explicito de recomendacao.
  "user_recommendation_feedback",
  // Projecao editorial (CMS -> banco publico): recibo de idempotencia do
  // consumidor da outbox do Payload.
  "editorial_projection_receipts",
  // FASE 2D — midia editorial governada, projetada do CMS para o storage publico.
  "editorial_media_assets",
];
const EXPECTED_ENUMS = [
  "EntityType", "ContentBlockType", "ContentSource", "ReviewStatus", "TranslationStatus",
  "IndexDecision", "JobType", "JobStatus", "LicenseStatus", "OfferType", "SyncStatus",
  "ValidationStatus", "ProviderKind",
  // Prompt 10 - plataforma editorial. `PublicDocKind` e o discriminador que
  // deixa artigo coexistir com entidade em search_documents e
  // page_indexability_decisions sem que `EntityType` ganhe `article`.
  "EditorialSourceKind", "EditorialSourceStatus", "EditorialSourceUseRights",
  "SourceItemStatus", "SourceItemDedupVerdict", "ArticleSourceRole", "PublicDocKind",
  // P0-00a — discriminador dedicado do raw sync TMDB.
  "TmdbEntityKind",
  // Data governance hardening (2026-07).
  "SourceLicenseContentType",
  // Backend A — enums da fila duravel de jobs do catalogo.
  "CatalogJobType", "CatalogJobStatus",
  // Backend B — ciclo de vida do dado externo, natureza da nota e estado do
  // calculo do Cinerie Score.
  "DataUsageStage", "RatingScoreType", "CinerieScoreStatus",
  // Backend C — user product platform.
  "UserStatus", "UserRole", "ProfileVisibility", "Visibility", "WatchState",
  "ViewingEventType", "ReviewModerationStatus", "AuthTokenPurpose",
  "ThrottleScope", "AuthAuditAction", "UserListKind", "SystemListKey",
  "ConsentKind", "DataRequestKind", "DataRequestStatus", "ImportSource",
  "ImportJobStatus", "ReportReason", "ReportStatus",
  // C7A — enums de recomendacao (espelham as unions fechadas do dominio puro).
  "RecommendationContext", "RecommendationFeedbackType", "RecommendationFeedbackSource",
  // Projecao editorial — desfecho de cada tentativa de projecao.
  "EditorialProjectionOutcome",
  // FASE 2D — licenca do asset de midia editorial (espelha o enum do CMS).
  "EditorialMediaLicenseStatus",
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
    // 3. Tabelas esperadas. A contagem sai de EXPECTED_TABLES.length — antes era
    //    um literal (`=== 50`) duplicando a lista logo acima, e as duas metades
    //    saiam de sincronia a cada migration: atualizar a lista e esquecer o
    //    numero fazia o check falhar mesmo com o banco correto (e, pior, o
    //    inverso passaria despercebido). Agora ha uma fonte so.
    //    O check continua bilateral: `missing` pega tabela esperada que sumiu,
    //    a contagem pega tabela criada sem passar por esta lista.
    const tables = (await q<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    )).map((r) => r.table_name).filter((t) => t !== "_prisma_migrations");
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    const unexpected = tables.filter((t) => !EXPECTED_TABLES.includes(t));
    record(3, `${EXPECTED_TABLES.length} tabelas esperadas`,
      tables.length === EXPECTED_TABLES.length && missing.length === 0 && unexpected.length === 0,
      `encontradas ${tables.length}${missing.length ? ", faltando " + missing.join(",") : ""}${unexpected.length ? ", inesperadas " + unexpected.join(",") : ""}`);

    // 4. Enums esperados (mesma disciplina de fonte unica do check 3).
    const enums = (await q<{ typname: string }>(
      "SELECT typname FROM pg_type WHERE typtype='e' AND typnamespace='public'::regnamespace",
    )).map((r) => r.typname);
    const missingEnums = EXPECTED_ENUMS.filter((e) => !enums.includes(e));
    const unexpectedEnums = enums.filter((e) => !EXPECTED_ENUMS.includes(e));
    record(4, `${EXPECTED_ENUMS.length} enums esperados`,
      enums.length === EXPECTED_ENUMS.length && missingEnums.length === 0 && unexpectedEnums.length === 0,
      `encontrados ${enums.length}${missingEnums.length ? ", faltando " + missingEnums.join(",") : ""}${unexpectedEnums.length ? ", inesperados " + unexpectedEnums.join(",") : ""}`);

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

    // 33. PROMOCAO fail-closed pelo TRIGGER PERMANENTE: display_allowed=true so
    //     com governanca completa. Insere oferta totalmente governada
    //     (display=false), tenta ligar com hash ERRADO (barrado pelo trigger),
    //     depois liga com o fingerprint correto do payload (aceito).
    //
    //     Backend B endureceu este caminho: alem do hash + revisor + licenca +
    //     atribuicao, exibir passou a exigir (a) provedor CANONICO resolvido por
    //     alias e (b) DataUsageDecision vigente para o uso. O setup abaixo monta
    //     essa cadeia — ela e o caminho unico, nao um atalho de teste.
    await exec(`INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('apple-tv', 'Apple TV', 'https://tv.apple.com/', now())`);
    await exec(`INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) SELECT id, 'streaming_availability', 'apple_tv', 'Apple TV', now() FROM watch_providers WHERE slug='apple-tv'`);
    // Convencao: para content_type='watch_availability', source_licenses.source_key
    // E o slug do watch_providers (o guard reconfere esse elo).
    await exec(`INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at) VALUES ('apple-tv', 'watch_availability', 'streaming_availability', 'BR', 'official', true, true, true, 'Oferta via Apple TV', true, 'revisor@screen', now(), 'validation/v1', now())`);
    await exec(`INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at) SELECT id, 'watch_offer_display', 'BR', 'approved_for_display', true, true, true, true, 'validation/v1', 'revisor@screen', 'cenario de validacao do trigger', now() FROM source_licenses WHERE source_key='apple-tv' AND content_type='watch_availability'`);
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, provider_key, offer_type, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, reviewed_by, reviewed_at, watch_provider_id, data_usage_decision_id, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Apple TV', 'apple_tv', 'buy', 'streaming_availability', 'official', true, true, 'Oferta via Apple TV', 'https://tv.apple.com/', 'revisor@screen', now(), (SELECT id FROM watch_providers WHERE slug='apple-tv'), (SELECT id FROM data_usage_decisions WHERE use_case='watch_offer_display'), now())`);
    let wrongHashRejected = false;
    try {
      await exec(`UPDATE watch_availability SET display_allowed=true, approved_payload_hash='HASH_ERRADO' WHERE entity_id=${movieId} AND provider_key='apple_tv'`);
    } catch {
      wrongHashRejected = true;
    }
    await exec(`UPDATE watch_availability SET display_allowed=true, approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url) WHERE entity_id=${movieId} AND provider_key='apple_tv'`);
    const promoted = (await q<{ display_allowed: boolean; reviewed_by: string | null }>(
      `SELECT display_allowed, reviewed_by FROM watch_availability WHERE entity_id = ${movieId} AND provider_key = 'apple_tv'`,
    ))[0];
    record(33, "promocao fail-closed: hash errado barrado; hash correto + governanca aceito",
      wrongHashRejected && promoted?.display_allowed === true && promoted?.reviewed_by === "revisor@screen",
      `wrongRejected=${wrongHashRejected}, display=${promoted?.display_allowed}`);

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

    // 38. PRECO e PAYLOAD, nao identidade: a mesma oferta com outro preco tem a
    //     MESMA identidade (a 2a e barrada pelo unique de identidade). Um preco
    //     diferente muda o PAYLOAD (invalida a aprovacao), nao cria nova oferta.
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, currency, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Globoplay', 'rent', 9.90, 'BRL', now())`);
    await expectViolation(38, "preco e payload (nao identidade): mesma oferta com outro preco e barrada",
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, currency, updated_at) VALUES ('movie', ${movieId}, 'BR', 'Globoplay', 'rent', 19.90, 'BRL', now())`);
    // e o fingerprint do PAYLOAD muda com o preco (aprovacao deixaria de valer).
    const payloadDiff = (await q<{ diff: boolean }>(
      `SELECT watch_offer_payload_fingerprint_v1('sa',NULL,'movie'::"EntityType",${movieId},'BR','rent'::"OfferType",NULL,'Globoplay',NULL,NULL,9.90,'BRL',NULL,NULL,NULL,NULL,'unknown'::"LicenseStatus",true,true,NULL,NULL)
              <> watch_offer_payload_fingerprint_v1('sa',NULL,'movie'::"EntityType",${movieId},'BR','rent'::"OfferType",NULL,'Globoplay',NULL,NULL,19.90,'BRL',NULL,NULL,NULL,NULL,'unknown'::"LicenseStatus",true,true,NULL,NULL) AS diff`,
    ))[0].diff;
    record(44, "payload fingerprint muda com o preco (mesma identidade, payload diferente)", payloadDiff === true, `diff=${payloadDiff}`);

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

    // 45. source_licenses: guard estrutural barra supersedes_id cross-group
    //     (fonte/tipo/provider/territorio diferentes). Usa a licenca vigente de
    //     rotten_tomatoes como alvo de um supersedes vindo de imdb.
    const rtLic = (await q<{ id: bigint }>(
      `SELECT id FROM source_licenses WHERE source_key='rotten_tomatoes' AND is_current=true LIMIT 1`,
    ))[0];
    await expectViolation(45, "source_licenses: supersedes_id cross-group barrado pelo guard",
      `INSERT INTO source_licenses (source_key, content_type, rating_source_key, is_current, supersedes_id, updated_at) VALUES ('imdb', 'rating', 'imdb', false, ${Number(rtLic.id)}, now())`);

    /* ---------------------------------------------------------------- */
    /* 46-52. Projecao editorial: CMS (Payload) -> banco publico.        */
    /* ---------------------------------------------------------------- */

    // Base: dois artigos publicos para exercitar a ancora do documento.
    await exec("INSERT INTO articles (payload_document_id, updated_at) VALUES ('payload-doc-a', now())");
    const [artA] = await q<{ id: bigint }>(
      "SELECT id FROM articles WHERE payload_document_id = 'payload-doc-a'",
    );

    // 46. CONTROLE POSITIVO. Sem ele, um `payload_document_id` que rejeitasse
    //     tudo passaria nos checks negativos abaixo sem projetar nada.
    record(46, "articles: payload_document_id valido e aceito",
      artA !== undefined && artA.id !== undefined, `id=${String(artA?.id)}`);

    // 47. Dois artigos publicos nunca apontam para o MESMO documento do CMS —
    //     senao reprojetar criaria duplicata em vez de atualizar.
    await expectViolation(47, "articles: payload_document_id duplicado barrado",
      "INSERT INTO articles (payload_document_id, updated_at) VALUES ('payload-doc-a', now())");

    // 48. NULL nao colide em UNIQUE do PostgreSQL: artigo legado (sem origem no
    //     CMS) continua podendo existir aos montes. Se esta linha falhasse, a
    //     migration teria quebrado todo o acervo anterior.
    await exec("INSERT INTO articles (payload_document_id, updated_at) VALUES (NULL, now())");
    await exec("INSERT INTO articles (payload_document_id, updated_at) VALUES (NULL, now())");
    const [{ legacy }] = await q<{ legacy: bigint }>(
      "SELECT count(*) AS legacy FROM articles WHERE payload_document_id IS NULL",
    );
    record(48, "articles: varios artigos legados sem documento do CMS convivem",
      Number(legacy) >= 2, `sem payload_document_id: ${String(legacy)}`);

    // 49. String vazia ocuparia o unico slot da chave unica fingindo ser um
    //     documento. Nao e ausencia nem presenca: e proibida.
    await expectViolation(49, "articles: payload_document_id vazio barrado",
      "INSERT INTO articles (payload_document_id, updated_at) VALUES ('', now())");

    // 50. Blocos precisam ser LISTA. Objeto solto quebraria todo consumidor que
    //     iterar a coluna.
    await exec(
      `INSERT INTO article_translations (article_id, language_code, slug, title, body_blocks, body_blocks_version, updated_at)
       VALUES (${Number(artA.id)}, 'pt-BR', 'projecao-editorial-ok', 'Projecao', '[{"type":"paragraph"}]'::jsonb, 'sha256:abc', now())`,
    );
    const [{ blocks }] = await q<{ blocks: number }>(
      "SELECT jsonb_array_length(body_blocks) AS blocks FROM article_translations WHERE slug = 'projecao-editorial-ok'",
    );
    record(50, "article_translations: body_blocks em lista e aceito", Number(blocks) === 1,
      `blocos=${String(blocks)}`);

    await expectViolation(51, "article_translations: body_blocks que nao e lista barrado",
      `INSERT INTO article_translations (article_id, language_code, slug, title, body_blocks, body_blocks_version, updated_at)
       VALUES (${Number(artA.id)}, 'en', 'projecao-objeto-solto', 'X', '{"type":"paragraph"}'::jsonb, 'sha256:abc', now())`);

    // 52. Blocos sem versao (ou versao sem blocos) e um estado que ninguem sabe
    //     interpretar na reprojecao.
    await expectViolation(52, "article_translations: body_blocks sem versao barrado",
      `INSERT INTO article_translations (article_id, language_code, slug, title, body_blocks, updated_at)
       VALUES (${Number(artA.id)}, 'es', 'projecao-sem-versao', 'X', '[]'::jsonb, now())`);

    /* 53-55. Recibo de projecao — a trava de replay do consumidor. */

    await exec(
      `INSERT INTO editorial_projection_receipts (event_id, event_type, aggregate_id, emission_sequence, article_id, outcome, worker_id)
       VALUES ('evt-1', 'article.published', 'payload-doc-a', 1, ${Number(artA.id)}, 'applied', 'worker-teste')`,
    );
    const [{ receipts }] = await q<{ receipts: bigint }>(
      "SELECT count(*) AS receipts FROM editorial_projection_receipts WHERE event_id = 'evt-1'",
    );
    record(53, "recibo de projecao e gravado", Number(receipts) === 1, `recibos=${String(receipts)}`);

    // 54. O MESMO evento nunca projeta duas vezes. Esta unique e o que faz o
    //     replay da outbox ser seguro: a segunda tentativa colide e a transacao
    //     inteira (projecao + recibo) e descartada.
    await expectViolation(54, "recibo: event_id duplicado barrado (trava de replay)",
      `INSERT INTO editorial_projection_receipts (event_id, event_type, aggregate_id, emission_sequence, outcome, worker_id)
       VALUES ('evt-1', 'article.published', 'payload-doc-a', 2, 'applied', 'worker-teste')`);

    // 55. Apagar o artigo NAO apaga a prova de que ele foi publicado um dia.
    await exec(`DELETE FROM articles WHERE id = ${Number(artA.id)}`);
    const [survivor] = await q<{ article_id: bigint | null }>(
      "SELECT article_id FROM editorial_projection_receipts WHERE event_id = 'evt-1'",
    );
    record(55, "recibo sobrevive a exclusao do artigo (article_id -> NULL)",
      survivor !== undefined && survivor.article_id === null,
      `article_id=${String(survivor?.article_id)}`);

    /* ---------------------------------------------------------------- */
    /* 56-63. Midia editorial governada (FASE 2D).                      */
    /* ---------------------------------------------------------------- */

    const HASH = `sha256:${"a".repeat(64)}`;
    const goodAsset = (suffix: string, overrides: Record<string, string> = {}) => {
      const cols = {
        payload_media_id: `'m-${suffix}'`,
        content_hash: `'${HASH}'`,
        storage_key: `'editorial/aa/${"a".repeat(64)}-${suffix}.jpg'`,
        public_path: `'/media/editorial/aa/${"a".repeat(64)}-${suffix}.jpg'`,
        mime_type: `'image/jpeg'`,
        byte_size: "1024",
        alt: `'capa'`,
        updated_at: "now()",
        ...overrides,
      };
      return `INSERT INTO editorial_media_assets (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")})`;
    };

    // 56. CONTROLE POSITIVO. Sem ele, uma tabela que rejeitasse tudo passaria
    //     em todos os checks negativos abaixo sem armazenar nada.
    await exec(goodAsset("ok"));
    const [{ assets }] = await q<{ assets: bigint }>(
      "SELECT count(*) AS assets FROM editorial_media_assets",
    );
    record(56, "asset editorial valido e aceito", Number(assets) === 1, `assets=${String(assets)}`);

    // 57. A REGRA CENTRAL DA FASE: caminho publico nunca e URL. O normalizador
    //     do apps/web recusa http(s), entao uma URL aqui viraria materia sem
    //     imagem em silencio.
    await expectViolation(57, "asset: public_path com URL http barrado",
      goodAsset("url", { payload_media_id: "'m-url'", public_path: "'https://cdn.exemplo/x.jpg'", storage_key: "'editorial/aa/url.jpg'" }));

    await expectViolation(58, "asset: public_path relativo (sem barra) barrado",
      goodAsset("rel", { payload_media_id: "'m-rel'", public_path: "'media/editorial/x.jpg'", storage_key: "'editorial/aa/rel.jpg'" }));

    // 59. Path traversal na chave do storage escreveria fora da raiz do disco.
    await expectViolation(59, "asset: storage_key com '..' barrado",
      goodAsset("dots", { payload_media_id: "'m-dots'", storage_key: "'editorial/../../etc/passwd'", public_path: "'/media/x-dots.jpg'" }));

    await expectViolation(60, "asset: storage_key absoluto barrado",
      goodAsset("abs", { payload_media_id: "'m-abs'", storage_key: "'/etc/passwd'", public_path: "'/media/x-abs.jpg'" }));

    // 61. Hash fora do formato indica que gravaram nome de upload ou URL ali.
    await expectViolation(61, "asset: content_hash fora do formato sha256 barrado",
      goodAsset("hash", { payload_media_id: "'m-hash'", content_hash: "'capa-final.jpg'", storage_key: "'editorial/aa/hash.jpg'", public_path: "'/media/x-hash.jpg'" }));

    // 62. Um documento do CMS tem UM asset publico corrente; duplicar criaria
    //     duas verdades para a mesma midia.
    await expectViolation(62, "asset: payload_media_id duplicado barrado",
      goodAsset("dup", { payload_media_id: "'m-ok'", storage_key: "'editorial/aa/dup.jpg'", public_path: "'/media/x-dup.jpg'" }));

    // 63. Apagar um asset compartilhado NAO pode apagar artigos: a materia
    //     perde a capa, nao a existencia.
    const [assetRow] = await q<{ id: bigint }>(
      "SELECT id FROM editorial_media_assets WHERE payload_media_id = 'm-ok'",
    );
    await exec(`INSERT INTO articles (payload_document_id, hero_media_asset_id, updated_at) VALUES ('doc-com-capa', ${Number(assetRow.id)}, now())`);
    await exec(`DELETE FROM editorial_media_assets WHERE id = ${Number(assetRow.id)}`);
    const [articleAfterAssetDrop] = await q<{ hero_media_asset_id: bigint | null }>(
      "SELECT hero_media_asset_id FROM articles WHERE payload_document_id = 'doc-com-capa'",
    );
    record(63, "artigo sobrevive a exclusao do asset (hero -> NULL)",
      articleAfterAssetDrop !== undefined && articleAfterAssetDrop.hero_media_asset_id === null,
      `hero_media_asset_id=${String(articleAfterAssetDrop?.hero_media_asset_id)}`);
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
