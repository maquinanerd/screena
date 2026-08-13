/**
 * validate-licensed-intelligence-real-postgres.ts — Validacao DESCARTAVEL do
 * produto de INTELIGENCIA LICENCIADA (ratings + onde assistir) contra
 * PostgreSQL REAL, com os triggers de governanca ATIVOS.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * Prova os 5 criterios de aceite do Prompt 04, ponta a ponta e com banco real:
 *   1. Todo dado publico tem origem/licenca/atribuicao.
 *   2. Fontes pendentes ficam invisiveis.
 *   3. Disponibilidade respeita pais.
 *   4. Desligar fonte nao quebra pagina.
 *   5. Validadores legais passam com dados reais.
 *
 * O ponto central: o gate de ESCRITA (triggers) e o gate de LEITURA
 * (entity-ratings/entity-watch) sao coisas DIFERENTES. O trigger dispara quando
 * alguem escreve; ele nao dispara quando o TEMPO passa nem quando a licenca-mae
 * e supersedida depois. Por isso varios checks aqui desligam a fonte SEM tocar
 * na linha do dado — e exigem que a leitura sozinha faca o dado sumir.
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO),
 * mesmo padrao dos demais validate:*-real-postgres.
 *
 * Seguranca:
 *  - ZERO rede, ZERO Gemini, ZERO TMDB/RapidAPI: so o Postgres efemero local.
 *  - Nenhum DATABASE_URL persistido em disco/.env; sempre mascarado no log.
 *  - Postgres derrubado e diretorio removido no `finally`.
 *
 * Uso: pnpm --filter @screena/web validate:licensed-intelligence
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
/** Revisor humano ficticio do cenario (o schema exige identidade humana). */
const REVIEWER = "validacao@cinerie";

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

type PrismaLike = {
  $executeRawUnsafe: (sql: string) => Promise<number>;
  $queryRawUnsafe: <T>(sql: string) => Promise<T[]>;
};

type MoviePageData = {
  ratings: { items: Array<Record<string, unknown>> } | null;
  watch: { attributions: Array<{ text: string; url: string | null }>; groups: unknown[] } | null;
  seo: { decision: string };
} | null;
type GetMoviePageData = (slug: string) => Promise<MoviePageData>;

/** Escapa string para literal SQL simples. */
function lit(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

async function runChecks(
  prisma: PrismaLike,
  getMoviePageData: GetMoviePageData,
): Promise<void> {
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T>(sql);
  const x = (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql);

  /** Invalida o cache por-request do `react.cache` entre cenarios. */
  const readPage = async (slug: string): Promise<MoviePageData> => {
    const mod = (await import(
      `../src/server/movie-page.ts?bust=${Math.random().toString(36).slice(2)}`
    )) as { getMoviePageData: GetMoviePageData };
    return mod.getMoviePageData(slug);
  };
  void getMoviePageData;

  // ---------------------------------------------------------------- cenario
  const movie = (
    await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (900001, 'Licensed Title', now()) RETURNING id`,
    )
  )[0]!;
  const movieId = movie.id.toString();
  await x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', ${movieId}, ${lit(LANGUAGE)}, 'filme-licenciado', true, now())`,
  );
  await x(
    `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, meta_description, updated_at) VALUES ('movie', ${movieId}, ${lit(LANGUAGE)}, 'Filme Licenciado', 'Descricao editorial propria.', now())`,
  );

  // Licenca de rating do IMDb. O seed da Fase 1 ja cria a licenca-SEMENTE
  // conservadora (`unknown`, nada permitido) e um indice unico PARCIAL impede
  // uma segunda linha `is_current` no mesmo grupo — por isso aqui a licenca e
  // ATUALIZADA para o estado autorizado, e nao inserida de novo. Em producao
  // quem faz essa transicao e `pnpm legal sources apply` (com supersede).
  const licenseUpdated = await x(
    `UPDATE source_licenses SET license_status='third_party', display_allowed=true, logo_allowed=false, score_allowed=true, review_quote_allowed=false, requires_attribution=true, requires_linkback=true, attribution_text='Nota fornecida por IMDb', decided_by=${lit(REVIEWER)}, decided_at=now(), policy_version='validation/v1', updated_at=now()
     WHERE source_key='imdb' AND content_type='rating' AND is_current`,
  );
  record(
    3,
    "licenca-semente do IMDb existe e foi promovida a autorizada",
    licenseUpdated === 1,
    `linhas atualizadas=${licenseUpdated}`,
  );
  const licenseId = (
    await q<{ id: bigint }>(
      `SELECT id FROM source_licenses WHERE source_key='imdb' AND content_type='rating' AND is_current ORDER BY id DESC LIMIT 1`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, is_current, updated_at)
     VALUES (${licenseId},'rating_display','BR','approved_for_display',true,true,false,true,true,'validation/v1',${lit(REVIEWER)},'cenario de validacao de ratings',true,now())`,
  );
  const decisionId = (
    await q<{ id: bigint }>(
      `SELECT id FROM data_usage_decisions WHERE source_license_id=${licenseId} AND use_case='rating_display' ORDER BY id DESC LIMIT 1`,
    )
  )[0]!.id.toString();

  // Nota do IMDb. `display_allowed` so pode ser ligado com o fingerprint
  // aprovado — computado pelo PROPRIO banco, como em producao.
  await x(
    `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, rating_count, rating_url, provider_api, fetched_at, attribution_text, attribution_url, license_status, score_type, requires_attribution, requires_linkback, reviewed_at, reviewed_by, data_usage_decision_id, display_allowed, updated_at)
     VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 8.4, 10, 1234, 'https://www.imdb.com/title/tt900001/', 'rapidapi_film_show_ratings', now(), 'Nota fornecida por IMDb', 'https://www.imdb.com/title/tt900001/', 'third_party', 'audience', true, true, now(), ${lit(REVIEWER)}, ${decisionId}, false, now())`,
  );
  const ratingId = (
    await q<{ id: bigint }>(
      `SELECT id FROM external_ratings WHERE entity_id=${movieId} AND rating_source='imdb'`,
    )
  )[0]!.id.toString();
  await x(
    `UPDATE external_ratings SET approved_payload_hash = external_rating_payload_fingerprint_v1(entity_type, entity_id, rating_source, metric, score_type, rating_label, rating_value, rating_scale, rating_count, rating_url, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url), display_allowed = true WHERE id=${ratingId}`,
  );
  record(
    4,
    "banco aceita nota licenciada+creditada+revisada (fingerprint valido)",
    true,
    "display_allowed=true gravado",
  );

  // ------------------------------------------------- 1. origem/licenca/credito
  const withRating = await readPage("filme-licenciado");
  const item = withRating?.ratings?.items?.[0] as Record<string, unknown> | undefined;
  record(
    5,
    "C1. nota licenciada aparece na pagina COM credito da fonte",
    item !== undefined &&
      (item.attribution as { text: string }).text === "Nota fornecida por IMDb",
    `item=${item === undefined ? "ausente" : String(item.sourceKey)} credito=${
      item === undefined ? "-" : (item.attribution as { text: string }).text
    }`,
  );
  record(
    6,
    "C1. nota exibida na ESCALA DA FONTE (8,4/10), nunca normalizada",
    item?.scoreLabel === "8,4/10",
    `scoreLabel=${String(item?.scoreLabel)}`,
  );
  record(
    7,
    "C1. credito NUNCA cita o fornecedor tecnico (invariante 2)",
    !JSON.stringify(withRating?.ratings ?? {}).match(/rapidapi/i),
    "sem 'rapidapi' no payload publico",
  );
  record(
    8,
    "pagina com nota licenciada continua indexavel",
    withRating?.seo.decision === "index",
    `decision=${String(withRating?.seo.decision)}`,
  );

  // ------------------------------------- 2/4. desligar a fonte pelo TEMPO
  // Expira a decisao SEM tocar na linha da nota: o trigger nao dispara (nao ha
  // escrita na nota); so a LEITURA pode perceber. `display_allowed` continua
  // true no banco de proposito — e esse o ponto do check.
  // A janela inteira vai para o passado: o CHECK `data_usage_decisions_validity_range`
  // exige valid_until > valid_from, entao "expirar" e deslocar a janela, nao so
  // puxar o fim para tras.
  await x(
    `UPDATE data_usage_decisions SET valid_from = now() - interval '10 days', valid_until = now() - interval '1 day' WHERE id=${decisionId}`,
  );
  const stillFlagged = (
    await q<{ display_allowed: boolean }>(
      `SELECT display_allowed FROM external_ratings WHERE id=${ratingId}`,
    )
  )[0]!.display_allowed;
  const afterExpiry = await readPage("filme-licenciado");
  record(
    9,
    "C2. decisao EXPIRADA torna a nota invisivel (leitura e o relogio)",
    stillFlagged === true && (afterExpiry?.ratings === null),
    `linha ainda display_allowed=${stillFlagged}, painel=${afterExpiry?.ratings === null ? "omitido" : "VISIVEL"}`,
  );
  record(
    10,
    "C4. desligar a fonte NAO quebra a pagina (segue index, sem erro)",
    afterExpiry !== null && afterExpiry.seo.decision === "index",
    `decision=${String(afterExpiry?.seo.decision)}`,
  );

  // -------------------------------------------- 3. territorialidade do rating
  await x(
    `UPDATE data_usage_decisions SET valid_until = NULL, territory = 'US' WHERE id=${decisionId}`,
  );
  const otherTerritory = await readPage("filme-licenciado");
  record(
    11,
    "C3. decisao de OUTRO territorio (US) nao exibe nota no site BR",
    otherTerritory?.ratings === null,
    `painel=${otherTerritory?.ratings === null ? "omitido" : "VISIVEL"}`,
  );

  // ------------------------------------- 2/4. desligar pela LICENCA-MAE
  await x(`UPDATE data_usage_decisions SET territory = 'BR' WHERE id=${decisionId}`);
  const restored = await readPage("filme-licenciado");
  record(
    12,
    "controle: restaurada a decisao BR, a nota volta a aparecer",
    restored?.ratings !== null,
    `painel=${restored?.ratings !== null ? "visivel" : "OMITIDO"}`,
  );

  await x(`UPDATE source_licenses SET is_current = false WHERE id=${licenseId}`);
  const licenseOff = await readPage("filme-licenciado");
  record(
    13,
    "C2. licenca-mae SUPERSEDIDA torna a nota invisivel sem tocar na nota",
    licenseOff?.ratings === null,
    `painel=${licenseOff?.ratings === null ? "omitido" : "VISIVEL"}`,
  );
  record(
    14,
    "C4. pagina segue inteira e indexavel com a fonte desligada",
    licenseOff !== null && licenseOff.seo.decision === "index",
    `decision=${String(licenseOff?.seo.decision)}`,
  );
  await x(`UPDATE source_licenses SET is_current = true WHERE id=${licenseId}`);

  // ------------------------------- 1. o banco RECUSA nota sem credito
  let rejectedNoAttribution = false;
  try {
    await x(
      `UPDATE external_ratings SET attribution_text = NULL, approved_payload_hash = external_rating_payload_fingerprint_v1(entity_type, entity_id, rating_source, metric, score_type, rating_label, rating_value, rating_scale, rating_count, rating_url, provider_api, license_status, requires_attribution, requires_linkback, NULL, attribution_url) WHERE id=${ratingId}`,
    );
  } catch {
    rejectedNoAttribution = true;
  }
  record(
    15,
    "C1. banco RECUSA exibir nota sem attribution_text (fail-closed de escrita)",
    rejectedNoAttribution,
    rejectedNoAttribution ? "trigger rejeitou" : "ACEITOU (regressao)",
  );

  let rejectedNoScore = false;
  try {
    await x(`UPDATE source_licenses SET score_allowed = false WHERE id=${licenseId}`);
    await x(
      `UPDATE external_ratings SET rating_count = 4321, approved_payload_hash = external_rating_payload_fingerprint_v1(entity_type, entity_id, rating_source, metric, score_type, rating_label, rating_value, rating_scale, 4321, rating_url, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url) WHERE id=${ratingId}`,
    );
  } catch {
    rejectedNoScore = true;
  }
  record(
    16,
    "C1. licenca com score_allowed=false impede exibir o NUMERO da nota",
    rejectedNoScore,
    rejectedNoScore ? "trigger rejeitou" : "ACEITOU (regressao)",
  );
  await x(`UPDATE source_licenses SET score_allowed = true WHERE id=${licenseId}`);

  // ------------------------------------------------ onde assistir (streaming)
  await x(
    `INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('netflix','Netflix','https://www.netflix.com/', now())`,
  );
  const providerId = (
    await q<{ id: bigint }>(`SELECT id FROM watch_providers WHERE slug='netflix'`)
  )[0]!.id.toString();
  await x(
    `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) VALUES (${providerId},'streaming_availability','netflix','Netflix', now())`,
  );
  await x(
    `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, logo_allowed, score_allowed, review_quote_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
     VALUES ('netflix','watch_availability','streaming_availability','BR','third_party',true,false,false,false,true,true,'Disponibilidade fornecida por Movie of the Night',true,${lit(REVIEWER)},now(),'validation/v1',now())`,
  );
  const watchLicenseId = (
    await q<{ id: bigint }>(
      // `provider_key` faz parte da IDENTIDADE de uma licenca de streaming:
      // existe uma por fornecedor tecnico (Movie of the Night para
      // `streaming_availability`, JustWatch para `tmdb`). Este cenario monta uma
      // so, entao `ORDER BY id DESC` acertaria por acidente — e e exatamente o
      // padrao que a proxima pessoa copia para um lugar onde as duas existem, e
      // ai o dado de uma origem sai creditado a outra, em silencio.
      `SELECT id FROM source_licenses WHERE source_key='netflix' AND content_type='watch_availability' AND provider_key='streaming_availability' ORDER BY id DESC LIMIT 1`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, is_current, updated_at)
     VALUES (${watchLicenseId},'watch_offer_display','BR','approved_for_display',true,true,false,true,true,'validation/v1',${lit(REVIEWER)},'cenario de validacao de streaming',true,now())`,
  );
  const watchDecisionId = (
    await q<{ id: bigint }>(
      `SELECT id FROM data_usage_decisions WHERE source_license_id=${watchLicenseId} ORDER BY id DESC LIMIT 1`,
    )
  )[0]!.id.toString();

  await x(
    `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_api, external_offer_id, provider_key, provider_name, offer_type, deep_link, quality, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, reviewed_at, reviewed_by, watch_provider_id, data_usage_decision_id, display_allowed, updated_at)
     VALUES ('movie', ${movieId}, 'BR', 'streaming_availability', 'offer-900001', 'netflix', 'Netflix', 'subscription', 'https://www.netflix.com/title/900001', 'hd', 'third_party', true, true, 'Disponibilidade fornecida por Movie of the Night', 'https://www.movieofthenight.com/', now(), now(), ${lit(REVIEWER)}, ${providerId}, ${watchDecisionId}, false, now())`,
  );
  const offerId = (
    await q<{ id: bigint }>(
      `SELECT id FROM watch_availability WHERE entity_id=${movieId} AND provider_key='netflix'`,
    )
  )[0]!.id.toString();
  await x(
    `UPDATE watch_availability SET approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url), display_allowed = true WHERE id=${offerId}`,
  );

  const withWatch = await readPage("filme-licenciado");
  record(
    17,
    "C1. oferta licenciada aparece COM o credito do agregador",
    withWatch?.watch !== null &&
      withWatch!.watch!.attributions.some(
        (a) => a.text === "Disponibilidade fornecida por Movie of the Night",
      ),
    `creditos=${JSON.stringify(withWatch?.watch?.attributions ?? [])}`,
  );

  // TERRITORIALIDADE (C3). Nao adianta tentar apontar a decisao BR para os EUA:
  // o banco recusa ("decisao no territorio US excede a licenca (territorio BR)").
  // O teste honesto e outro — uma oferta PLENAMENTE licenciada e exibivel nos
  // EUA, com licenca US e decisao US proprias, nao pode vazar para a pagina BR.
  await x(
    `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, logo_allowed, score_allowed, review_quote_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
     VALUES ('netflix','watch_availability','streaming_availability','US','third_party',true,false,false,false,true,true,'Disponibilidade fornecida por Movie of the Night',true,${lit(REVIEWER)},now(),'validation/v1',now())`,
  );
  const usLicenseId = (
    await q<{ id: bigint }>(
      // Idem ao BR acima: a origem faz parte da identidade da licenca.
      `SELECT id FROM source_licenses WHERE source_key='netflix' AND content_type='watch_availability' AND provider_key='streaming_availability' AND territory_code='US' ORDER BY id DESC LIMIT 1`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, is_current, updated_at)
     VALUES (${usLicenseId},'watch_offer_display','US','approved_for_display',true,true,false,true,true,'validation/v1',${lit(REVIEWER)},'oferta licenciada nos EUA',true,now())`,
  );
  const usDecisionId = (
    await q<{ id: bigint }>(
      `SELECT id FROM data_usage_decisions WHERE source_license_id=${usLicenseId} ORDER BY id DESC LIMIT 1`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_api, external_offer_id, provider_key, provider_name, offer_type, deep_link, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, reviewed_at, reviewed_by, watch_provider_id, data_usage_decision_id, display_allowed, updated_at)
     VALUES ('movie', ${movieId}, 'US', 'streaming_availability', 'offer-900001-us', 'netflix', 'Netflix', 'subscription', 'https://www.netflix.com/title/900001?us', 'third_party', true, true, 'Disponibilidade fornecida por Movie of the Night', 'https://www.movieofthenight.com/', now(), now(), ${lit(REVIEWER)}, ${providerId}, ${usDecisionId}, false, now())`,
  );
  const usOfferId = (
    await q<{ id: bigint }>(
      `SELECT id FROM watch_availability WHERE entity_id=${movieId} AND country_code='US'`,
    )
  )[0]!.id.toString();
  await x(
    `UPDATE watch_availability SET approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url), display_allowed = true WHERE id=${usOfferId}`,
  );
  const usDisplayable = (
    await q<{ display_allowed: boolean }>(
      `SELECT display_allowed FROM watch_availability WHERE id=${usOfferId}`,
    )
  )[0]!.display_allowed;

  const withUsOffer = await readPage("filme-licenciado");
  const linksBr = (withUsOffer?.watch?.groups ?? []).flatMap((g) =>
    ((g as { offers: Array<{ destinationUrl: string }> }).offers ?? []).map(
      (o) => o.destinationUrl,
    ),
  );
  record(
    18,
    "C3. oferta exibivel nos EUA NAO vaza para o painel BR (disponibilidade respeita pais)",
    usDisplayable === true && !linksBr.some((l) => l.includes("?us")),
    `oferta US display_allowed=${usDisplayable}; links no painel BR=${JSON.stringify(linksBr)}`,
  );

  // Credito removido -> a oferta some (o gate de leitura que esta etapa criou).
  await x(
    `UPDATE watch_availability SET requires_attribution = false, requires_linkback = false, attribution_text = NULL, attribution_url = NULL, approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, false, false, NULL, NULL) WHERE id=${offerId}`,
  );
  const watchNoCredit = await readPage("filme-licenciado");
  record(
    19,
    "C1. oferta sem credito nenhum nao exibe credito fabricado",
    watchNoCredit?.watch !== null && watchNoCredit!.watch!.attributions.length === 0,
    `creditos=${JSON.stringify(watchNoCredit?.watch?.attributions ?? [])}`,
  );

  // ------------------------------------------ 4. estado honesto SEM fonte
  const bare = (
    await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (900002, 'Sem Fontes', now()) RETURNING id`,
    )
  )[0]!;
  await x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', ${bare.id.toString()}, ${lit(LANGUAGE)}, 'filme-sem-fontes', true, now())`,
  );
  await x(
    `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, meta_description, updated_at) VALUES ('movie', ${bare.id.toString()}, ${lit(LANGUAGE)}, 'Sem Fontes', 'Descricao propria.', now())`,
  );
  const noSources = await readPage("filme-sem-fontes");
  record(
    20,
    "C4. entidade SEM nenhuma fonte renderiza normal (sem painel, sem erro)",
    noSources !== null && noSources.ratings === null && noSources.watch === null,
    `ratings=${String(noSources?.ratings)}, watch=${String(noSources?.watch)}`,
  );
  record(
    21,
    "C4. entidade sem fonte continua INDEXAVEL (fonte nao e pre-requisito)",
    noSources?.seo.decision === "index",
    `decision=${String(noSources?.seo.decision)}`,
  );
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-licensed-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  const dbName = "cinerie_licensed_validation";
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${dbName}?schema=public`;
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/${dbName}?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase(dbName);

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy (schema existente; sem migration nova) ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record(1, "migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed (idiomas/paises/fontes/providers) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record(2, "db:seed roda sem erro", true, "ok");

    console.log("\n--- inteligencia licenciada no banco real (getMoviePageData) ---");
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const moviePage = (await import("../src/server/movie-page.ts")) as {
      getMoviePageData: GetMoviePageData;
    };

    await runChecks(dbServer.getPrismaClient(), moviePage.getMoviePageData);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (disconnect) await disconnect();
    if (started) await pg.stop();
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
  console.log(
    "Resultado: PASSOU. Ratings e onde assistir governados por licenca/atribuicao/territorio, com desligamento seguro.",
  );
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
