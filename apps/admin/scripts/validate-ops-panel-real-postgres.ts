/**
 * validate-ops-panel-real-postgres.ts — O PAINEL OPERACIONAL contra PostgreSQL 16
 * REAL efemero e Next.js REAL (o build de `apps/admin`).
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao roda em producao e so fala com
 * um banco local criado aqui (abort se a URL nao for 127.0.0.1).
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO PROVA
 * ============================================================================
 *  1. Cada numero da tela e o numero do banco, e MUDA quando o banco muda
 *     (controle negativo por numero: um valor cravado no HTML passaria no
 *     primeiro e reprovaria no segundo).
 *  2. Todo verde pode ficar vermelho: fila com volta de 300 dias, fila parada,
 *     servico com commit atras do main e cota recusada pelo fornecedor aparecem
 *     VERMELHOS, e o controle ao lado (fila em dia, servico em dia) nao.
 *  3. A cobertura em SQL da o MESMO numero que os portoes da pagina aplicados em
 *     TypeScript linha a linha — e o numero cai quando uma linha deixa de passar.
 *  4. O painel esta fora do indice (meta, cabecalho, robots.txt, sem sitemap) e
 *     bloqueado sem credencial POR REQUISICAO.
 *  5. Nenhum segredo aparece no HTML nem no log do servidor.
 *  6. O botao de forcar ENFILEIRA de verdade, com escopo novo que nao colide com
 *     o job do agendador, e o mesmo formulario enviado duas vezes e UMA acao.
 *  7. O painel NAO depende do fuso do banco: o PostgreSQL daqui roda em
 *     America/Sao_Paulo (com controle), e uma leitura que comparasse `timestamp`
 *     sem converter poria "ontem 23h UTC" no gasto de hoje.
 *  8. A migration aplica num PostgreSQL real: o `migrate deploy` roda antes de tudo.
 *  9. (Opcional) Capturas das telas, com `CINERIE_OPS_SCREENSHOTS_DIR` e Chrome.
 *
 * Uso: pnpm --filter @screena/admin validate:ops-panel
 * Pre-requisito: `pnpm build:admin`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { runChild } from "@screena/db/async-child-process";

import { formatDays, formatInt } from "../src/lib/ops/format";
import { explainRatingRow, explainTrailerRow } from "../src/lib/ops/visibility";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const adminDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(adminDir, "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));
const adminRequire = createRequire(path.join(adminDir, "package.json"));

const USER = "validador";
const PASS = `senha-do-validador-${Math.random().toString(36).slice(2)}-Zq9`;
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;
const SECRET_OMDB = "VALIDADOR0MDBSEGREDO9f3a7c";
const SECRET_TMDB = "eyJhbGciOiJIUzI1NiJ9.validadorTmdbSegredo.assinaturaFalsa";
const SECRET_GITHUB = "ghp_validadorGithubSegredo0123456789";

const PEOPLE = 2000;
const EMAILS = ["ana@exemplo.test", "bruno@exemplo.test", "carla@exemplo.test"] as const;
/** Fuso do PostgreSQL do validador: FORA de UTC de proposito (ver `newPg`). */
const VALIDATOR_TIME_ZONE = "America/Sao_Paulo";

const HEAD_SHA = "a".repeat(40);
const OLD_SHA = "c".repeat(40);
const DIGEST_HEAD = "d1".repeat(32);
const DIGEST_OLD = "d3".repeat(32);
const DIGEST_ORPHAN = "ee".repeat(32);

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
let counter = 0;
function record(name: string, ok: boolean, detail: string): void {
  counter += 1;
  results.push({ n: counter, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${counter}. ${name} — ${detail}`);
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
  const pkg = dbRequire("prisma/package.json") as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin.prisma as string);
  return path.join(path.dirname(pkgPath), rel);
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface Db {
  q: <T>(sql: string) => Promise<T[]>;
  x: (sql: string) => Promise<number>;
}

// ------------------------------------------------------------------ fixtures
interface Fixture {
  readonly matrixId: string;
  readonly showNoImdbId: string;
}

async function seedFixtures(db: Db): Promise<Fixture> {
  // --- catalogo ---
  const matrix = await db.q<{ id: bigint }>(`
    INSERT INTO movies (tmdb_id, imdb_id, title_original, original_language, release_date, status, popularity,
                        vote_count_tmdb, poster_path, last_synced_at, created_at, updated_at)
    VALUES (603, 'tt0133093', 'The Matrix', 'en', DATE '1999-03-31', 'Released', 88.5, 25000, '/matrix.jpg',
            (now() AT TIME ZONE 'UTC') - interval '2 days', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    RETURNING id`);
  const matrixId = String(matrix[0]?.id);
  await db.x(`
    INSERT INTO movies (tmdb_id, imdb_id, title_original, original_language, release_date, status, popularity, created_at, updated_at)
    VALUES (604, 'tt0234215', 'The Matrix Reloaded', 'en', DATE '2003-05-15', 'Released', 40.1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')),
           (605, NULL, 'Filme Sem Nada', 'en', NULL, 'Released', 1.0, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  const show = await db.q<{ id: bigint }>(`
    INSERT INTO tv_shows (tmdb_id, imdb_id, name_original, original_language, first_air_date, status,
                          number_of_seasons, number_of_episodes, popularity, poster_path, created_at, updated_at)
    VALUES (1399, NULL, 'Serie Sem IMDb', 'en', DATE '2011-04-17', 'Returning Series', 1, 2, 70.2, '/serie.jpg', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    RETURNING id`);
  const showNoImdbId = String(show[0]?.id);
  const season = await db.q<{ id: bigint }>(`
    INSERT INTO seasons (tv_show_id, tmdb_id, season_number, name, overview, poster_path, created_at, updated_at)
    VALUES (${showNoImdbId}, 3624, 1, 'Temporada 1', 'Visao geral da temporada.', '/t1.jpg', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    RETURNING id`);
  const seasonId = String(season[0]?.id);
  await db.x(`
    INSERT INTO episodes (season_id, tv_show_id, tmdb_id, episode_number, name, overview, still_path, created_at, updated_at)
    VALUES (${seasonId}, ${showNoImdbId}, 63056, 1, 'Episodio 1', 'Resumo 1.', '/e1.jpg', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')),
           (${seasonId}, ${showNoImdbId}, 63057, 2, 'Episodio 2', NULL, NULL, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  await db.x(`
    INSERT INTO people (tmdb_id, name, created_at, updated_at)
    SELECT 100000 + g, 'Pessoa ' || g, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC') FROM generate_series(1, ${PEOPLE}) AS g`);

  await db.x(`
    INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, created_at, updated_at)
    VALUES ('movie', ${matrixId}, 'pt-BR', 'matrix', true, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')),
           ('tv', ${showNoImdbId}, 'pt-BR', 'serie-sem-imdb', true, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  await db.x(`
    INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, created_at, updated_at)
    VALUES ('movie', ${matrixId}, 'pt-BR', 'Matrix', 'Um hacker descobre a verdade sobre a realidade.', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')),
           ('tv', ${showNoImdbId}, 'pt-BR', 'Série Sem IMDb', NULL, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);

  // --- midia: a licenca da FONTE de imagem e dois videos (um vira trailer, outro nao) ---
  const imageLicense = await db.q<{ id: bigint }>(
    `SELECT id FROM source_licenses WHERE source_key = 'tmdb' AND content_type = 'image' AND is_current = true LIMIT 1`,
  );
  if (imageLicense.length === 0) {
    await db.x(`
      INSERT INTO source_licenses (source_key, content_type, provider_key, license_status, display_allowed, logo_allowed,
                                   score_allowed, review_quote_allowed, requires_attribution, requires_linkback,
                                   attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
      VALUES ('tmdb', 'image', 'tmdb', 'licensed', true, false, false, false, true, false,
              'Imagens: TMDB', true, 'validador', (now() AT TIME ZONE 'UTC'), 'ops/v1', (now() AT TIME ZONE 'UTC'))`);
  }
  await db.x(`
    INSERT INTO tmdb_videos (entity_type, tmdb_id, tmdb_video_id, site, video_key, name, video_type, official,
                             language_code, payload_hash, license_status, display_allowed, updated_at)
    VALUES ('movie', 603, 'v-trailer', 'YouTube', 'vKQi3bBA1y8', 'Trailer oficial', 'Trailer', true, 'en', 'h1', 'licensed', true, (now() AT TIME ZONE 'UTC')),
           ('movie', 603, 'v-clip', 'YouTube', 'abcdefghijk', 'Cena', 'Clip', false, 'en', 'h2', 'licensed', true, (now() AT TIME ZONE 'UTC')),
           ('movie', 604, 'v-sem-licenca', 'YouTube', 'lmnopqrstuv', 'Trailer', 'Trailer', true, 'en', 'h3', 'unknown', false, (now() AT TIME ZONE 'UTC'))`);

  // --- nota externa: uma EXIBIVEL (cadeia inteira) e uma recusada ---
  const imdbLicense = await db.q<{ id: bigint }>(
    `SELECT id FROM source_licenses WHERE content_type = 'rating' AND rating_source_key = 'imdb' AND is_current = true LIMIT 1`,
  );
  const imdbLicenseId = String(imdbLicense[0]?.id);
  await db.x(`
    UPDATE source_licenses SET license_status = 'third_party', display_allowed = true, score_allowed = true,
           decided_by = 'validador', decided_at = (now() AT TIME ZONE 'UTC'), policy_version = 'ops/v1', updated_at = (now() AT TIME ZONE 'UTC')
     WHERE id = ${imdbLicenseId}`);
  const decision = await db.q<{ id: bigint }>(`
    INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed,
                                      derivative_allowed, attribution_required, linkback_required, policy_version,
                                      decided_by, reason, is_current, updated_at)
    VALUES (${imdbLicenseId}, 'rating_display', 'BR', 'approved_for_display', true, true, false, true, true, 'ops/v1',
            'validador', 'validador do painel operacional', true, (now() AT TIME ZONE 'UTC'))
    RETURNING id`);
  const decisionId = String(decision[0]?.id);
  const rating = await db.q<{ id: bigint }>(`
    INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale,
                                  rating_count, rating_url, provider_api, fetched_at, attribution_text, attribution_url,
                                  license_status, display_allowed, score_type, requires_attribution, requires_linkback,
                                  data_usage_decision_id, updated_at)
    VALUES ('movie', ${matrixId}, 'imdb', 'IMDb Rating', 'user_rating', 8.7, 10, 2000000,
            'https://www.imdb.com/title/tt0133093/', 'omdb', (now() AT TIME ZONE 'UTC') - interval '1 hour', 'Nota via IMDb',
            'https://www.imdb.com/title/tt0133093/', 'third_party', false, 'audience', true, true, ${decisionId}, (now() AT TIME ZONE 'UTC'))
    RETURNING id`);
  await db.x(`
    UPDATE external_ratings
       SET approved_payload_hash = external_rating_payload_fingerprint_v1(entity_type, entity_id, rating_source, metric,
             score_type, rating_label, rating_value, rating_scale, rating_count, rating_url, provider_api, license_status,
             requires_attribution, requires_linkback, attribution_text, attribution_url),
           reviewed_at = (now() AT TIME ZONE 'UTC'), reviewed_by = 'validador', display_allowed = true
     WHERE id = ${String(rating[0]?.id)}`);
  await db.x(`
    INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale,
                                  provider_api, fetched_at, license_status, display_allowed, score_type, updated_at)
    VALUES ('movie', ${matrixId}, 'metacritic', 'Metascore', 'metascore', 73, 100, 'omdb', (now() AT TIME ZONE 'UTC') - interval '1 hour',
            'unknown', false, 'critics', (now() AT TIME ZONE 'UTC'))`);

  // --- filas: logs do agendador ---
  await db.x(`
    INSERT INTO api_sync_logs (provider_api, endpoint, status, items_processed, duration_ms, quota_cost, created_at)
    VALUES ('tmdb', 'scheduler/trending', 'success', 4, 900, 4, (now() AT TIME ZONE 'UTC') - interval '20 hours'),
           ('tmdb', 'scheduler/people', 'success', 200, 60000, 200, (now() AT TIME ZONE 'UTC') - interval '10 days'),
           ('tmdb', 'scheduler/title_media', 'success', 5, 3000, 10, (now() AT TIME ZONE 'UTC') - interval '2 hours'),
           ('github', 'scheduler/deploy_reference', 'success', 1, 400, 1, (now() AT TIME ZONE 'UTC') - interval '30 minutes')`);
  // --- cota: a OMDb recusou com o nosso contador em 120 ---
  await db.x(`
    INSERT INTO api_sync_logs (provider_api, endpoint, status, error_code, items_processed, quota_cost, created_at)
    VALUES ('omdb', '/', 'success', NULL, 120, 120, (now() AT TIME ZONE 'UTC') - interval '5 minutes'),
           ('omdb', '/', 'failed', 'omdb-quota-exhausted', 0, 0, (now() AT TIME ZONE 'UTC') - interval '4 minutes')`);

  // --- fila de jobs: um pendente velho (represada) ---
  await db.x(`
    INSERT INTO catalog_jobs (job_type, status, entity_type, external_id, payload, idempotency_key, priority, available_at,
                              run_id, created_at, updated_at)
    VALUES ('sync_media', 'pending', 'movie', '999999', '{}'::jsonb, 'validador:represada', 70,
            (now() AT TIME ZONE 'UTC') - interval '30 hours', 'scheduler:title_media', (now() AT TIME ZONE 'UTC') - interval '30 hours', (now() AT TIME ZONE 'UTC'))`);

  // --- servicos e o main ---
  await db.x(`
    INSERT INTO deploy_main_commits (commit_sha, committed_at, title, main_position, digest_method, source_digest,
                                     source_file_count, behind_head_by, behind_head_sha, positions_read_at)
    VALUES (${lit(HEAD_SHA)}, (now() AT TIME ZONE 'UTC') - interval '1 hour', 'feat: cabeca do main', 0, 'git-blob-sha1/v1', ${lit(DIGEST_HEAD)}, 100, 0, ${lit(HEAD_SHA)}, (now() AT TIME ZONE 'UTC')),
           (${lit(OLD_SHA)}, (now() AT TIME ZONE 'UTC') - interval '3 days', 'fix: commit antigo', 3, 'git-blob-sha1/v1', ${lit(DIGEST_OLD)}, 99, 3, ${lit(HEAD_SHA)}, (now() AT TIME ZONE 'UTC'))`);
  // Cada servico com os NOMES que o seu sinal de vida realmente declara
  // (`*_CREDENTIAL_ENV_NAMES` / `credentialEnvNames` de cada entrada). Uma lista
  // unica para todos poria chave de fornecedor no admin — e a captura da tela
  // contradiria o `admin-deploy.md` ("o admin nao recebe credencial de fornecedor").
  const creds = (entries: ReadonlyArray<readonly [string, string]>): string =>
    lit(JSON.stringify(entries.map(([name, format]) => ({ name, present: format !== "ausente" && format !== "vazia", format }))));
  const credApp = creds([["DATABASE_URL", "url"], ["CINERIE_IP_HASH_SALT", "hex"], ["CINERIE_CATALOG_RESOLVE_API_KEYS", "outra"]]);
  const credCron = creds([["DATABASE_URL", "url"], ["TMDB_READ_ACCESS_TOKEN", "jwt"], ["TMDB_API_KEY", "ausente"], ["OMDB_API_KEY", "hex"], ["CINERIE_GITHUB_TOKEN", "ausente"]]);
  const credWorker = creds([["DATABASE_URL", "url"], ["TMDB_READ_ACCESS_TOKEN", "jwt"], ["TMDB_API_KEY", "ausente"]]);
  const credPublication = creds([["SCREEN_DATABASE_URL", "url"], ["PAYLOAD_INTERNAL_SERVICE_URL", "url"], ["PAYLOAD_PROJECTION_API_KEY", "outra"]]);
  const credAdmin = creds([["DATABASE_URL", "url"], ["ADMIN_BASIC_AUTH_USER", "alfanumerica"], ["ADMIN_BASIC_AUTH_PASSWORD", "outra"], ["ADMIN_OPERATOR_LABEL", "outra"]]);
  await db.x(`
    INSERT INTO service_heartbeats (service_key, instance_id, started_at, last_seen_at, digest_method, source_digest,
                                    source_file_count, build_id, node_version, rss_bytes, heap_used_bytes, cpu_percent, credentials)
    VALUES ('screen-app', 'app-1', (now() AT TIME ZONE 'UTC') - interval '2 days', (now() AT TIME ZONE 'UTC') - interval '30 seconds', 'git-blob-sha1/v1', ${lit(DIGEST_HEAD)}, 100, 'build-app', 'v22.11.0', 314572800, 104857600, 3.5, ${credApp}::jsonb),
           ('screen-cron', 'cron-1', (now() AT TIME ZONE 'UTC') - interval '3 days', (now() AT TIME ZONE 'UTC') - interval '10 minutes', 'git-blob-sha1/v1', ${lit(DIGEST_HEAD)}, 100, NULL, 'v22.11.0', 209715200, 52428800, 1.0, ${credCron}::jsonb),
           ('screen-catalog-worker', 'worker-1', (now() AT TIME ZONE 'UTC') - interval '1 day', (now() AT TIME ZONE 'UTC') - interval '20 seconds', 'git-blob-sha1/v1', ${lit(DIGEST_OLD)}, 99, NULL, 'v22.11.0', 157286400, 41943040, 12.0, ${credWorker}::jsonb),
           ('cinerie-publication-worker', 'pub-1', (now() AT TIME ZONE 'UTC') - interval '1 day', (now() AT TIME ZONE 'UTC') - interval '15 seconds', 'git-blob-sha1/v1', ${lit(DIGEST_HEAD)}, 100, NULL, 'v22.11.0', 104857600, 20971520, 0.5, ${credPublication}::jsonb),
           ('cinerie-admin', 'admin-1', (now() AT TIME ZONE 'UTC') - interval '1 hour', (now() AT TIME ZONE 'UTC') - interval '10 seconds', 'git-blob-sha1/v1', ${lit(DIGEST_ORPHAN)}, 101, 'build-admin', 'v22.11.0', 104857600, 20971520, 0.2, ${credAdmin}::jsonb)`);

  // --- usuarios ---
  await db.x(`
    INSERT INTO users (email, email_normalized, handle, status, email_verified_at, created_at, updated_at)
    VALUES (${lit(EMAILS[0])}, ${lit(EMAILS[0])}, 'ana', 'active', (now() AT TIME ZONE 'UTC') - interval '20 days', (now() AT TIME ZONE 'UTC') - interval '20 days', (now() AT TIME ZONE 'UTC')),
           (${lit(EMAILS[1])}, ${lit(EMAILS[1])}, 'bruno', 'active', NULL, (now() AT TIME ZONE 'UTC') - interval '15 days', (now() AT TIME ZONE 'UTC')),
           (${lit(EMAILS[2])}, ${lit(EMAILS[2])}, NULL, 'active', NULL, (now() AT TIME ZONE 'UTC') - interval '1 day', (now() AT TIME ZONE 'UTC'))`);
  await db.x(`
    INSERT INTO user_auth_audit_logs (user_id, action, created_at)
    SELECT id, 'login_succeeded', (now() AT TIME ZONE 'UTC') - interval '1 day' FROM users WHERE email = ${lit(EMAILS[0])}`);
  await db.x(`
    INSERT INTO user_ratings (user_id, entity_type, entity_id, value, scale, created_at, updated_at)
    SELECT id, 'movie', ${matrixId}, 4.5, 5, (now() AT TIME ZONE 'UTC') - interval '10 days', (now() AT TIME ZONE 'UTC') - interval '10 days' FROM users WHERE email = ${lit(EMAILS[1])}`);

  return { matrixId, showNoImdbId };
}

// ------------------------------------------------------------------ http
interface Page {
  readonly status: number;
  readonly html: string;
  readonly headers: Headers;
}

const collected: string[] = [];

async function fetchPage(base: string, route: string, auth = true): Promise<Page> {
  const res = await fetch(`${base}${route}`, {
    headers: auth ? { authorization: AUTH } : {},
    redirect: "manual",
  });
  const html = await res.text();
  if (auth) collected.push(html);
  return { status: res.status, html, headers: res.headers };
}

function metric(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`data-metric="${escaped}"[^>]*>([^<]*)<`).exec(html);
  return match === null ? null : decode(match[1] as string);
}

function rowRed(html: string, attr: string, key: string): string | null {
  const match = new RegExp(`<tr[^>]*${attr}="${key}"[^>]*data-red="(sim|nao)"`).exec(html);
  return match === null ? null : (match[1] as string);
}

function parseForm(html: string, marker: string): Map<string, string> | null {
  const at = html.indexOf(`data-force-form="${marker}"`);
  if (at < 0) return null;
  const start = html.lastIndexOf("<form", at);
  const end = html.indexOf("</form>", at);
  const chunk = html.slice(start, end);
  const fields = new Map<string, string>();
  for (const match of chunk.matchAll(/<input([^>]*)>/g)) {
    const attrs = match[1] as string;
    const name = /name="([^"]*)"/.exec(attrs)?.[1];
    if (name === undefined) continue;
    fields.set(decode(name), decode(/value="([^"]*)"/.exec(attrs)?.[1] ?? ""));
  }
  return fields;
}

async function submitForm(base: string, route: string, fields: Map<string, string>): Promise<{ status: number; location: string | null }> {
  const body = new FormData();
  for (const [key, value] of fields) body.append(key, value);
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    body,
    headers: { authorization: AUTH, origin: base },
    redirect: "manual",
  });
  await res.text();
  return { status: res.status, location: res.headers.get("location") };
}

// ------------------------------------------------------------------ capturas
function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => typeof value === "string" && value !== "");
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Proxy local que acrescenta a credencial: o navegador nao precisa dela na URL. */
function startAuthProxy(targetPort: number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const upstream = httpRequest(
        {
          host: "127.0.0.1",
          port: targetPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${targetPort}`, authorization: AUTH },
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

/**
 * Roda o Chrome SEM bloquear este processo. O proxy de credencial vive AQUI: com
 * `spawnSync` o laco de eventos congela, o proxy nunca responde a requisicao do
 * proprio Chrome, e cada captura esperava o teto e saia sem arquivo (medido em
 * 2026-09-15: nenhum PNG, enquanto o mesmo Chrome capturava uma URL `data:`).
 */
function runChrome(chrome: string, args: readonly string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(chrome, [...args], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    child.on("error", done);
    child.on("exit", done);
  });
}

async function captureScreens(appPort: number, routes: ReadonlyArray<readonly [string, string]>, outDir: string): Promise<void> {
  const chrome = findChrome();
  if (chrome === null) {
    record("capturas das telas", false, "Chrome/Edge nao encontrado (defina CHROME_PATH)");
    return;
  }
  mkdirSync(outDir, { recursive: true });
  const proxy = await startAuthProxy(appPort);
  const profile = mkdtempSync(path.join(tmpdir(), "cinerie-ops-chrome-"));
  try {
    for (const [name, route] of routes) {
      const file = path.join(outDir, `${name}.png`);
      rmSync(file, { force: true });
      await runChrome(chrome, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profile}`,
        "--window-size=1440,2200",
        "--virtual-time-budget=8000",
        `--screenshot=${file}`,
        `http://127.0.0.1:${proxy.port}${route}`,
      ]);
      const size = existsSync(file) ? statSync(file).size : 0;
      record(`captura ${name} (${route})`, size > 10_000, size > 0 ? `${formatInt(size)} bytes em ${file}` : "arquivo nao gerado");
    }
  } finally {
    proxy.server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// ------------------------------------------------------------------ main
async function main(): Promise<void> {
  const pgPort = await freePort();
  const appPort = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-ops-panel-pg-"));
  const dbName = "cinerie_ops_panel";
  const url = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/${dbName}?schema=public`;
  if (!/@127\.0\.0\.1:/.test(url) || !url.includes(dbName)) throw new Error("abort: banco de validacao nao e local");

  // O PostgreSQL deste validador roda FORA de UTC de proposito (a CI ja roda em
  // UTC e esconderia leitura que depende do fuso da sessao). O app grava e le
  // `timestamp` sem fuso em UTC; se alguma consulta comparar sem converter, a
  // linha de "ontem 23h UTC" do teste de cota entra em "hoje" e ele reprova.
  const newPg = (utf8: boolean): EmbeddedPostgres =>
    new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port: pgPort,
      persistent: true,
      initdbFlags: utf8 ? ["--encoding=UTF8", "--locale=C"] : [],
      postgresFlags: ["-c", `timezone=${VALIDATOR_TIME_ZONE}`],
    });
  let pg = newPg(true);
  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  let server: ChildProcess | undefined;
  const serverLog: string[] = [];

  console.log(`\n=== Postgres efemero :${pgPort} | admin (Next real) :${appPort} ===\n`);

  try {
    try {
      await pg.initialise();
    } catch (error) {
      const reason = (error as Error).message.split("\n")[0] ?? "";
      if (!/invalid byte sequence|encoding/i.test(reason)) throw error;
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
      mkdirSync(dataDir, { recursive: true });
      pg = newPg(false);
      await pg.initialise();
    }
    await pg.start();
    started = true;
    await pg.createDatabase(dbName);

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };
    await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });
    await runChild("node", [prismaBin(), "db", "seed", "--schema", dbSchema], { env, stdio: "inherit", cwd: dbDir });

    const dbServer = (await import("@screena/db/server")) as unknown as {
      getPrismaClient: () => {
        $executeRawUnsafe: (sql: string) => Promise<number>;
        $queryRawUnsafe: <T>(sql: string) => Promise<T[]>;
      };
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const prisma = dbServer.getPrismaClient();
    const db: Db = { q: (s) => prisma.$queryRawUnsafe(s), x: (s) => prisma.$executeRawUnsafe(s) };

    const fixture = await seedFixtures(db);

    // O job que o AGENDADOR ja enfileirou para o Matrix: o do painel nao pode colidir com ele.
    const { buildCoverageJob } = await import("../../../services/ingestion/src/entity-coverage/entry");
    const { createPrismaCatalogJobStore } = await import("../../../services/ingestion/src/persistence/catalog-job-store");
    const today = new Date().toISOString().slice(0, 10);
    const scheduledJob = buildCoverageJob({
      kind: "movie",
      tmdbId: 603,
      locale: "pt-BR",
      reason: "scheduled",
      scope: `title_detail_ended:${today}`,
      runId: "scheduler:title_detail_ended",
    });
    await createPrismaCatalogJobStore(prisma as never).enqueue(scheduledJob);

    // O retrato de hoje, gravado pela MESMA medida que a fila catalog_coverage usa.
    const coverage = await import("@screena/sync/coverage");
    const measurement = await coverage.measureCatalogCoverage(prisma as never, new Date());
    await coverage.writeCoverageSnapshot(prisma as never, measurement);
    await db.x("ANALYZE");
    record("fixtures semeadas", true, `filme ${fixture.matrixId}, serie ${fixture.showNoImdbId}, ${PEOPLE} pessoas, 3 usuarios`);

    // ------------------------------------------------------------ Next real
    const nextBin = adminRequire.resolve("next/dist/bin/next");
    server = spawn("node", [nextBin, "start", "-p", String(appPort), "-H", "127.0.0.1"], {
      cwd: adminDir,
      env: {
        ...env,
        NODE_ENV: "production",
        ADMIN_BASIC_AUTH_USER: USER,
        ADMIN_BASIC_AUTH_PASSWORD: PASS,
        ADMIN_OPERATOR_LABEL: "validador-do-painel",
        CINERIE_HEARTBEAT_DISABLED: "true",
        OMDB_API_KEY: SECRET_OMDB,
        TMDB_READ_ACCESS_TOKEN: SECRET_TMDB,
        CINERIE_GITHUB_TOKEN: SECRET_GITHUB,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk: Buffer) => {
      serverLog.push(chunk.toString());
      process.stdout.write(`[admin] ${chunk.toString()}`);
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      serverLog.push(chunk.toString());
      process.stderr.write(`[admin] ${chunk.toString()}`);
    });

    const base = `http://127.0.0.1:${appPort}`;
    const deadline = Date.now() + 120_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/`, { redirect: "manual" });
        if (res.status === 401 || res.status === 200) {
          up = true;
          break;
        }
      } catch {
        /* subindo */
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    record("Next.js real do admin respondendo", up, up ? base : "timeout 120 s (rodou pnpm build:admin?)");
    if (!up) throw new Error("next start do admin nao respondeu");

    const matrixPath = `/titulos/filme/${fixture.matrixId}`;
    const showPath = `/titulos/serie/${fixture.showNoImdbId}`;
    const routes = [
      "/",
      "/filas",
      "/filas/people",
      "/filas/people/forcar",
      "/cotas",
      "/servicos",
      "/cobertura",
      "/titulos?q=Matrix",
      matrixPath,
      `${matrixPath}/forcar/detalhe`,
      showPath,
      "/usuarios",
      "/logs",
      "/logs?aba=jobs",
      "/acoes",
      "/editorial",
    ];

    // ------------------------------------------------------------ (4) acesso e indice
    const blocked: string[] = [];
    const robotsMissing401: string[] = [];
    for (const route of routes) {
      const res = await fetchPage(base, route, false);
      if (res.status !== 401) blocked.push(`${route}=${res.status}`);
      if (!(res.headers.get("x-robots-tag") ?? "").includes("noindex")) robotsMissing401.push(route);
    }
    record("SEM credencial: toda rota do painel responde 401, por requisicao", blocked.length === 0, blocked.length === 0 ? `${routes.length} rotas, todas 401` : blocked.join(" "));
    record("o 401 tambem sai com X-Robots-Tag noindex", robotsMissing401.length === 0, robotsMissing401.join(" ") || "todas");
    const wrong = await fetch(`${base}/`, { headers: { authorization: `Basic ${Buffer.from(`${USER}:errada`).toString("base64")}` }, redirect: "manual" });
    record("CONTROLE: senha errada tambem e 401", wrong.status === 401, `status=${wrong.status}`);

    const notOk: string[] = [];
    const noMeta: string[] = [];
    const pages = new Map<string, Page>();
    for (const route of routes) {
      const res = await fetchPage(base, route);
      pages.set(route, res);
      if (res.status !== 200) notOk.push(`${route}=${res.status}`);
      const meta = /<meta name="robots" content="([^"]*)"/.exec(res.html)?.[1] ?? "";
      if (!meta.includes("noindex") || !(res.headers.get("x-robots-tag") ?? "").includes("noindex")) noMeta.push(route);
    }
    record("COM credencial: toda rota responde 200", notOk.length === 0, notOk.length === 0 ? `${routes.length} rotas` : notOk.join(" "));
    record("toda rota tem meta robots noindex E cabecalho X-Robots-Tag", noMeta.length === 0, noMeta.join(" ") || "todas");
    const robotsTxt = await fetchPage(base, "/robots.txt");
    record("robots.txt do painel: Disallow: /", robotsTxt.status === 200 && /Disallow:\s*\/\s*$/m.test(robotsTxt.html), robotsTxt.html.trim().replace(/\s+/g, " "));
    const sitemap = await fetchPage(base, "/sitemap.xml");
    record("o painel nao tem sitemap (/sitemap.xml = 404)", sitemap.status === 404, `status=${sitemap.status}`);

    // ------------------------------------------------------------ (1)(2) numeros com controle
    // CONTROLE da prova de fuso: se `postgresFlags` fosse ignorado em silencio, o
    // banco ficaria no fuso da maquina — UTC na CI — e a linha de ontem abaixo
    // passaria sem provar nada.
    const serverTimeZone = (await db.q<{ tz: string }>("SELECT current_setting('TimeZone') AS tz"))[0]?.tz ?? "";
    record("CONTROLE: o PostgreSQL do validador roda FORA de UTC", serverTimeZone === VALIDATOR_TIME_ZONE, `TimeZone=${serverTimeZone}`);
    // Linha de ONTEM, 1 h antes da virada do dia UTC, com custo alto. O PostgreSQL
    // deste validador roda em America/Sao_Paulo (UTC-3) de proposito: uma leitura
    // que comparasse `created_at` (timestamp sem fuso, gravado em UTC) com um
    // parametro `timestamptz` sem converter empurraria esta linha 3 h para a frente,
    // para dentro de HOJE, e a tela diria 620. Com a conversao explicita, 120.
    await db.x(`INSERT INTO api_sync_logs (provider_api, endpoint, status, items_processed, quota_cost, created_at) VALUES ('omdb', '/', 'success', 500, 500, date_trunc('day', (now() AT TIME ZONE 'UTC')) - interval '1 hour')`);
    const cotas1 = (await fetchPage(base, "/cotas")).html;
    record("cota: gasto de hoje da OMDb = soma de quota_cost de HOJE (120; os 500 de ontem, 23h UTC, ficam fora)", metric(cotas1, "quota.omdb.spent_today") === "120", `tela: ${metric(cotas1, "quota.omdb.spent_today")}`);
    await db.x(`INSERT INTO api_sync_logs (provider_api, endpoint, status, items_processed, quota_cost, created_at) VALUES ('omdb', '/', 'success', 30, 30, (now() AT TIME ZONE 'UTC'))`);
    const cotas2 = (await fetchPage(base, "/cotas")).html;
    record("CONTROLE: +30 no banco -> a tela diz 150 (nao e numero cravado)", metric(cotas2, "quota.omdb.spent_today") === "150", `tela: ${metric(cotas2, "quota.omdb.spent_today")}`);
    record(
      "VERMELHO: recusa da OMDb com o contador abaixo do teto diz que o contador subconta",
      cotas2.includes('data-provider-red="omdb"') && cotas2.includes("subcontando"),
      cotas2.includes("subcontando") ? "alerta presente" : "alerta AUSENTE",
    );
    record("CONTROLE: o tmdb, sem recusa, nao fica vermelho", !cotas2.includes('data-provider-red="tmdb"'), "sem alerta para tmdb");

    const usuarios1 = (await fetchPage(base, "/usuarios")).html;
    record("usuarios: total = 3", metric(usuarios1, "users.total") === "3", `tela: ${metric(usuarios1, "users.total")}`);
    record("usuarios: ativos em 7 dias = 1 (login) e em 30 dias = 2 (login + nota)", metric(usuarios1, "users.active7") === "1" && metric(usuarios1, "users.active30") === "2", `7d=${metric(usuarios1, "users.active7")} 30d=${metric(usuarios1, "users.active30")}`);
    await db.x(`INSERT INTO users (email, email_normalized, status, created_at, updated_at) VALUES ('davi@exemplo.test', 'davi@exemplo.test', 'active', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
    const usuarios2 = (await fetchPage(base, "/usuarios")).html;
    record("CONTROLE: +1 usuario -> total 4", metric(usuarios2, "users.total") === "4", `tela: ${metric(usuarios2, "users.total")}`);
    record("usuarios: 'nao implementado' no lugar de zero para o que nao existe", usuarios2.includes("não implementado"), "texto presente");

    // ------------------------------------------------------------ (2) todo verde pode ficar vermelho
    const filas = (await fetchPage(base, "/filas")).html;
    const peopleCount = Number((await db.q<{ n: bigint }>("SELECT count(*) AS n FROM people"))[0]?.n ?? 0);
    const expectedLap = formatDays(peopleCount / (200 * (24 / 720)));
    record("universo de people = count(*) de people", metric(filas, "queue.people.universe") === formatInt(peopleCount), `tela: ${metric(filas, "queue.people.universe")} banco: ${peopleCount}`);
    record(
      `VERMELHO: people com volta declarada de ${expectedLap}, escrita e destacada`,
      metric(filas, "queue.people.lap_declared") === expectedLap && rowRed(filas, "data-queue", "people") === "sim",
      `volta: ${metric(filas, "queue.people.lap_declared")} linha vermelha: ${rowRed(filas, "data-queue", "people")}`,
    );
    record("CONTROLE: title_media (volta curta, rodou ha 2 h) NAO fica vermelha", rowRed(filas, "data-queue", "title_media") === "nao", `linha: ${rowRed(filas, "data-queue", "title_media")}`);
    record("VERMELHO: trending sem sucesso ha 20 h (intervalo 6 h) = PARADA", rowRed(filas, "data-queue", "trending") === "sim" && filas.includes("PARADA"), `linha: ${rowRed(filas, "data-queue", "trending")}`);
    record("fila de jobs: sync_media com pendente de 30 h = REPRESADA", filas.includes("REPRESADA"), filas.includes("REPRESADA") ? "presente" : "AUSENTE");

    const servicos = (await fetchPage(base, "/servicos")).html;
    record(
      "VERMELHO: worker de catalogo rodando commit 3 atras do main",
      (metric(servicos, "service.screen-catalog-worker.version") ?? "").includes("3 COMMIT") && rowRed(servicos, "data-service", "screen-catalog-worker") === "sim",
      `tela: ${metric(servicos, "service.screen-catalog-worker.version")}`,
    );
    record(
      "CONTROLE: publication worker com a MESMA arvore da cabeca fica verde",
      metric(servicos, "service.cinerie-publication-worker.version") === "igual à cabeça do main" && rowRed(servicos, "data-service", "cinerie-publication-worker") === "nao",
      `tela: ${metric(servicos, "service.cinerie-publication-worker.version")}`,
    );
    // "ha 10 min", nao "ha 3,2 h": o sinal gravado ha 10 min em UTC nao pode
    // envelhecer 3 h porque o banco roda em outro fuso (medido antes da correcao).
    const cronLiveness = metric(servicos, "service.screen-cron.liveness") ?? "";
    const cronMinutes = Number(/há (\d+) min/.exec(cronLiveness)?.[1] ?? Number.NaN);
    record(
      "VERMELHO: screen-cron sem sinal ha 10 min (e a tela diz minutos, nao horas)",
      cronLiveness.includes("SEM SINAL") && cronMinutes >= 10 && cronMinutes < 30,
      `tela: ${cronLiveness}`,
    );
    record("VERMELHO: arvore sem commit correspondente (admin)", (metric(servicos, "service.cinerie-admin.version") ?? "").includes("SEM COMMIT"), `tela: ${metric(servicos, "service.cinerie-admin.version")}`);
    record("credenciais: nome e formato na tela, nunca valor", servicos.includes("OMDB_API_KEY") && !servicos.includes(SECRET_OMDB), "nome presente, valor ausente");

    const overview = (await fetchPage(base, "/")).html;
    const brokenCount = Number(/data-broken-count="(\d+)"/.exec(overview)?.[1] ?? "0");
    const expectedBroken = ["trending", "people", "omdb", "screen-cron", "screen-catalog-worker", "sync_media"];
    const missingBroken = expectedBroken.filter((token) => !new RegExp(`class="ops-broken__list"[\\s\\S]*${token}`).test(overview));
    record("visao geral: o que esta quebrado agora lista cada vermelho das telas", brokenCount > 0 && missingBroken.length === 0, `${brokenCount} item(ns); faltando: ${missingBroken.join(",") || "nenhum"}`);

    // ------------------------------------------------------------ (3) cobertura SQL x portao TS
    const liveHtml = (await fetchPage(base, "/cobertura?medir=agora")).html;
    const tsCounts = async (): Promise<{ trailer: number; rating: number }> => {
      const videos = await db.q<{ tmdb_id: number; display_allowed: boolean; license_status: string; site: string; video_type: string | null; video_key: string }>(
        `SELECT v.tmdb_id, v.display_allowed, v.license_status::text AS license_status, v.site, v.video_type, v.video_key FROM tmdb_videos v WHERE v.entity_type = 'movie'`,
      );
      const withTrailer = new Set(
        videos
          .filter((v) => explainTrailerRow({ displayAllowed: v.display_allowed, licenseStatus: v.license_status, site: v.site, videoType: v.video_type, videoKey: v.video_key }).visible)
          .map((v) => v.tmdb_id),
      );
      const movieTmdb = new Set((await db.q<{ tmdb_id: number }>("SELECT tmdb_id FROM movies")).map((m) => m.tmdb_id));
      const ratings = await db.q<{
        entity_id: bigint; rating_source: string; display_allowed: boolean; score_type: string | null; rating_value: string; fetched_at: Date | null;
        requires_attribution: boolean; attribution_text: string | null; requires_linkback: boolean; attribution_url: string | null;
        d_id: bigint | null; use_case: string | null; d_current: boolean | null; stage: string | null; d_display: boolean | null; territory: string | null; valid_from: Date | null; valid_until: Date | null;
        l_current: boolean | null; l_status: string | null; l_display: boolean | null; score_allowed: boolean | null; content_type: string | null; rating_source_key: string | null;
      }>(`
        SELECT r.entity_id, r.rating_source, r.display_allowed, r.score_type::text AS score_type, r.rating_value::text AS rating_value, r.fetched_at,
               r.requires_attribution, r.attribution_text, r.requires_linkback, r.attribution_url,
               d.id AS d_id, d.use_case, d.is_current AS d_current, d.stage::text AS stage, d.display_allowed AS d_display, d.territory, d.valid_from, d.valid_until,
               l.is_current AS l_current, l.license_status::text AS l_status, l.display_allowed AS l_display, l.score_allowed, l.content_type::text AS content_type, l.rating_source_key
          FROM external_ratings r
          LEFT JOIN data_usage_decisions d ON d.id = r.data_usage_decision_id
          LEFT JOIN source_licenses l ON l.id = d.source_license_id
         WHERE r.entity_type = 'movie'`);
      const now = new Date();
      const withRating = new Set(
        ratings
          .filter((r) =>
            explainRatingRow(
              {
                ratingSource: r.rating_source,
                rowDisplayAllowed: r.display_allowed,
                scoreType: r.score_type,
                ratingValue: Number(r.rating_value),
                fetchedAt: r.fetched_at,
                requiresAttribution: r.requires_attribution,
                attributionText: r.attribution_text,
                requiresLinkback: r.requires_linkback,
                attributionUrl: r.attribution_url,
                decision:
                  r.d_id === null
                    ? null
                    : { useCase: r.use_case ?? "", isCurrent: r.d_current === true, stage: r.stage ?? "", displayAllowed: r.d_display === true, territory: r.territory, validFrom: r.valid_from ?? now, validUntil: r.valid_until },
                license:
                  r.d_id === null || r.l_status === null
                    ? null
                    : { isCurrent: r.l_current === true, licenseStatus: r.l_status, displayAllowed: r.l_display === true, scoreAllowed: r.score_allowed === true, contentType: r.content_type ?? "", ratingSourceKey: r.rating_source_key },
              },
              now,
            ).visible,
          )
          .map((r) => String(r.entity_id)),
      );
      return { trailer: [...withTrailer].filter((id) => movieTmdb.has(id)).length, rating: withRating.size };
    };
    const ts1 = await tsCounts();
    const sqlTrailer1 = metric(liveHtml, "coverage.movie.*.withTrailer");
    const sqlRating1 = metric(liveHtml, "coverage.movie.*.withDisplayableRating");
    record("cobertura: filmes com trailer — SQL da tela = portao da pagina linha a linha", sqlTrailer1 === formatInt(ts1.trailer), `tela ${sqlTrailer1} | portao ${ts1.trailer}`);
    record("cobertura: filmes com nota exibivel — SQL da tela = portao da pagina linha a linha", sqlRating1 === formatInt(ts1.rating), `tela ${sqlRating1} | portao ${ts1.rating}`);
    await db.x(`UPDATE tmdb_videos SET display_allowed = false WHERE tmdb_video_id = 'v-trailer'`);
    const ts2 = await tsCounts();
    const sqlTrailer2 = metric((await fetchPage(base, "/cobertura?medir=agora")).html, "coverage.movie.*.withTrailer");
    record("CONTROLE: o trailer deixa de passar -> os DOIS numeros caem juntos", ts2.trailer === ts1.trailer - 1 && sqlTrailer2 === formatInt(ts2.trailer), `tela ${sqlTrailer2} | portao ${ts2.trailer}`);
    await db.x(`UPDATE tmdb_videos SET display_allowed = true WHERE tmdb_video_id = 'v-trailer'`);

    // ------------------------------------------------------------ ficha do titulo
    const ficha = (await fetchPage(base, matrixPath)).html;
    record("ficha: a nota IMDb aparece; o Metacritic (licenca unknown) nao, com motivo", /data-rating="imdb" data-visible="sim"/.test(ficha) && /data-rating="metacritic" data-visible="nao"/.test(ficha), "vereditos por linha presentes");
    // O veredito e um SELO dentro do paragrafo marcado: `metric()` leria o texto
    // vazio antes do selo. Confere-se a frase inteira.
    record("ficha: o trailer licenciado vira trailer na pagina", ficha.includes("a página tem trailer"), ficha.includes("a página tem trailer") ? "presente" : "AUSENTE");
    const fichaSerie = (await fetchPage(base, showPath)).html;
    record("ficha: serie sem imdb_id diz AUSENTE e por que a OMDb nao alcanca", fichaSerie.includes("AUSENTE") && fichaSerie.includes("OMDb"), "presente");

    // ------------------------------------------------------------ (6) o botao enfileira
    const jobsBefore = Number((await db.q<{ n: bigint }>("SELECT count(*) AS n FROM catalog_jobs"))[0]?.n ?? 0);
    const confirm1 = await fetchPage(base, `${matrixPath}/forcar/detalhe`);
    const form1 = parseForm(confirm1.html, "titulo");
    record("tela de confirmacao mostra o custo ANTES e o formulario", form1 !== null && /data-cost-requests="3"/.test(confirm1.html), `custo: ${/data-cost-requests="([^"]*)"/.exec(confirm1.html)?.[1] ?? "(ausente)"}`);
    if (form1 !== null) {
      const token = form1.get("token") ?? "";
      const post1 = await submitForm(base, `${matrixPath}/forcar/detalhe`, form1);
      record("confirmar redireciona para a auditoria da acao", post1.status === 303 && /\/acoes\/\d+$/.test(post1.location ?? ""), `status=${post1.status} location=${post1.location}`);
      const created = await db.q<{ idempotency_key: string; priority: number; run_id: string }>(
        `SELECT idempotency_key, priority, run_id FROM catalog_jobs WHERE run_id = ${lit(`admin:${token}`)}`,
      );
      const scheduledStill = await db.q<{ n: bigint }>(`SELECT count(*) AS n FROM catalog_jobs WHERE idempotency_key = ${lit(scheduledJob.idempotencyKey)}`);
      record(
        "o job NOVO existe, com escopo proprio e prioridade 10",
        created.length === 1 && created[0]?.idempotency_key === `sync_details:movie:603:pt-BR:admin:${token}` && created[0]?.priority === 10,
        created.map((row) => `${row.idempotency_key} p${row.priority}`).join(" ") || "nenhum",
      );
      record("CONTROLE de colisao: o job do agendador segue intacto e e OUTRA chave", Number(scheduledStill[0]?.n ?? 0) === 1 && scheduledJob.idempotencyKey !== created[0]?.idempotency_key, `agendador: ${scheduledJob.idempotencyKey}`);
      const audit = await db.q<{ outcome: string; actor_label: string; estimate: { requests?: number } }>(`SELECT outcome, actor_label, estimate FROM admin_action_audits WHERE request_token = ${lit(token)}`);
      record("auditoria gravada na mesma transacao: enfileirado, com o custo mostrado", audit[0]?.outcome === "enqueued" && audit[0]?.estimate?.requests === 3 && audit[0]?.actor_label === "validador-do-painel", JSON.stringify(audit[0] ?? null));

      const post2 = await submitForm(base, `${matrixPath}/forcar/detalhe`, form1);
      const jobsAfterRepeat = Number((await db.q<{ n: bigint }>("SELECT count(*) AS n FROM catalog_jobs"))[0]?.n ?? 0);
      record("o MESMO formulario enviado de novo e UMA acao: nenhum job novo, mesma auditoria", post2.location === post1.location && jobsAfterRepeat === jobsBefore + 1, `jobs antes ${jobsBefore} depois ${jobsAfterRepeat}`);

      const form2 = parseForm((await fetchPage(base, `${matrixPath}/forcar/detalhe`)).html, "titulo");
      if (form2 !== null) {
        await submitForm(base, `${matrixPath}/forcar/detalhe`, form2);
        const second = await db.q<{ outcome: string }>(`SELECT outcome FROM admin_action_audits WHERE request_token = ${lit(form2.get("token") ?? "")}`);
        const jobsAfterSecond = Number((await db.q<{ n: bigint }>("SELECT count(*) AS n FROM catalog_jobs"))[0]?.n ?? 0);
        record("outra confirmacao com o pedido do painel ainda aberto: 'ja estava na fila', sem job novo", second[0]?.outcome === "already_enqueued" && jobsAfterSecond === jobsBefore + 1, `desfecho: ${second[0]?.outcome}`);
      }
    }
    const semTemporadas = (await fetchPage(base, `${matrixPath}/forcar/temporadas`)).html;
    record("CONTROLE: temporadas de FILME nao oferece botao (recusa com motivo)", parseForm(semTemporadas, "titulo") === null && semTemporadas.includes("filme não tem temporadas"), "sem formulario");
    const semNota = (await fetchPage(base, `${showPath}/forcar/nota`)).html;
    record("CONTROLE: nota de titulo sem imdb_id nao oferece botao", parseForm(semNota, "titulo") === null && semNota.includes("sem imdb_id"), "sem formulario");

    const filaForm = parseForm((await fetchPage(base, "/filas/people/forcar")).html, "fila");
    if (filaForm === null) {
      record("forcar fila: formulario presente", false, "ausente");
    } else {
      const postFila = await submitForm(base, "/filas/people/forcar", filaForm);
      const pedidos = await db.q<{ n: bigint }>(`SELECT count(*) AS n FROM scheduler_force_requests WHERE kind = 'queue' AND queue = 'people' AND status = 'pending'`);
      record("forcar fila grava UM pedido pendente para o screen-cron", postFila.status === 303 && Number(pedidos[0]?.n ?? 0) === 1, `status=${postFila.status} pedidos=${pedidos[0]?.n}`);
      const filaForm2 = parseForm((await fetchPage(base, "/filas/people/forcar")).html, "fila");
      if (filaForm2 === null) {
        const detalhe = (await fetchPage(base, "/filas/people")).html;
        record("com pedido aberto, a fila mostra o pedido em vez de um segundo botao", detalhe.includes("já há o pedido"), "pedido aberto visivel");
      } else {
        await submitForm(base, "/filas/people/forcar", filaForm2);
        const pedidos2 = await db.q<{ n: bigint }>(`SELECT count(*) AS n FROM scheduler_force_requests WHERE kind = 'queue' AND queue = 'people' AND status IN ('pending', 'running')`);
        record("segundo pedido para a mesma fila nao cria outro (um aberto por alvo)", Number(pedidos2[0]?.n ?? 0) === 1, `abertos=${pedidos2[0]?.n}`);
      }
    }

    // ------------------------------------------------------------ (5) segredos
    for (const route of ["/acoes", "/filas/people", matrixPath]) collected.push((await fetchPage(base, route)).html);
    const allHtml = collected.join("\n");
    const leaks = [
      ["senha do Basic Auth", PASS],
      ["connection string", "postgres:postgres@"],
      ["segredo da OMDb", SECRET_OMDB],
      ["token do TMDB", SECRET_TMDB],
      ["token do GitHub", SECRET_GITHUB],
    ].filter(([, value]) => allHtml.includes(value as string));
    record("nenhum segredo no HTML de nenhuma tela", leaks.length === 0, leaks.length === 0 ? `${collected.length} respostas varridas` : leaks.map(([name]) => name).join(", "));
    const logText = serverLog.join("");
    const logLeaks = [PASS, SECRET_OMDB, SECRET_TMDB, SECRET_GITHUB, ...EMAILS].filter((value) => logText.includes(value));
    record("nenhum segredo nem e-mail no log do servidor", logLeaks.length === 0, logLeaks.length === 0 ? `${formatInt(logText.length)} caracteres de log varridos` : `${logLeaks.length} ocorrencia(s)`);
    const emailsOutside = [...pages.entries()].filter(([route, page]) => route !== "/usuarios" && EMAILS.some((email) => page.html.includes(email))).map(([route]) => route);
    record("e-mail so aparece na tela de usuarios", emailsOutside.length === 0, emailsOutside.join(" ") || "nenhuma outra tela");

    // ------------------------------------------------------------ (7) capturas
    const shotsDir = process.env.CINERIE_OPS_SCREENSHOTS_DIR;
    if (shotsDir !== undefined && shotsDir.trim() !== "") {
      await captureScreens(
        appPort,
        [
          ["01-visao-geral", "/"],
          ["02-filas", "/filas"],
          ["03-fila-people", "/filas/people"],
          ["04-cotas", "/cotas"],
          ["05-servicos", "/servicos"],
          ["06-cobertura", "/cobertura?medir=agora"],
          ["07-titulo", matrixPath],
          ["08-forcar-detalhe", `${matrixPath}/forcar/detalhe`],
          ["09-usuarios", "/usuarios"],
          ["10-logs", "/logs"],
          ["11-acoes", "/acoes"],
        ],
        path.resolve(repoRoot, shotsDir),
      );
    }
  } finally {
    server?.kill();
    if (disconnect) await disconnect().catch(() => undefined);
    if (started) await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL ${f.n}. ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => {
    if (process.exitCode !== undefined && process.exitCode !== 0) process.exit(1);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("[FAIL] validador ABORTOU antes de terminar as provas:");
    console.error(error);
    process.exit(1);
  });
