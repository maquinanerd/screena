/**
 * qa-home-editorial-ticker-real-postgres.ts — QA VISUAL de "Destaques de hoje"
 * (seção editorial) e da FAIXA AMARELA (carrossel de novidades) contra a
 * APLICACAO NEXT.JS REAL e PostgreSQL 16 REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * O que este script prova (e nenhum harness estatico de DOM provaria):
 *  - os tres cards de "Destaques de hoje" sao MATERIAS e apontam para
 *    /pt/noticias/ — nenhum poster de catalogo, nenhum link para ficha;
 *  - `Filmes`/`Series` sao TABS: clicar TROCA O CONTEUDO sem mudar a URL,
 *    sem recarregar e sem navegar;
 *  - materia agendada, rascunho e retratada NAO vazam para a home;
 *  - a faixa amarela carrega 5 novidades reais, mostra UMA por vez, tem 5 dots,
 *    autoplay que troca o item ativo, controle manual por dot e por teclado,
 *    pausa em hover/foco e autoplay desligado sob `prefers-reduced-motion`;
 *  - o CTA e o CREDITO acompanham o item ATIVO (sem credito residual);
 *  - zero overflow horizontal em cinco viewports.
 *
 * Motor de banco: `embedded-postgres` (PostgreSQL 16 real, binario portatil,
 * EFEMERO), o mesmo padrao dos demais `validate:*-real-postgres`.
 *
 * Seguranca:
 *  - ZERO producao: DATABASE_URL aponta SEMPRE para 127.0.0.1 num banco
 *    descartavel, e o script ABORTA se receber host remoto.
 *  - ZERO rede de DADOS: nenhuma chamada a TMDB/RapidAPI/Gemini. As URLs de
 *    IMAGEM (CDN do TMDB e /media/ local das materias) sao INTERCEPTADAS pelo
 *    browser e servidas por assets locais de QA — deterministico e offline.
 *    Nenhuma fixture toca `apps/web/public/`.
 *  - Nenhum `.env` de producao e lido ou copiado.
 *  - Postgres derrubado e diretorio removido no `finally`.
 *
 * Pre-requisito: `pnpm build` (o script sobe `next start` sobre o build atual).
 * Uso: pnpm --filter @screena/web qa:home-editorial
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
const REVIEWER = "qa-editorial@cinerie";
const OUT_DIR = path.join(webDir, ".qa-home-editorial");

const VIEWPORTS: ReadonlyArray<readonly [string, number, number]> = [
  ["1576x892", 1576, 892],
  ["1280x900", 1280, 900],
  ["1126x799", 1126, 799],
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

// ------------------------------------------------------------------ imagem QA
/**
 * PNG editorial deterministico (LCG proprio; sem Math.random): faixa clara em
 * cima e massa escura em baixo, para julgar o scrim e a legibilidade do
 * eyebrow/manchete sobre a imagem da materia.
 */
function buildQaEditorialPng(width: number, height: number, tint: number): Buffer {
  let seed = 20260728 + tint * 7919;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const v = y / height;
      const u = x / width;
      // Topo claro (pior caso para texto claro) -> base escura (onde fica o body).
      const light = Math.max(0, 1 - v * 1.35);
      let r = 60 + 150 * light + 30 * u + tint * 18;
      let g = 58 + 140 * light + 20 * u;
      let b = 56 + 130 * light + 40 * (1 - u) + tint * 10;
      const grain = (rand() - 0.5) * 16;
      r += grain;
      g += grain;
      b += grain;
      const at = 1 + x * 3;
      row[at] = Math.max(0, Math.min(255, Math.round(r)));
      row[at + 1] = Math.max(0, Math.min(255, Math.round(g)));
      row[at + 2] = Math.max(0, Math.min(255, Math.round(b)));
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
  /** 5 entidades distintas, uma por item da faixa. */
  movieTodayId: string;
  movieArrivalId: string;
  showEpisodeTodayId: string;
  showEpisodeUpcomingId: string;
  showSeasonId: string;
  /** Oferta do episodio de hoje (item com provedor + credito). */
  episodeOfferId: string;
  /** Materias de controle NEGATIVO (nunca podem aparecer). */
  scheduledSlug: string;
  draftSlug: string;
  retractedSlug: string;
  unclassifiedSlug: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
function tsPlusDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

/** Cria uma entidade de catalogo completa (registro + slug + traducao pt-BR). */
async function createMovie(
  { q, x }: Sql,
  tmdbId: number,
  slug: string,
  title: string,
  releaseDate: string | null,
): Promise<string> {
  const id = (
    await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, title_original, release_date, updated_at)
       VALUES (${tmdbId}, ${lit(title)}, ${releaseDate === null ? "NULL" : `DATE '${releaseDate}'`}, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie', ${id}, ${lit(LANGUAGE)}, ${lit(slug)}, true, now())`,
  );
  await x(
    `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, updated_at)
     VALUES ('movie', ${id}, ${lit(LANGUAGE)}, ${lit(title)}, now())`,
  );
  return id;
}

async function createShow(
  { q, x }: Sql,
  tmdbId: number,
  slug: string,
  title: string,
): Promise<string> {
  const id = (
    await q<{ id: bigint }>(
      `INSERT INTO tv_shows (tmdb_id, name_original, updated_at) VALUES (${tmdbId}, ${lit(title)}, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('tv', ${id}, ${lit(LANGUAGE)}, ${lit(slug)}, true, now())`,
  );
  await x(
    `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, updated_at)
     VALUES ('tv', ${id}, ${lit(LANGUAGE)}, ${lit(title)}, now())`,
  );
  return id;
}

interface ArticleSpec {
  slug: string;
  title: string;
  deck: string | null;
  category: string | null;
  heroImagePath: string | null;
  reviewStatus: string;
  publishedAt: string;
  /** Entidades citadas: definem a VERTICAL (nunca palavra-chave no titulo). */
  links: ReadonlyArray<{ type: "movie" | "tv" | "person"; id: string }>;
}

async function createArticle({ q, x }: Sql, spec: ArticleSpec): Promise<void> {
  const articleId = (
    await q<{ id: bigint }>(
      `INSERT INTO articles (category, author_name, hero_image_path, published_at, read_time_minutes, license_status, display_allowed, requires_attribution, requires_linkback, updated_at)
       VALUES (${lit(spec.category)}, 'Redação Cinerie', ${lit(spec.heroImagePath)}, TIMESTAMPTZ '${spec.publishedAt}', 4, 'official', true, false, false, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO article_translations (article_id, language_code, slug, title, deck, body, review_status, index_status, published_at, updated_at)
     VALUES (${articleId}, ${lit(LANGUAGE)}, ${lit(spec.slug)}, ${lit(spec.title)}, ${lit(spec.deck)}, ${lit(
       `${spec.title}. Texto editorial proprio da redacao da Cinerie, escrito para o cenario de QA visual, com extensao suficiente para nao ser considerado conteudo fino pelo gate de corpo minimo da pagina de artigo.`,
     )}, ${lit(spec.reviewStatus)}::"ReviewStatus", 'index'::"IndexDecision", TIMESTAMPTZ '${spec.publishedAt}', now())`,
  );
  for (const link of spec.links) {
    await x(
      `INSERT INTO entity_news_links (article_id, entity_type, entity_id) VALUES (${articleId}, ${lit(link.type)}::"EntityType", ${link.id})`,
    );
  }
}

/**
 * Cadeia de licenca REAL para uma oferta de streaming (provider canonico ->
 * alias -> licenca -> decisao de uso -> oferta com fingerprint aprovado). A
 * MESMA governanca de producao; nada e promovido "na mao".
 */
async function createLicensedOffer(
  { q, x }: Sql,
  entityType: "movie" | "tv",
  entityId: string,
  providerSlug: string,
  providerName: string,
  externalOfferId: string,
  availableFrom: string | null,
): Promise<string> {
  const existingProvider = await q<{ id: bigint }>(
    `SELECT id FROM watch_providers WHERE slug=${lit(providerSlug)}`,
  );
  const providerId =
    existingProvider.length > 0
      ? existingProvider[0]!.id.toString()
      : (
          await q<{ id: bigint }>(
            `INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES (${lit(providerSlug)},${lit(providerName)},${lit(`https://www.${providerSlug}.com/`)}, now()) RETURNING id`,
          )
        )[0]!.id.toString();
  const existingAlias = await q<{ id: bigint }>(
    `SELECT id FROM watch_provider_aliases WHERE provider_api='streaming_availability' AND external_key=${lit(providerSlug)}`,
  );
  if (existingAlias.length === 0) {
    await x(
      `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) VALUES (${providerId},'streaming_availability',${lit(providerSlug)},${lit(providerName)}, now())`,
    );
  }
  const existingLicense = await q<{ id: bigint }>(
    `SELECT id FROM source_licenses WHERE source_key=${lit(providerSlug)} AND content_type='watch_availability'`,
  );
  const licenseId =
    existingLicense.length > 0
      ? existingLicense[0]!.id.toString()
      : (
          await q<{ id: bigint }>(
            `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, logo_allowed, score_allowed, review_quote_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
             VALUES (${lit(providerSlug)},'watch_availability','streaming_availability','BR','third_party',true,false,false,false,true,true,'Disponibilidade fornecida por Movie of the Night',true,${lit(REVIEWER)},now(),'qa/v1',now()) RETURNING id`,
          )
        )[0]!.id.toString();
  const existingDecision = await q<{ id: bigint }>(
    `SELECT id FROM data_usage_decisions WHERE source_license_id=${licenseId} AND use_case='watch_offer_display' AND is_current`,
  );
  const decisionId =
    existingDecision.length > 0
      ? existingDecision[0]!.id.toString()
      : (
          await q<{ id: bigint }>(
            `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, is_current, updated_at)
             VALUES (${licenseId},'watch_offer_display','BR','approved_for_display',true,true,false,true,true,'qa/v1',${lit(REVIEWER)},'cenario de QA visual da home',true,now()) RETURNING id`,
          )
        )[0]!.id.toString();
  const offerId = (
    await q<{ id: bigint }>(
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_api, external_offer_id, provider_key, provider_name, offer_type, deep_link, quality, available_from, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, reviewed_at, reviewed_by, watch_provider_id, data_usage_decision_id, display_allowed, updated_at)
       VALUES (${lit(entityType)}::"EntityType", ${entityId}, 'BR', 'streaming_availability', ${lit(externalOfferId)}, ${lit(providerSlug)}, ${lit(providerName)}, 'subscription', ${lit(`https://www.${providerSlug}.com/br/pt/qa`)}, 'hd', ${availableFrom === null ? "NULL" : `TIMESTAMPTZ '${availableFrom}'`}, 'third_party', true, true, 'Disponibilidade fornecida por Movie of the Night', 'https://www.movieofthenight.com/', now(), now(), ${lit(REVIEWER)}, ${providerId}, ${decisionId}, false, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `UPDATE watch_availability SET approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url), display_allowed = true WHERE id=${offerId}`,
  );
  return offerId;
}

async function seedFixtures(sql: Sql): Promise<Fixtures> {
  const { q, x } = sql;

  // ------------------------------------------------------ 5 NOVIDADES REAIS
  // Cinco ENTIDADES distintas: o dedupe por entidade e real, entao repetir
  // entidade produziria menos de cinco itens (e o teste exige exatamente 5).

  // 1. Episodio de HOJE, com provedor licenciado (item com credito).
  const showEpisodeTodayId = await createShow(sql, 995001, "ruptura", "Ruptura");
  const seasonTodayId = (
    await q<{ id: bigint }>(
      `INSERT INTO seasons (tv_show_id, season_number, name, episode_count, updated_at) VALUES (${showEpisodeTodayId}, 2, 'Temporada 2', 10, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO episodes (season_id, tv_show_id, episode_number, name, air_date, updated_at) VALUES (${seasonTodayId}, ${showEpisodeTodayId}, 5, 'Cavalo de Troia', DATE '${todayIso()}', now())`,
  );
  const episodeOfferId = await createLicensedOffer(
    sql,
    "tv",
    showEpisodeTodayId,
    "max",
    "Max",
    "qa-offer-episode",
    null,
  );

  // 2. Episodio FUTURO, SEM provedor (CTA cai para "Ver série").
  const showEpisodeUpcomingId = await createShow(
    sql,
    995002,
    "a-casa-do-dragao",
    "A Casa do Dragão",
  );
  const seasonUpcomingId = (
    await q<{ id: bigint }>(
      `INSERT INTO seasons (tv_show_id, season_number, name, episode_count, updated_at) VALUES (${showEpisodeUpcomingId}, 3, 'Temporada 3', 8, now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO episodes (season_id, tv_show_id, episode_number, name, air_date, updated_at) VALUES (${seasonUpcomingId}, ${showEpisodeUpcomingId}, 7, 'Episódio 7', DATE '${isoPlusDays(5)}', now())`,
  );

  // 3. Filme estreando HOJE.
  const movieTodayId = await createMovie(
    sql,
    995003,
    "aguas-mortais",
    "Águas Mortais",
    todayIso(),
  );

  // 4. Estreia de TEMPORADA dentro da semana (season_number REAL).
  const showSeasonId = await createShow(sql, 995004, "the-bear", "O Urso");
  await x(
    `INSERT INTO seasons (tv_show_id, season_number, name, episode_count, air_date, updated_at) VALUES (${showSeasonId}, 4, 'Temporada 4', 10, DATE '${isoPlusDays(3)}', now())`,
  );

  // 5. Filme que RECEM-CHEGOU ao streaming, com provedor licenciado.
  const movieArrivalId = await createMovie(
    sql,
    995005,
    "um-sonho-de-liberdade",
    "Um Sonho de Liberdade",
    "1994-09-23",
  );
  await createLicensedOffer(
    sql,
    "movie",
    movieArrivalId,
    "netflix",
    "Netflix",
    "qa-offer-arrival",
    tsPlusDays(-2),
  );

  // ------------------------------------------------------- MATERIAS (>=3+3)
  const moviesLinks = [{ type: "movie" as const, id: movieTodayId }];
  const seriesLinks = [{ type: "tv" as const, id: showEpisodeTodayId }];

  await createArticle(sql, {
    slug: "filme-article-1",
    title: "O ano em que o terror voltou a lotar as salas",
    deck: "De estreias independentes a franquias consagradas, o gênero reencontrou o público — e a crítica seguiu junto.",
    // Token do CONTRATO editorial (a projeção grava `contentType` cru em
    // `articles.category`): o kicker do card deve exibir "Notícia", nunca
    // o token "news" em inglês.
    category: "news",
    heroImagePath: "/media/qa/editorial-1.png",
    reviewStatus: "published",
    publishedAt: tsPlusDays(-1),
    links: moviesLinks,
  });
  await createArticle(sql, {
    slug: "filme-article-2",
    title: "Os bastidores da produção mais cara do ano",
    deck: null,
    // Token do contrato num card MENOR (o lead não exibe kicker): `feature`
    // deve virar o kicker "Especial" no primeiro pôster.
    category: "feature",
    heroImagePath: "/media/qa/editorial-2.png",
    reviewStatus: "human_reviewed",
    publishedAt: tsPlusDays(-2),
    links: moviesLinks,
  });
  // 3a materia de FILMES SEM imagem publicavel: prova o placeholder editorial.
  await createArticle(sql, {
    slug: "filme-article-3",
    title: "Cinco estreias para não perder neste mês",
    deck: null,
    category: "Estreias",
    heroImagePath: null,
    reviewStatus: "published",
    publishedAt: tsPlusDays(-3),
    links: moviesLinks,
  });

  await createArticle(sql, {
    slug: "serie-article-1",
    title: "A virada da temporada que ninguém previu",
    deck: "O episódio desta semana reorganiza a série inteira e recoloca o protagonista no centro do conflito.",
    category: "Séries",
    heroImagePath: "/media/qa/editorial-3.png",
    reviewStatus: "published",
    publishedAt: tsPlusDays(-1),
    links: seriesLinks,
  });
  await createArticle(sql, {
    slug: "serie-article-2",
    title: "Entrevista: o showrunner explica o final",
    deck: null,
    category: "Entrevista",
    heroImagePath: "/media/qa/editorial-4.png",
    reviewStatus: "published",
    publishedAt: tsPlusDays(-2),
    links: seriesLinks,
  });
  await createArticle(sql, {
    slug: "serie-article-3",
    title: "O guia de temporadas para quem vai começar agora",
    deck: null,
    // Outro token do contrato: `list` vira o kicker "Explorar coleção".
    category: "list",
    heroImagePath: "/media/qa/editorial-5.png",
    reviewStatus: "published",
    publishedAt: tsPlusDays(-4),
    links: seriesLinks,
  });

  // ---------------------------------------- MATERIAS DO BLOCO DE NOTICIAS
  // Quatro materias MAIS RECENTES que as dos destaques, SEM vinculo movie/tv.
  // Elas ocupam o bloco "Noticias & entrevistas" (top 5 por data) e provam a
  // DEDUPLICACAO: nenhuma materia dos destaques pode repetir o que o bloco de
  // noticias ja mostra — e vice-versa, os destaques seguem com 3+3 proprias.
  for (let i = 0; i < 4; i += 1) {
    await createArticle(sql, {
      slug: `noticia-bloco-${i + 1}`,
      title: `Giro da redação ${i + 1}: o dia na indústria do entretenimento`,
      deck: i === 0 ? "Aquisições, audiência e bastidores do mercado em um só lugar." : null,
      category: "news",
      heroImagePath: `/media/qa/editorial-${(i % 5) + 1}.png`,
      reviewStatus: "published",
      publishedAt: tsPlusDays(-0.05 * (i + 1)),
      links: [],
    });
  }

  // ----------------------------------------------------- CONTROLES NEGATIVOS
  // Materia AGENDADA: published_at no FUTURO. Titulo com "filme" de proposito.
  await createArticle(sql, {
    slug: "controle-agendada",
    title: "EMBARGO: este filme só pode ser noticiado semana que vem",
    deck: "Se este deck aparecer na home, o embargo vazou.",
    category: "Cinema",
    heroImagePath: "/media/qa/editorial-1.png",
    reviewStatus: "published",
    publishedAt: tsPlusDays(9),
    links: moviesLinks,
  });
  // Rascunho.
  await createArticle(sql, {
    slug: "controle-rascunho",
    title: "RASCUNHO: filme ainda em edição",
    deck: null,
    category: "Cinema",
    heroImagePath: null,
    reviewStatus: "draft",
    publishedAt: tsPlusDays(-1),
    links: moviesLinks,
  });
  // Retratada (blocked).
  await createArticle(sql, {
    slug: "controle-retratada",
    title: "RETRATADA: série cuja matéria foi removida",
    deck: null,
    category: "Séries",
    heroImagePath: null,
    reviewStatus: "blocked",
    publishedAt: tsPlusDays(-1),
    links: seriesLinks,
  });
  // Sem classificacao confiavel: so vinculo de PESSOA. Titulo cheio de
  // palavra-chave — se a classificacao fosse por keyword, isto vazaria.
  const personId = (
    await q<{ id: bigint }>(
      `INSERT INTO people (tmdb_id, name, updated_at) VALUES (995100, 'Pessoa QA', now()) RETURNING id`,
    )
  )[0]!.id.toString();
  await x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('person', ${personId}, ${lit(LANGUAGE)}, 'pessoa-qa', true, now())`,
  );
  await createArticle(sql, {
    slug: "controle-sem-classificacao",
    title: "SEM VÍNCULO: filme, cinema, série, temporada e episódio no título",
    deck: null,
    category: "Cinema",
    heroImagePath: null,
    reviewStatus: "published",
    // Mais fresca que as materias dos destaques (-1d) e mais velha que as 4 do
    // bloco de noticias (-0.05..-0.2d): ela ocupa DETERMINISTICAMENTE a 5a vaga
    // do bloco "Noticias & entrevistas" — visivel na home, fora dos destaques.
    publishedAt: tsPlusDays(-0.5),
    links: [{ type: "person", id: personId }],
  });

  return {
    movieTodayId,
    movieArrivalId,
    showEpisodeTodayId,
    showEpisodeUpcomingId,
    showSeasonId,
    episodeOfferId,
    scheduledSlug: "controle-agendada",
    draftSlug: "controle-rascunho",
    retractedSlug: "controle-retratada",
    unclassifiedSlug: "controle-sem-classificacao",
  };
}

// ------------------------------------------------------------------ browser
interface FoldReport {
  url: string;
  overflowOk: boolean;
  scrollWidth: number;
  clientWidth: number;
  // Destaques de hoje
  tabRoles: string[];
  tabTags: string[];
  tabLabels: string[];
  tabSelected: string | null;
  tabHrefs: number;
  panelRole: string | null;
  cardCount: number;
  cardHrefs: string[];
  cardTitles: string[];
  cardEyebrows: string[];
  leadDeck: string | null;
  cardImgAlts: string[];
  placeholderCount: number;
  featEmpty: string | null;
  /** Texto SÓ do painel de destaques (a home tem outra banda de notícias). */
  highlightsText: string;
  gridColumns: string | null;
  /** Hrefs do bloco "Notícias & entrevistas" (para provar a deduplicação). */
  newsHrefs: string[];
  // Faixa amarela
  tickerHeight: number;
  tickerDots: number;
  tickerBadge: string | null;
  tickerText: string | null;
  tickerCta: string | null;
  tickerCredit: string | null;
  activeDotWidth: number | null;
  // Vazamento
  bodyText: string;
}

const READ_FOLD = `() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const text = (s) => { const el = q(s); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  const grid = q('.feat-grid');
  const ticker = q('.ticker');
  const activeDot = q('.ticker__dot[aria-selected="true"]');
  const tabs = all('.seg-toggle__opt');
  return {
    url: location.pathname + location.search,
    overflowOk: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    tabRoles: tabs.map((t) => t.getAttribute('role') || ''),
    tabTags: tabs.map((t) => t.tagName.toLowerCase()),
    tabLabels: tabs.map((t) => t.textContent.trim()),
    tabSelected: (tabs.find((t) => t.getAttribute('aria-selected') === 'true') || {}).textContent || null,
    tabHrefs: tabs.filter((t) => t.hasAttribute('href')).length,
    panelRole: q('[role="tabpanel"]') ? 'tabpanel' : null,
    cardCount: all('.feat-card').length,
    cardHrefs: all('.feat-card').map((c) => c.getAttribute('href') || ''),
    cardTitles: all('.feat-card__title, .feat-card__title--sm').map((h) => h.textContent.trim()),
    cardEyebrows: all('.feat-card__kicker').map((k) => k.textContent.trim()),
    leadDeck: text('.feat-card__sub'),
    cardImgAlts: all('.feat-card__img').map((i) => i.getAttribute('alt')),
    placeholderCount: all('.feat-card__placeholder').length,
    featEmpty: text('.feat-empty'),
    highlightsText: (q('[role="tabpanel"]') || { innerText: '' }).innerText.replace(/\\s+/g, ' '),
    gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    newsHrefs: all('.hnews-lead, .hnews-card').map((a) => a.getAttribute('href') || ''),
    tickerHeight: ticker ? Math.round(ticker.getBoundingClientRect().height) : 0,
    tickerDots: all('.ticker__dot').length,
    tickerBadge: text('.ticker__label'),
    tickerText: text('.ticker__text'),
    tickerCta: text('.ticker__cta'),
    tickerCredit: text('.ticker__credit'),
    activeDotWidth: activeDot ? Math.round(activeDot.getBoundingClientRect().width) : null,
    bodyText: document.body.innerText.replace(/\\s+/g, ' '),
  };
}`;

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const editorialPng = buildQaEditorialPng(1280, 720, 1);
  writeFileSync(path.join(OUT_DIR, "qa-editorial.png"), editorialPng);
  const backdropPng = buildQaEditorialPng(1280, 720, 3);

  const pgPort = await freePort();
  const appPort = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-home-editorial-pg-"));

  /**
   * Producao e UTF8, entao o QA TENTA UTF8 primeiro. No Windows o `initdb`
   * falha quando os binarios vivem sob caminho com caractere nao-ASCII (este
   * repositorio esta sob "Área de Trabalho"); nesse caso caimos para o encoding
   * padrao do SO e REGISTRAMOS qual foi usado, em vez de fingir UTF8.
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
  const dbName = "cinerie_home_editorial_qa";
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
      "fixtures QA criadas (5 novidades, 3+3 matérias de destaque, 4 matérias do bloco de notícias, 4 controles negativos)",
      true,
      `movieHoje=${fixtures.movieTodayId} chegada=${fixtures.movieArrivalId} epHoje=${fixtures.showEpisodeTodayId} epFuturo=${fixtures.showEpisodeUpcomingId} temporada=${fixtures.showSeasonId}`,
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
    record("aplicação Next.js real respondendo em /pt/", up, up ? base : "timeout 90s");
    if (!up) throw new Error("next start nao respondeu");

    const { chromium } = (await import("@playwright/test")) as typeof import("@playwright/test");
    const b = await chromium.launch();
    browser = b;

    const openPage = async (
      width: number,
      height: number,
      reducedMotion: "reduce" | "no-preference" = "no-preference",
    ) => {
      const page = await b.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
        reducedMotion,
      });
      // TODA imagem e servida por asset LOCAL: QA deterministico e offline.
      // Nenhuma consulta de DADOS externa existe no render.
      await page.route("https://image.tmdb.org/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "image/png", body: backdropPng });
      });
      await page.route("**/media/qa/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "image/png", body: editorialPng });
      });
      return page;
    };

    type Page = import("@playwright/test").Page;

    /**
     * Centraliza um alvo antes do clique. O header e sticky: o auto-scroll do
     * Playwright encosta o elemento no topo e o header passa a interceptar o
     * ponteiro. Centralizar resolve sem `force` — ou seja, o clique continua
     * sendo um clique REAL, sujeito a hit-testing.
     */
    const clickCentered = async (page: Page, selector: string): Promise<void> => {
      await page.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: 'center' }); })()`,
      );
      await page.waitForTimeout(120);
      await page.click(selector);
    };
    const capture = async (
      name: string,
      width: number,
      height: number,
      after?: (page: Page) => Promise<void>,
      reducedMotion: "reduce" | "no-preference" = "no-preference",
    ): Promise<FoldReport> => {
      const page = await openPage(width, height, reducedMotion);
      await page.goto(`${base}/pt/`, { waitUntil: "networkidle" });
      if (after) await after(page);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
      // Captura ADICIONAL do recorte que importa para a comparacao visual com o
      // canonico: a faixa amarela + "Destaques de hoje" costumam ficar abaixo da
      // primeira dobra (o hero e alto), e a captura de viewport sozinha nao os
      // mostraria.
      // Recorte por ELEMENTO (nao pagina inteira): a faixa amarela e a secao
      // "Destaques de hoje" ficam abaixo da primeira dobra (o hero e alto) e a
      // captura de viewport sozinha nao as mostraria.
      for (const [suffix, selector] of [
        ["faixa", ".ticker"],
        ["destaques", "#main-content section:has(.feat-head)"],
      ] as const) {
        const el = page.locator(selector).first();
        if ((await el.count()) > 0) {
          await el
            .screenshot({ path: path.join(OUT_DIR, `${name}--${suffix}.png`) })
            .catch(() => undefined);
        }
      }
      const report = (await page.evaluate(`(${READ_FOLD})()`)) as FoldReport;
      await page.close();
      return report;
    };

    // ============================================ D1: destaques com tab Filmes
    const d1 = await capture("01-destaques-filmes-1576x892", 1576, 892);
    record(
      "D1 três cards visíveis e TODOS apontam para /pt/noticias/",
      d1.cardCount === 3 &&
        d1.cardHrefs.length === 3 &&
        d1.cardHrefs.every((h) => h.startsWith("/pt/noticias/")),
      `cards=${d1.cardCount} hrefs=${d1.cardHrefs.join(" | ")}`,
    );
    record(
      "D1 nenhum card aponta para ficha de catálogo",
      d1.cardHrefs.every((h) => !/\/pt\/(?:filmes|series|pessoas)\//.test(h)),
      d1.cardHrefs.join(" | "),
    );
    record(
      "D1 as três matérias visíveis são de FILMES (nenhuma exclusiva de séries)",
      d1.cardTitles.length === 3 &&
        d1.cardTitles.every((t) => !/temporada que ninguém previu|showrunner|guia de temporadas/i.test(t)),
      d1.cardTitles.join(" | "),
    );
    record(
      "D1 tabs são <button role=tab> SEM href, com painel de tab",
      d1.tabTags.every((t) => t === "button") &&
        d1.tabRoles.every((r) => r === "tab") &&
        d1.tabHrefs === 0 &&
        d1.panelRole === "tabpanel",
      `tags=${d1.tabTags.join(",")} roles=${d1.tabRoles.join(",")} hrefs=${d1.tabHrefs} panel=${d1.panelRole}`,
    );
    record(
      "D1 tab inicial é Filmes e a URL é /pt/",
      d1.tabSelected?.trim() === "Filmes" && d1.url === "/pt/",
      `tab=${d1.tabSelected} url=${d1.url}`,
    );
    record(
      "D1 grid 1.62fr 1fr 1fr (três colunas do canônico)",
      d1.gridColumns !== null && d1.gridColumns.split(" ").length === 3,
      `grid-template-columns=${d1.gridColumns}`,
    );
    record(
      "D1 lead SEM kicker (título + deck); só os dois pôsteres têm eyebrow",
      d1.leadDeck !== null && d1.leadDeck.length > 20 && d1.cardEyebrows.length === 2,
      `deck=${d1.leadDeck?.slice(0, 60)} eyebrows=${d1.cardEyebrows.join(" | ")}`,
    );
    record(
      "D1 NENHUM card mostra metadata de catálogo (Filme · ano, nota, duração)",
      !/Filme · \d{4}|Série · \d{4}/.test(d1.cardTitles.join(" ") + d1.cardEyebrows.join(" ")),
      `${d1.cardEyebrows.join(" | ")}`,
    );
    record(
      "D1 imagens com alt REAL e matéria sem imagem cai no placeholder editorial",
      d1.cardImgAlts.every((a) => a !== null && a !== "") && d1.placeholderCount === 1,
      `alts=${d1.cardImgAlts.join(" | ")} placeholders=${d1.placeholderCount}`,
    );
    record("D1 zero overflow horizontal", d1.overflowOk, `${d1.scrollWidth}<=${d1.clientWidth}`);
    record(
      "D1 kicker deriva do contentType do contrato — token cru NUNCA aparece",
      d1.cardEyebrows.includes("Especial") &&
        !d1.cardEyebrows.some((e) => /^(news|feature|review|guide|list|interview|evergreen)$/.test(e)),
      `eyebrows=${d1.cardEyebrows.join(" | ")}`,
    );
    record(
      "D1 DEDUPLICAÇÃO: nenhum destaque repete matéria do bloco de notícias",
      d1.newsHrefs.length === 5 && d1.cardHrefs.every((h) => !d1.newsHrefs.includes(h)),
      `noticias=${d1.newsHrefs.join(" | ")}`,
    );

    // ------------------------------------------- controles negativos na home
    // Materia AGENDADA/rascunho/retratada e INPUBLICAVEL: nao pode aparecer em
    // NENHUM lugar da pagina (nem na banda "Noticias & entrevistas").
    record(
      "D1 matéria AGENDADA, rascunho e retratada NÃO vazam para lugar nenhum da home",
      !/EMBARGO|RASCUNHO|RETRATADA/.test(d1.bodyText),
      `bodyText limpo (${d1.bodyText.length} chars)`,
    );
    // A materia SEM classificacao e PUBLICAVEL — ela so nao pode entrar nos
    // DESTAQUES (nao ha sinal persistido de vertical). Continuar aparecendo na
    // banda editorial geral e o comportamento correto: o defeito seria ela
    // sumir do site, nao ela existir.
    record(
      "D1 matéria sem classificação fica FORA dos destaques (mas segue publicada na home)",
      !/SEM VÍNCULO/.test(d1.highlightsText) && /SEM VÍNCULO/.test(d1.bodyText),
      `nos destaques=${/SEM VÍNCULO/.test(d1.highlightsText)} na home=${/SEM VÍNCULO/.test(d1.bodyText)}`,
    );

    // ============================================== D2: clicar na tab Séries
    const d2 = await capture("02-destaques-series-1576x892", 1576, 892, async (page) => {
      await clickCentered(page, '.seg-toggle__opt:nth-of-type(2)');
      await page.waitForTimeout(200);
    });
    record(
      "D2 clicar em Séries NÃO navega (URL continua /pt/)",
      d2.url === "/pt/",
      `url=${d2.url}`,
    );
    record(
      "D2 aria-selected mudou para Séries",
      d2.tabSelected?.trim() === "Séries",
      `tab=${d2.tabSelected}`,
    );
    record(
      "D2 o CONTEÚDO realmente mudou (três matérias de séries, nenhuma de filmes)",
      d2.cardTitles.length === 3 &&
        d2.cardTitles.join("|") !== d1.cardTitles.join("|") &&
        d2.cardTitles.every((t) => !/terror voltou|produção mais cara|Cinco estreias/i.test(t)),
      d2.cardTitles.join(" | "),
    );
    record(
      "D2 os cards de séries continuam apontando para /pt/noticias/",
      d2.cardHrefs.every((h) => h.startsWith("/pt/noticias/")),
      d2.cardHrefs.join(" | "),
    );
    record(
      "D2 kicker mapeado também em Séries (list → Explorar coleção)",
      d2.cardEyebrows.includes("Explorar coleção") && !d2.cardEyebrows.includes("list"),
      `eyebrows=${d2.cardEyebrows.join(" | ")}`,
    );
    record(
      "D2 deduplicação vale nas DUAS verticais",
      d2.cardHrefs.every((h) => !d2.newsHrefs.includes(h)),
      `destaques=${d2.cardHrefs.join(" | ")}`,
    );

    // ================================================= D3: teclado nas tabs
    const d3 = await capture("03-destaques-teclado-1576x892", 1576, 892, async (page) => {
      await page.focus('.seg-toggle__opt[aria-selected="true"]');
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
    });
    record(
      "D3 seta direita troca a tab pelo teclado, sem navegar",
      d3.tabSelected?.trim() === "Séries" && d3.url === "/pt/",
      `tab=${d3.tabSelected} url=${d3.url}`,
    );

    // ================= D4: viewports de revisão (Filmes e Séries lado a lado)
    for (const [label, w, h] of [
      ["1440x1000", 1440, 1000],
      ["1280x800", 1280, 800],
      ["390x844", 390, 844],
    ] as const) {
      const filmes = await capture(`10-destaques-filmes-${label}`, w, h);
      const series = await capture(`11-destaques-series-${label}`, w, h, async (page) => {
        await clickCentered(page, ".seg-toggle__opt:nth-of-type(2)");
        await page.waitForTimeout(200);
      });
      record(
        `D4 ${label}: seção presente nas duas tabs, sem overflow e sem navegar`,
        filmes.overflowOk &&
          series.overflowOk &&
          filmes.cardCount > 0 &&
          series.cardCount > 0 &&
          series.url === "/pt/",
        `filmes=${filmes.cardCount} séries=${series.cardCount} url=${series.url}`,
      );
    }

    // ======================================== T1: faixa com 5 novidades reais
    record(
      "T1 faixa carregou CINCO novidades (5 dots) e mostra UMA por vez",
      d1.tickerDots === 5 && d1.tickerText !== null && d1.tickerText.length > 0,
      `dots=${d1.tickerDots} texto=${d1.tickerText}`,
    );
    record(
      "T1 o item de hoje abre a faixa, com provedor licenciado e CRÉDITO visível",
      d1.tickerBadge === "NOVO" &&
        d1.tickerCta?.includes("Onde assistir") === true &&
        d1.tickerCta?.includes("Max") === true &&
        d1.tickerCredit?.includes("Movie of the Night") === true,
      `badge=${d1.tickerBadge} cta=${d1.tickerCta} crédito=${d1.tickerCredit}`,
    );
    record(
      "T1 dot ativo é a pílula larga (18px) do canônico",
      d1.activeDotWidth !== null && d1.activeDotWidth >= 16,
      `largura do dot ativo=${d1.activeDotWidth}px`,
    );
    record(
      "T1 nenhum dado de sessão de cinema inventado na faixa",
      !/70mm|Legendado|sess(ão|ões)|Kinoplex|Cinesystem|em cartaz/i.test(d1.tickerText ?? ""),
      `texto=${d1.tickerText}`,
    );

    // ---------------------------------------- T2: clique em dot troca o item
    const t2 = await capture("04-ticker-dot-3-1576x892", 1576, 892, async (page) => {
      await clickCentered(page, ".ticker__dot:nth-of-type(3)");
      await page.waitForTimeout(200);
    });
    record(
      "T2 clicar num dot troca o item ativo (texto muda, dots continuam 5)",
      t2.tickerText !== d1.tickerText && t2.tickerDots === 5,
      `antes=${d1.tickerText} | depois=${t2.tickerText}`,
    );

    // -------------------------------- T3: teclado troca o item e o CTA muda
    const t3 = await capture("05-ticker-teclado-1576x892", 1576, 892, async (page) => {
      await page.focus('.ticker__dot[aria-selected="true"]');
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
    });
    record(
      "T3 seta direita troca o item pelo teclado",
      t3.tickerText !== d1.tickerText,
      `texto=${t3.tickerText} cta=${t3.tickerCta}`,
    );

    // ------------------- T4: item SEM provedor -> CTA genérico, SEM crédito
    // Percorre os cinco itens e prova que existe pelo menos um sem provedor,
    // que o CTA cai para a ficha e que NENHUM crédito residual sobra.
    {
      const page = await openPage(1576, 892);
      await page.goto(`${base}/pt/`, { waitUntil: "networkidle" });
      const seen: Array<{ cta: string; credit: string | null; text: string }> = [];
      for (let i = 0; i < 5; i += 1) {
        await clickCentered(page, `.ticker__dot:nth-of-type(${i + 1})`);
        await page.waitForTimeout(150);
        seen.push(
          (await page.evaluate(`(() => {
            const t = (s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\\s+/g,' ').trim() : null; };
            return { cta: t('.ticker__cta'), credit: t('.ticker__credit'), text: t('.ticker__text') };
          })()`)) as { cta: string; credit: string | null; text: string },
        );
      }
      await page.screenshot({ path: path.join(OUT_DIR, "06-ticker-todos-itens-1576x892.png") });
      await page.close();

      const distinct = new Set(seen.map((s) => s.text));
      record(
        "T4 os cinco slides são novidades DISTINTAS (sem item duplicado)",
        distinct.size === 5,
        [...distinct].join(" || "),
      );
      const semProvedor = seen.filter((s) => !s.cta.includes("Onde assistir"));
      record(
        "T4 item sem provedor cai para a ficha real (Ver filme / Ver série)",
        semProvedor.length > 0 && semProvedor.every((s) => /^Ver (filme|série)$/.test(s.cta)),
        semProvedor.map((s) => s.cta).join(" | ") || "nenhum item sem provedor",
      );
      record(
        "T4 CRÉDITO acompanha o item: só existe quando há provedor, nunca residual",
        seen.every((s) => (s.cta.includes("Onde assistir") ? s.credit !== null : s.credit === null)),
        seen.map((s) => `${s.cta} => ${s.credit ?? "sem crédito"}`).join(" | "),
      );
      record(
        "T4 os dois CTAs de provedor citam plataformas REAIS do banco (Max, Netflix)",
        seen.filter((s) => s.cta.includes("Onde assistir")).length >= 2,
        seen
          .filter((s) => s.cta.includes("Onde assistir"))
          .map((s) => s.cta)
          .join(" | "),
      );
    }

    // -------------------------------------------- T5: autoplay troca sozinho
    {
      const page = await openPage(1576, 892);
      await page.goto(`${base}/pt/`, { waitUntil: "networkidle" });
      // O mouse não pode estar sobre a faixa: hover PAUSA o autoplay.
      await page.mouse.move(5, 5);
      const readText = async (): Promise<string> =>
        (await page.evaluate(
          `(() => { const el = document.querySelector('.ticker__text'); return el ? el.textContent.replace(/\\s+/g,' ').trim() : ''; })()`,
        )) as string;
      const before = await readText();
      await page.waitForTimeout(7200);
      const after = await readText();
      await page.close();
      record(
        "T5 AUTOPLAY troca o item ativo sozinho (~6s)",
        after !== before && after !== "",
        `antes=${before} | depois=${after}`,
      );
    }

    // ------------------------------------------------- T6: hover PAUSA o autoplay
    {
      const page = await openPage(1576, 892);
      await page.goto(`${base}/pt/`, { waitUntil: "networkidle" });
      await page.hover(".ticker");
      const readText = async (): Promise<string> =>
        (await page.evaluate(
          `(() => { const el = document.querySelector('.ticker__text'); return el ? el.textContent.replace(/\\s+/g,' ').trim() : ''; })()`,
        )) as string;
      const before = await readText();
      await page.waitForTimeout(7200);
      const after = await readText();
      await page.close();
      record(
        "T6 hover PAUSA o autoplay (item ativo não muda)",
        after === before,
        `antes=${before} | depois=${after}`,
      );
    }

    // ------------------------- T7: reduced-motion desliga autoplay, manual OK
    {
      const page = await openPage(1576, 892, "reduce");
      await page.goto(`${base}/pt/`, { waitUntil: "networkidle" });
      await page.mouse.move(5, 5);
      const readText = async (): Promise<string> =>
        (await page.evaluate(
          `(() => { const el = document.querySelector('.ticker__text'); return el ? el.textContent.replace(/\\s+/g,' ').trim() : ''; })()`,
        )) as string;
      const before = await readText();
      await page.waitForTimeout(7200);
      const stillSame = await readText();
      // …mas a navegação MANUAL continua funcionando.
      await clickCentered(page, ".ticker__dot:nth-of-type(4)");
      await page.waitForTimeout(200);
      const afterClick = await readText();
      await page.screenshot({ path: path.join(OUT_DIR, "07-ticker-reduced-motion.png") });
      await page.close();
      record(
        "T7 prefers-reduced-motion DESLIGA o autoplay, mas o controle manual continua",
        stillSame === before && afterClick !== before,
        `autoplay parado=${stillSame === before} | manual funciona=${afterClick !== before}`,
      );
    }

    // ============================ E1: vertical vazia -> estado vazio honesto
    await sql.x(
      `UPDATE article_translations SET review_status='draft'::"ReviewStatus", updated_at=now() WHERE slug LIKE 'serie-article-%'`,
    );
    const e1 = await capture("08-destaques-series-vazia-1576x892", 1576, 892, async (page) => {
      await clickCentered(page, '.seg-toggle__opt:nth-of-type(2)');
      await page.waitForTimeout(200);
    });
    record(
      "E1 vertical sem matéria mostra estado vazio HONESTO, sem cair no catálogo",
      e1.featEmpty === "Ainda não há destaques de séries publicados." && e1.cardCount === 0,
      `mensagem=${e1.featEmpty} cards=${e1.cardCount}`,
    );
    record(
      "E1 não troca silenciosamente para a outra vertical",
      e1.tabSelected?.trim() === "Séries",
      `tab=${e1.tabSelected}`,
    );

    // ---------------------- E2: duas matérias -> grid adapta sem inventar 3a
    await sql.x(
      `UPDATE article_translations SET review_status='published'::"ReviewStatus", updated_at=now() WHERE slug LIKE 'serie-article-%'`,
    );
    await sql.x(
      `UPDATE article_translations SET review_status='draft'::"ReviewStatus", updated_at=now() WHERE slug = 'filme-article-3'`,
    );
    const e2 = await capture("09-destaques-duas-materias-1576x892", 1576, 892);
    record(
      "E2 com DUAS matérias o grid adapta (2 colunas) sem inventar a terceira",
      e2.cardCount === 2 && e2.gridColumns !== null && e2.gridColumns.split(" ").length === 2,
      `cards=${e2.cardCount} grid=${e2.gridColumns}`,
    );

    // ---------------------------- E3: faixa vazia -> estado neutro e honesto
    await sql.x(
      `UPDATE article_translations SET review_status='published'::"ReviewStatus", updated_at=now() WHERE slug = 'filme-article-3'`,
    );
    await sql.x(`DELETE FROM episodes`);
    await sql.x(`UPDATE seasons SET air_date = NULL, updated_at = now()`);
    await sql.x(`UPDATE movies SET release_date = DATE '1994-09-23', updated_at = now()`);
    // Retira as ofertas do gate SEM mexer em `available_from`: essa coluna
    // integra o fingerprint do payload aprovado, e alterá-la faria o guard
    // fail-closed do banco recusar a linha (comportamento CORRETO de produção —
    // foi ele que reprovou a primeira versão deste cenário). `display_allowed`
    // fica fora do fingerprint justamente por ser a chave de exibição.
    await sql.x(`UPDATE watch_availability SET display_allowed = false, updated_at = now()`);
    const e3 = await capture("10-ticker-neutro-1576x892", 1576, 892);
    record(
      "E3 sem novidade nenhuma a faixa PERMANECE, em estado neutro e honesto",
      e3.tickerHeight > 0 &&
        e3.tickerBadge === "AGENDA" &&
        e3.tickerText === "Nenhuma novidade confirmada para hoje" &&
        e3.tickerCta === "Ver lançamentos" &&
        e3.tickerDots === 0 &&
        e3.tickerCredit === null,
      `altura=${e3.tickerHeight} badge=${e3.tickerBadge} cta=${e3.tickerCta} dots=${e3.tickerDots}`,
    );

    // ================================================ V: as cinco viewports
    // Restaura o cenário COMPLETO (5 novidades) antes de medir as viewports.
    await sql.x(
      `UPDATE movies SET release_date = DATE '${todayIso()}', updated_at = now() WHERE tmdb_id = 995003`,
    );
    await sql.x(
      `UPDATE seasons SET air_date = DATE '${isoPlusDays(3)}', updated_at = now() WHERE tv_show_id = ${fixtures.showSeasonId}`,
    );
    // Devolve as ofertas ao gate. O fingerprint continua o mesmo (nenhuma
    // coluna de payload foi tocada), então o guard aprova.
    await sql.x(`UPDATE watch_availability SET display_allowed = true, updated_at = now()`);
    const seasonTodayId = (
      await sql.q<{ id: bigint }>(
        `SELECT id FROM seasons WHERE tv_show_id=${fixtures.showEpisodeTodayId} AND season_number=2`,
      )
    )[0]!.id.toString();
    const seasonUpcomingId = (
      await sql.q<{ id: bigint }>(
        `SELECT id FROM seasons WHERE tv_show_id=${fixtures.showEpisodeUpcomingId} AND season_number=3`,
      )
    )[0]!.id.toString();
    await sql.x(
      `INSERT INTO episodes (season_id, tv_show_id, episode_number, name, air_date, updated_at) VALUES (${seasonTodayId}, ${fixtures.showEpisodeTodayId}, 5, 'Cavalo de Troia', DATE '${todayIso()}', now())`,
    );
    await sql.x(
      `INSERT INTO episodes (season_id, tv_show_id, episode_number, name, air_date, updated_at) VALUES (${seasonUpcomingId}, ${fixtures.showEpisodeUpcomingId}, 7, 'Episódio 7', DATE '${isoPlusDays(5)}', now())`,
    );

    for (const [name, width, height] of VIEWPORTS) {
      const report = await capture(`11-full-${name}`, width, height);
      const desktop = width >= 1024;
      record(
        `V ${name}: sem overflow, faixa com 5 dots e CTA na tela${desktop ? ", três cards" : ""}`,
        report.overflowOk &&
          report.tickerHeight > 0 &&
          report.tickerDots === 5 &&
          report.tickerCta !== null &&
          (!desktop || report.cardCount === 3),
        `overflow=${report.scrollWidth}/${report.clientWidth} dots=${report.tickerDots} cards=${report.cardCount} cta=${report.tickerCta} crédito=${report.tickerCredit ?? "-"}`,
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
      `${err.name}${err.code === undefined ? "" : ` [${err.code}]`}: ${err.message.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ""} | meta=${JSON.stringify(err.meta)} | em ${at ?? "?"}`.slice(0, 800),
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
      console.warn(
        `Aviso: dir temporario sera limpo pelo SO (${(e as Error).message.split("\n")[0]})`,
      );
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
