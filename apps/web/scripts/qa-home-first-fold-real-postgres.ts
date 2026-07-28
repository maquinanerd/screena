/**
 * qa-home-first-fold-real-postgres.ts — QA VISUAL da primeira dobra da Home
 * contra a APLICACAO NEXT.JS REAL e PostgreSQL 16 REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * O que este script prova (e o harness estatico NAO provava):
 *  - o DOM que o React/Next realmente emite, com hidratacao real;
 *  - os dados atravessando loader -> presenter -> componente;
 *  - o carrossel trocando de slide de verdade;
 *  - o header no topo, apos scroll e em rota SEM hero;
 *  - a cadeia completa do Cinerie Score (banco -> estrela) nos DOIS estados;
 *  - o provedor licenciado na faixa amarela nos TRES estados.
 *
 * Motor de banco: `embedded-postgres` (PostgreSQL 16 real, binario portatil,
 * EFEMERO), o mesmo padrao dos demais `validate:*-real-postgres`.
 *
 * Seguranca:
 *  - ZERO producao: DATABASE_URL aponta SEMPRE para 127.0.0.1 num banco
 *    descartavel, e o script ABORTA se receber host remoto.
 *  - ZERO rede de DADOS: nenhuma chamada a TMDB/RapidAPI/Gemini. A unica URL
 *    externa que a pagina produz e a de IMAGEM do CDN do TMDB — e ela e
 *    INTERCEPTADA pelo browser e servida por um asset local de QA, para que o
 *    teste seja deterministico e offline.
 *  - Nenhum `.env` de producao e lido ou copiado.
 *  - Postgres derrubado e diretorio removido no `finally`.
 *
 * Pre-requisito: `pnpm build` (o script sobe `next start` sobre o build atual).
 * Uso: pnpm --filter @screena/web qa:home-fold
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import EmbeddedPostgres from "embedded-postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));
const webRequire = createRequire(path.join(webDir, "package.json"));

const LANGUAGE = "pt-BR";
/** Revisor humano ficticio do cenario (o schema exige identidade humana). */
const REVIEWER = "qa-visual@cinerie";
/** Saida das capturas. */
const OUT_DIR = path.join(webDir, ".qa-home-fold");

const VIEWPORTS: ReadonlyArray<readonly [string, number, number]> = [
  ["1126x799", 1126, 799],
  ["1576x892", 1576, 892],
  ["1280x900", 1280, 900],
  ["768x1024", 768, 1024],
  ["390x844", 390, 844],
];

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
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

/** Escapa string para literal SQL simples. */
function lit(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

// ------------------------------------------------------------------ backdrop
/**
 * Gera um PNG de QA com ESTRUTURA fotografica (nao um borrao): ceu claro a
 * esquerda (pior caso para o titulo branco), massa escura de silhueta a
 * direita (onde fica a coluna de creditos), linha de horizonte e grao. Serve
 * para julgar crop, scrim e contraste — o que um placeholder chapado nao
 * permite. Deterministico (LCG proprio; sem Math.random).
 */
function buildQaBackdropPng(width: number, height: number): Buffer {
  let seed = 20260728;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const horizon = Math.round(height * 0.62);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      let r: number;
      let g: number;
      let b: number;
      if (y < horizon) {
        // Ceu: claro/quente no alto-esquerda, escurecendo para a direita.
        const sky = 1 - v / (horizon / height);
        r = 150 + 95 * sky - 60 * u;
        g = 160 + 80 * sky - 70 * u;
        b = 175 + 60 * sky - 80 * u;
        // Glow solar no alto-esquerda (estressa o header transparente).
        const dx = u - 0.18;
        const dy = v - 0.08;
        const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 3.2);
        r += 70 * glow;
        g += 60 * glow;
        b += 40 * glow;
      } else {
        // Terreno escuro.
        const depth = (y - horizon) / (height - horizon);
        r = 46 - 24 * depth;
        g = 42 - 22 * depth;
        b = 38 - 20 * depth;
      }
      // Silhueta na faixa direita (massa escura solida com borda irregular).
      const silhouetteLeft = 0.6 + 0.04 * Math.sin(y / 40);
      if (u > silhouetteLeft && v > 0.22) {
        r *= 0.18;
        g *= 0.18;
        b *= 0.2;
      }
      const grain = (rand() - 0.5) * 14;
      const at = 1 + x * 3;
      row[at] = Math.max(0, Math.min(255, Math.round(r + grain)));
      row[at + 1] = Math.max(0, Math.min(255, Math.round(g + grain)));
      row[at + 2] = Math.max(0, Math.min(255, Math.round(b + grain)));
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ fixtures
type Sql = {
  q: <T>(sql: string) => Promise<T[]>;
  x: (sql: string) => Promise<number>;
};

interface Fixtures {
  movieId: string;
  showId: string;
  episodeTodayId: string;
  offerId: string;
}

/** ISO `YYYY-MM-DD` de hoje em UTC (mesma janela que o getter do ticker usa). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

async function seedFixtures({ q, x }: Sql): Promise<Fixtures> {
  // ---------------------------------------------------------------- filme A
  // Titulo LONGO de proposito: exercita a quebra em 3 linhas do hero.
  const movieId = (
    await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, title_original, release_date, certification, backdrop_path, poster_path, popularity, updated_at)
       VALUES (990001, 'A Morte do Demonio: Em Chamas', DATE '2026-01-15', '16', '/qa-movie-backdrop.jpg', '/qa-movie-poster.jpg', 90.5, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', ${movieId}, ${lit(LANGUAGE)}, 'a-morte-do-demonio-em-chamas', true, now())`,
  );
  await x(
    `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, meta_description, updated_at)
     VALUES ('movie', ${movieId}, ${lit(LANGUAGE)}, 'A Morte do Demônio: Em Chamas', 'Após a perda do marido, uma mulher busca consolo com seus sogros em sua casa isolada, e o que encontra transforma a familia inteira.', 'Ficha editorial de QA.', now())`,
  );
  const directorId = (
    await q<{ id: bigint }>(
      `INSERT INTO people (tmdb_id, name, updated_at) VALUES (991001, 'Sébastien Vanicek', now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO crew_members (person_id, entity_type, entity_id, department, job, updated_at) VALUES (${directorId}, 'movie', ${movieId}, 'Directing', 'Director', now())`,
  );
  const castNames = ["Souheila Yacoub", "Tandi Wright", "Hunter Doohan"];
  for (let i = 0; i < castNames.length; i += 1) {
    const personId = (
      await q<{ id: bigint }>(
        `INSERT INTO people (tmdb_id, name, updated_at) VALUES (${991010 + i}, ${lit(castNames[i]!)}, now()) RETURNING id`,
      )
    )[0]!.id.toString();
    await x(
      `INSERT INTO cast_members (person_id, entity_type, entity_id, character, billing_order, updated_at) VALUES (${personId}, 'movie', ${movieId}, ${lit(`Personagem ${i + 1}`)}, ${i}, now())`,
    );
  }

  // ---------------------------------------------------------------- serie B
  const showId = (
    await q<{ id: bigint }>(
      `INSERT INTO tv_shows (tmdb_id, name_original, first_air_date, number_of_seasons, number_of_episodes, certification, backdrop_path, poster_path, updated_at)
       VALUES (990002, 'Ruptura', DATE '2022-02-18', 2, 19, '16', '/qa-show-backdrop.jpg', '/qa-show-poster.jpg', now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('tv', ${showId}, ${lit(LANGUAGE)}, 'ruptura', true, now())`,
  );
  await x(
    `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, meta_description, updated_at)
     VALUES ('tv', ${showId}, ${lit(LANGUAGE)}, 'Ruptura', 'Funcionarios de uma corporacao aceitam separar cirurgicamente as memorias do trabalho e da vida pessoal.', 'Ficha editorial de QA.', now())`,
  );
  const creatorId = (
    await q<{ id: bigint }>(
      `INSERT INTO people (tmdb_id, name, updated_at) VALUES (991020, 'Dan Erickson', now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO crew_members (person_id, entity_type, entity_id, department, job, updated_at) VALUES (${creatorId}, 'tv', ${showId}, 'Directing', 'Director', now())`,
  );
  for (let i = 0; i < 3; i += 1) {
    const personId = (
      await q<{ id: bigint }>(
        `INSERT INTO people (tmdb_id, name, updated_at) VALUES (${991030 + i}, ${lit(["Adam Scott", "Britt Lower", "Tramell Tillman"][i]!)}, now()) RETURNING id`,
      )
    )[0]!.id.toString();
    await x(
      `INSERT INTO cast_members (person_id, entity_type, entity_id, character, billing_order, updated_at) VALUES (${personId}, 'tv', ${showId}, ${lit(`Personagem ${i + 1}`)}, ${i}, now())`,
    );
  }
  const seasonId = (
    await q<{ id: bigint }>(
      `INSERT INTO seasons (tv_show_id, season_number, name, episode_count, updated_at) VALUES (${showId}, 2, 'Temporada 2', 10, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  // Episodio de HOJE (estado 1 do ticker) e um FUTURO confirmado (estado 2).
  const episodeTodayId = (
    await q<{ id: bigint }>(
      `INSERT INTO episodes (season_id, tv_show_id, episode_number, name, air_date, updated_at) VALUES (${seasonId}, ${showId}, 5, 'Cavalo de Troia', DATE '${todayIso()}', now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO episodes (season_id, tv_show_id, episode_number, name, air_date, updated_at) VALUES (${seasonId}, ${showId}, 6, 'Depois do Expediente', DATE '${isoPlusDays(9)}', now())`,
  );

  // -------------------------------------------------- oferta legal licenciada
  // MESMA cadeia de governanca de producao: provider canonico -> alias ->
  // licenca -> decisao de uso -> oferta com fingerprint aprovado.
  const providerId = (
    await q<{ id: bigint }>(
      `INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('max','Max','https://www.max.com/', now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) VALUES (${providerId},'streaming_availability','max','Max', now())`,
  );
  const watchLicenseId = (
    await q<{ id: bigint }>(
      `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, logo_allowed, score_allowed, review_quote_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
       VALUES ('max','watch_availability','streaming_availability','BR','third_party',true,false,false,false,true,true,'Disponibilidade fornecida por Movie of the Night',true,${lit(REVIEWER)},now(),'qa/v1',now()) RETURNING id`,
    )
  )[0]!.id.toString();
  const watchDecisionId = (
    await q<{ id: bigint }>(
      `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, is_current, updated_at)
       VALUES (${watchLicenseId},'watch_offer_display','BR','approved_for_display',true,true,false,true,true,'qa/v1',${lit(REVIEWER)},'cenario de QA visual da home',true,now()) RETURNING id`,
    )
  )[0]!.id.toString();
  const offerId = (
    await q<{ id: bigint }>(
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_api, external_offer_id, provider_key, provider_name, offer_type, deep_link, quality, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, reviewed_at, reviewed_by, watch_provider_id, data_usage_decision_id, display_allowed, updated_at)
       VALUES ('tv', ${showId}, 'BR', 'streaming_availability', 'qa-offer-1', 'max', 'Max', 'subscription', 'https://www.max.com/br/pt/shows/qa', 'hd', 'third_party', true, true, 'Disponibilidade fornecida por Movie of the Night', 'https://www.movieofthenight.com/', now(), now(), ${lit(REVIEWER)}, ${providerId}, ${watchDecisionId}, false, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `UPDATE watch_availability SET approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url), display_allowed = true WHERE id=${offerId}`,
  );

  return { movieId, showId, episodeTodayId, offerId };
}

/**
 * Liga o Cinerie Score de uma entidade do jeito que PRODUCAO exigiria:
 * decisao de uso vigente para `cinerie_score_display` (o trigger
 * `cinerie_score_display_guard` recusa sem ela) + calculo `calculated` em
 * `cinerie_score_calculations` (a PROCEDENCIA que o loader agora exige).
 */
async function enableCinerieScore(
  { q, x }: Sql,
  table: "movies" | "tv_shows",
  entityType: "movie" | "tv",
  entityId: string,
  value: number,
): Promise<void> {
  const existing = await q<{ id: bigint }>(
    `SELECT d.id FROM data_usage_decisions d WHERE d.use_case='cinerie_score_display' AND d.is_current LIMIT 1`,
  );
  if (existing.length === 0) {
    // O Cinerie Score e OBRA DERIVADA de notas de terceiros (ver o comentario
    // do trigger `cinerie_score_display_guard`): a decisao se pendura numa
    // licenca de rating JA EXISTENTE, com `derivative_allowed`. Nao inventamos
    // uma licenca "cinerie" — `source_licenses.provider_key` e FK de
    // `api_providers.key`, e nao existe fornecedor tecnico com esse nome.
    const licenseId = (
      await q<{ id: bigint }>(
        `SELECT id FROM source_licenses WHERE content_type='rating' AND is_current ORDER BY id ASC LIMIT 1`,
      )
    )[0]!.id.toString();
    // A licenca-SEMENTE nasce conservadora (`unknown`, nada permitido) e o banco
    // recusa conceder uso sobre ela. Em producao quem faz esta transicao e
    // `pnpm legal sources apply`; aqui ela e explicita, como no validador de
    // inteligencia licenciada.
    await x(
      `UPDATE source_licenses SET license_status='third_party', display_allowed=true, score_allowed=true, decided_by=${lit(REVIEWER)}, decided_at=now(), policy_version='qa/v1', updated_at=now() WHERE id=${licenseId}`,
    );
    await x(
      `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, is_current, updated_at)
       VALUES (${licenseId},'cinerie_score_display','BR','approved_for_display',true,true,true,true,true,'qa/v1',${lit(REVIEWER)},'cenario de QA visual da home',true,now())`,
    );
  }
  await x(
    `INSERT INTO cinerie_score_calculations (entity_type, entity_id, status, value, scale, version, inputs_hash, explanation, calculated_at)
     VALUES (${lit(entityType)}, ${entityId}, 'calculated', ${value}, 5, 'qa/v1', ${lit(`qa-${entityType}-${entityId}`)}, '{"qa":true}'::jsonb, now())`,
  );
  await x(
    `UPDATE ${table} SET screen_score=${value}, screen_score_scale=5, screen_score_display=true, updated_at=now() WHERE id=${entityId}`,
  );
}

// ------------------------------------------------------------------ browser
interface FoldReport {
  overflowOk: boolean;
  scrollWidth: number;
  clientWidth: number;
  headerHeight: number;
  headerBackground: string;
  headerBackgroundImage: string;
  headerBorder: string;
  brandX: number;
  navItems: string[];
  activeNavLabel: string | null;
  activeNavUnderline: string | null;
  heroHeight: number;
  heroImageSrc: string | null;
  heroTitle: string | null;
  heroTitleBox: { x: number; y: number; w: number; h: number } | null;
  heroTitleDecoration: string | null;
  heroTitleLines: number;
  heroStars: string | null;
  heroCert: string | null;
  heroSideBox: { x: number; y: number; w: number; h: number } | null;
  dotCount: number;
  activeDotColor: string | null;
  activeDotVertical: string | null;
  tickerHeight: number;
  tickerBadge: string | null;
  tickerText: string | null;
  tickerCta: string | null;
  tickerCredit: string | null;
  featuredTop: number | null;
}

const READ_FOLD = `() => {
  const q = (s) => document.querySelector(s);
  const box = (s) => {
    const el = q(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const style = (s, p) => { const el = q(s); return el ? getComputedStyle(el)[p] : null; };
  const text = (s) => { const el = q(s); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  const header = q('.site-header');
  const hero = q('.hero');
  const ticker = q('.ticker');
  const titleLink = q('.hero__title a');
  const activeDot = q('.hero__dot[aria-selected="true"]');
  const activeNav = q('.site-header__link[aria-current="page"]');
  const featured = q('.feat-head');
  const brand = q('.site-header__brand');
  return {
    overflowOk: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
    headerBackground: header ? getComputedStyle(header).backgroundColor : '',
    headerBackgroundImage: header ? getComputedStyle(header).backgroundImage : '',
    headerBorder: header ? getComputedStyle(header).borderBottomColor : '',
    brandX: brand ? Math.round(brand.getBoundingClientRect().x) : -1,
    navItems: [...document.querySelectorAll('.site-header__link')].map((a) => a.textContent.trim()),
    activeNavLabel: activeNav ? activeNav.textContent.trim() : null,
    activeNavUnderline: activeNav ? getComputedStyle(activeNav).borderBottomColor : null,
    heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
    heroImageSrc: q('.hero__image') ? q('.hero__image').getAttribute('src') : null,
    heroTitle: text('.hero__title'),
    heroTitleBox: box('.hero__title'),
    heroTitleDecoration: titleLink ? getComputedStyle(titleLink).textDecorationLine : null,
    heroTitleLines: titleLink ? titleLink.getClientRects().length : 0,
    heroStars: text('.hero__stars'),
    heroCert: text('.hero__cert'),
    heroSideBox: box('.hero__side'),
    dotCount: document.querySelectorAll('.hero__dot').length,
    activeDotColor: activeDot ? getComputedStyle(activeDot).backgroundColor : null,
    activeDotVertical: activeDot ? activeDot.getAttribute('data-vertical') : null,
    tickerHeight: ticker ? Math.round(ticker.getBoundingClientRect().height) : 0,
    tickerBadge: text('.ticker__label'),
    tickerText: text('.ticker__text'),
    tickerCta: text('.ticker__cta'),
    tickerCredit: text('.ticker__credit'),
    featuredTop: featured ? Math.round(featured.getBoundingClientRect().top + window.scrollY) : null,
  };
}`;

const RED = "rgb(240, 68, 62)";
const GREEN = "rgb(127, 165, 111)";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const backdrop = buildQaBackdropPng(1280, 720);
  writeFileSync(path.join(OUT_DIR, "qa-backdrop.png"), backdrop);

  const pgPort = await freePort();
  const appPort = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-home-fold-pg-"));
  /**
   * Producao e UTF8, entao o QA TENTA UTF8 primeiro. No Windows, porem, o
   * `initdb` falha ("invalid byte sequence for encoding UTF8") quando os
   * binarios do Postgres embarcado vivem sob um caminho com caractere
   * nao-ASCII — e o caminho deste repositorio contem "Área de Trabalho". Nesse
   * caso caimos para o encoding padrao do SO e REGISTRAMOS qual foi usado, em
   * vez de fingir que o QA rodou em UTF8. Os textos das fixtures sao escolhidos
   * para existirem nos dois encodings, entao o cenario visual e identico.
   */
  const newPg = (utf8: boolean): EmbeddedPostgres =>
    new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port: pgPort,
      persistent: true,
      initdbFlags: utf8 ? ["--encoding=UTF8", "--locale=C"] : [],
    });
  let pg = newPg(true);
  let clusterEncoding = "UTF8";
  const dbName = "cinerie_home_fold_qa";
  const url = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/${dbName}?schema=public`;

  // Trava dura: este script NUNCA fala com banco que nao seja local descartavel.
  if (!/@127\.0\.0\.1:/.test(url) || !url.includes(dbName)) {
    throw new Error("abort: DATABASE_URL de QA nao e local/descartavel");
  }
  console.log(
    `\n=== Postgres efemero :${pgPort} | app Next real :${appPort} | banco ${dbName} ===\n`,
  );

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  let server: ChildProcess | undefined;
  let browser: { close: () => Promise<void> } | undefined;

  try {
    try {
      await pg.initialise();
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0] ?? "";
      if (!/invalid byte sequence|encoding/i.test(reason)) throw e;
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
      mkdirSync(dataDir, { recursive: true });
      pg = newPg(false);
      clusterEncoding = "padrao do SO (UTF8 indisponivel: caminho com caractere nao-ASCII)";
      await pg.initialise();
    }
    await pg.start();
    started = true;
    await pg.createDatabase(dbName);

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    console.log("--- prisma db seed (idiomas/paises/fontes/providers) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record(
      "migrate deploy + db:seed no PostgreSQL 16 efemero",
      true,
      `encoding do cluster: ${clusterEncoding}`,
    );

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => {
        $executeRawUnsafe: (sql: string) => Promise<number>;
        $queryRawUnsafe: <T>(sql: string) => Promise<T[]>;
      };
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const prisma = dbServer.getPrismaClient();
    const sql: Sql = {
      q: (s) => prisma.$queryRawUnsafe(s),
      x: (s) => prisma.$executeRawUnsafe(s),
    };

    const fixtures = await seedFixtures(sql);
    record(
      "fixtures QA criadas (filme longo, serie, episodio de hoje, oferta licenciada)",
      true,
      `movie=${fixtures.movieId} tv=${fixtures.showId} offer=${fixtures.offerId}`,
    );

    // ------------------------------------------------------ app Next.js real
    const nextBin = webRequire.resolve("next/dist/bin/next");
    server = spawn("node", [nextBin, "start", "-p", String(appPort), "-H", "127.0.0.1"], {
      cwd: webDir,
      env: { ...env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (d: Buffer) => process.stdout.write(`[next] ${d}`));
    server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[next] ${d}`));

    const base = `http://127.0.0.1:${appPort}`;
    const deadline = Date.now() + 90000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/pt/`);
        if (res.status < 500) {
          up = true;
          break;
        }
      } catch {
        /* ainda subindo */
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    record("aplicacao Next.js real respondendo em /pt/", up, up ? base : "timeout 90s");
    if (!up) throw new Error("next start nao respondeu");

    const { chromium } = (await import("@playwright/test")) as typeof import("@playwright/test");
    const b = await chromium.launch();
    browser = b;

    const openPage = async (width: number, height: number) => {
      const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      // A URL de IMAGEM do TMDB e interceptada e servida por asset LOCAL:
      // QA deterministico e offline. Nenhuma consulta de DADOS externa existe.
      await page.route("https://image.tmdb.org/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "image/png", body: backdrop });
      });
      return page;
    };

    const capture = async (
      name: string,
      width: number,
      height: number,
      after?: (page: import("@playwright/test").Page) => Promise<void>,
    ): Promise<FoldReport> => {
      const page = await openPage(width, height);
      await page.goto(`${base}/pt/`, { waitUntil: "networkidle" });
      if (after) await after(page);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
      const report = (await page.evaluate(`(${READ_FOLD})()`)) as FoldReport;
      await page.close();
      return report;
    };

    // ---------------- CENARIO 1: filme ativo, sem score, ticker COM provedor
    const s1 = await capture("01-movie-no-score-provider-1126x799", 1126, 799);
    record(
      "C1 header transparente de verdade sobre o hero (sem faixa/gradiente)",
      s1.headerBackground === TRANSPARENT &&
        s1.headerBackgroundImage === "none" &&
        s1.headerBorder === TRANSPARENT,
      `bg=${s1.headerBackground} img=${s1.headerBackgroundImage} border=${s1.headerBorder}`,
    );
    record(
      "C1 header 72px e menu na ordem canonica",
      s1.headerHeight === 72 &&
        s1.navItems.join("·") === "Início·Filmes·Séries·Listas·Notícias·Onde assistir",
      `h=${s1.headerHeight} menu=${s1.navItems.join("·")}`,
    );
    record(
      "C1 titulo do hero SEM sublinhado e quebrando em multiplas linhas",
      s1.heroTitleDecoration === "none" && s1.heroTitleLines >= 2,
      `decoration=${s1.heroTitleDecoration} linhas=${s1.heroTitleLines} titulo=${s1.heroTitle}`,
    );
    record(
      "C1 backdrop REAL renderizado pelo <img> do hero (URL do CDN governado)",
      s1.heroImageSrc !== null && s1.heroImageSrc.startsWith("https://image.tmdb.org/t/p/"),
      `src=${s1.heroImageSrc}`,
    );
    record(
      "C1 slide de FILME: underline de Início vermelho E dot ativo vermelho",
      s1.activeNavLabel === "Início" &&
        s1.activeNavUnderline === RED &&
        s1.activeDotColor === RED &&
        s1.activeDotVertical === "movie",
      `nav=${s1.activeNavLabel}/${s1.activeNavUnderline} dot=${s1.activeDotColor}/${s1.activeDotVertical}`,
    );
    record(
      "C1 sem Cinerie Score liberado: nenhuma estrela, classificacao preservada",
      s1.heroStars === null && s1.heroCert === "16",
      `estrelas=${s1.heroStars} cert=${s1.heroCert}`,
    );
    record(
      "C1 faixa amarela com episodio de HOJE + provedor licenciado + credito",
      s1.tickerBadge === "NOVO" &&
        s1.tickerCta?.includes("Onde assistir") === true &&
        s1.tickerCta?.includes("Max") === true &&
        s1.tickerCredit?.includes("Movie of the Night") === true,
      `badge=${s1.tickerBadge} cta=${s1.tickerCta} credito=${s1.tickerCredit}`,
    );
    record("C1 zero overflow horizontal", s1.overflowOk, `${s1.scrollWidth}<=${s1.clientWidth}`);

    // ---------------- CENARIO 2: slide de SERIE ativo (assercao combinada)
    const s2 = await capture("02-series-slide-1126x799", 1126, 799, async (page) => {
      await page.click('.hero__dot[data-vertical="series"]');
      await page.waitForTimeout(200);
    });
    record(
      "C2 slide de SERIE: underline de Início continua VERMELHO e dot fica VERDE",
      s2.activeNavLabel === "Início" &&
        s2.activeNavUnderline === RED &&
        s2.activeDotColor === GREEN &&
        s2.activeDotVertical === "series",
      `nav=${s2.activeNavLabel}/${s2.activeNavUnderline} dot=${s2.activeDotColor}/${s2.activeDotVertical}`,
    );

    // ---------------- CENARIO 3: Cinerie Score DISPONIVEL (filme e serie)
    await enableCinerieScore(sql, "movies", "movie", fixtures.movieId, 4.2);
    await enableCinerieScore(sql, "tv_shows", "tv", fixtures.showId, 4.6);
    const s3 = await capture("03-score-available-1126x799", 1126, 799);
    record(
      "C3 Cinerie Score liberado no banco -> estrelas REAIS no hero",
      s3.heroStars !== null && s3.heroStars.includes("★") && s3.heroCert === "16",
      `estrelas=${s3.heroStars} cert=${s3.heroCert}`,
    );
    const s3series = await capture("04-score-available-series-1126x799", 1126, 799, async (page) => {
      await page.click('.hero__dot[data-vertical="series"]');
      await page.waitForTimeout(200);
    });
    record(
      "C3 serie com score: estrelas presentes e dot verde (acento por slide)",
      s3series.heroStars !== null && s3series.activeDotColor === GREEN,
      `estrelas=${s3series.heroStars} dot=${s3series.activeDotColor}`,
    );

    // ---------------- CENARIO 4: oferta perde autorizacao -> CTA generico
    await sql.x(
      `UPDATE watch_availability SET display_allowed=false, updated_at=now() WHERE id=${fixtures.offerId}`,
    );
    const s4 = await capture("05-episode-without-provider-1126x799", 1126, 799);
    record(
      "C4 oferta sem display_allowed: faixa cai para 'Ver série', sem provedor nem credito",
      s4.tickerBadge === "NOVO" &&
        s4.tickerCta === "Ver série" &&
        s4.tickerCredit === null &&
        !/Max/.test(s4.tickerText ?? ""),
      `cta=${s4.tickerCta} credito=${s4.tickerCredit}`,
    );

    // ---------------- CENARIO 5: sem episodio hoje -> proxima estreia
    await sql.x(`DELETE FROM episodes WHERE id=${fixtures.episodeTodayId}`);
    const s5 = await capture("06-ticker-upcoming-1126x799", 1126, 799);
    record(
      "C5 sem episodio hoje: faixa mostra a PROXIMA estreia confirmada (EM BREVE + data)",
      s5.tickerBadge === "EM BREVE" && /estreia em/.test(s5.tickerText ?? ""),
      `badge=${s5.tickerBadge} texto=${s5.tickerText}`,
    );

    // ---------------- CENARIO 6: nenhuma estreia -> estado neutro honesto
    await sql.x(`DELETE FROM episodes WHERE tv_show_id=${fixtures.showId}`);
    const s6 = await capture("07-ticker-neutral-1126x799", 1126, 799);
    record(
      "C6 sem estreia nenhuma: faixa PERMANECE, em estado neutro e honesto",
      s6.tickerHeight > 0 &&
        s6.tickerBadge === "AGENDA" &&
        s6.tickerText === "Nenhum episódio novo confirmado para hoje" &&
        s6.tickerCta === "Ver séries",
      `altura=${s6.tickerHeight} badge=${s6.tickerBadge} cta=${s6.tickerCta}`,
    );
    record(
      "C6 'Destaques de hoje' comeca logo abaixo da faixa (ritmo preservado)",
      s6.featuredTop !== null && s6.featuredTop > s6.tickerHeight,
      `featuredTop=${s6.featuredTop} tickerH=${s6.tickerHeight}`,
    );

    // ---------------- CENARIO 7: header apos scroll e em rota SEM hero
    const scrolled = await capture("08-header-scrolled-1126x799", 1126, 799, async (page) => {
      await page.evaluate(() => window.scrollTo(0, 600));
      await page.waitForTimeout(500);
    });
    record(
      "C7 header vira SOLIDO apos rolar (nunca some o contraste)",
      scrolled.headerBackground !== TRANSPARENT,
      `bg=${scrolled.headerBackground} border=${scrolled.headerBorder}`,
    );

    const noHeroPage = await openPage(1126, 799);
    await noHeroPage.goto(`${base}/pt/noticias/`, { waitUntil: "networkidle" });
    await noHeroPage.waitForTimeout(250);
    await noHeroPage.screenshot({ path: path.join(OUT_DIR, "09-no-hero-route-1126x799.png") });
    const noHero = (await noHeroPage.evaluate(`(${READ_FOLD})()`)) as FoldReport;
    await noHeroPage.close();
    record(
      "C7 rota SEM hero: header solido desde o topo, sem texto branco no claro",
      noHero.headerBackground !== TRANSPARENT && noHero.heroHeight === 0,
      `bg=${noHero.headerBackground} heroH=${noHero.heroHeight}`,
    );

    // ---------------- CENARIO 8: as 5 viewports com o estado completo
    await sql.x(
      `UPDATE watch_availability SET display_allowed=true, updated_at=now() WHERE id=${fixtures.offerId}`,
    );
    const seasonId = (
      await sql.q<{ id: bigint }>(`SELECT id FROM seasons WHERE tv_show_id=${fixtures.showId}`)
    )[0]!.id.toString();
    await sql.x(
      `INSERT INTO episodes (season_id, tv_show_id, episode_number, name, air_date, updated_at) VALUES (${seasonId}, ${fixtures.showId}, 5, 'Cavalo de Troia', DATE '${todayIso()}', now())`,
    );

    for (const [name, width, height] of VIEWPORTS) {
      const report = await capture(`10-full-${name}`, width, height);
      const desktop = width >= 1024;
      record(
        `C8 ${name}: sem overflow, faixa presente, titulo limpo${desktop ? ", coluna direita alinhada" : ""}`,
        report.overflowOk &&
          report.tickerHeight > 0 &&
          report.heroTitleDecoration === "none" &&
          (!desktop || (report.heroSideBox !== null && report.heroSideBox.w > 0)),
        `overflow=${report.scrollWidth}/${report.clientWidth} tickerH=${report.tickerHeight} side=${
          report.heroSideBox === null ? "oculto" : `${report.heroSideBox.w}px`
        } estrelas=${report.heroStars ?? "-"} cta=${report.tickerCta}`,
      );
    }
  } catch (e) {
    console.error(e);
    const err = e as Error & { code?: string; meta?: unknown };
    const at = String(err.stack ?? "")
      .split(/\r?\n/)
      .find((line) => line.includes("qa-home"));
    record(
      "execucao",
      false,
      `${err.name}${err.code === undefined ? "" : ` [${err.code}]`}: ${err.message.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ""} | meta=${JSON.stringify(err.meta)} | em ${at ?? "?"}`.slice(0, 500),
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) {
      server.kill();
      await new Promise((r) => setTimeout(r, 500));
    }
    if (disconnect) await disconnect();
    if (started) await pg.stop();
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (e) {
      console.warn(`Aviso: dir temporario sera limpo pelo SO (${(e as Error).message.split("\n")[0]})`);
    }
    console.log("\n=== Postgres efemero derrubado; app Next encerrado ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  console.log(`Capturas em ${OUT_DIR}`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exitCode = 1;
  }
}

await main();
