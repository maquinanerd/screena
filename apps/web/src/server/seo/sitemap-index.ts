/**
 * sitemap-index.ts — Camada SERVER-ONLY do sitemap index + shards, PAGINADO NO
 * PostgreSQL (Fase 3, §11).
 *
 * O runtime NUNCA carrega o catalogo inteiro em memoria:
 *  - `/sitemap.xml` (index) consulta apenas CONTAGENS por (idioma, tipo) e o
 *    `MAX(updated_at)` de cada conjunto, e deriva o numero de shards por
 *    `ceil(total / limit)`. So gera os ENDERECOS dos shards — sem buscar URLs.
 *  - `/sitemaps/{id}.xml` (shard) consulta SOMENTE a sua pagina, de UM tipo, com
 *    `ORDER BY` deterministico + `LIMIT/OFFSET` no banco. Nao busca outras
 *    paginas, nao mistura tipos, nao monta todos os shards para devolver um.
 *
 * Todas as EXCLUSOES acontecem no WHERE (nunca "carregar tudo e filtrar com um
 * Set em memoria"): idioma nao publicado, entidade sem slug canonico/sem titulo,
 * decisao vigente `!= index`, e para noticia licenca/publicacao/atribuicao/
 * linkback ausentes. SQL sempre PARAMETRIZADO (`$queryRaw` tagged template) — a
 * entrada do shard NUNCA e concatenada em SQL.
 *
 * PESSOA tem um gate EXTRA: alem de slug canonico e nome, precisa ter ao menos
 * um credito (elenco ou equipe) em um FILME ou SERIE que ela propria seja
 * publicavel (slug canonico no idioma + sem decisao vigente `!= index`). Sem
 * isso, cada titulo ingerido despejava o elenco inteiro no sitemap — o catalogo
 * observado tinha ~22.400 URLs de pessoa contra ~129 filmes e ~110 series. A
 * regra canonica (e o porque) vive em `@screena/seo` -> `person-eligibility.ts`;
 * aqui esta a sua traducao para SQL. O gate aparece DUAS vezes (contagem e
 * pagina) porque cada tipo repete seu WHERE nos dois lugares; `sitemap-person-
 * eligibility.test.ts` trava que as duas copias continuam identicas — se elas
 * divergirem, o index anuncia N shards que a pagina nao consegue preencher.
 *
 * Invariantes 3/4: zero API externa, zero Gemini; so PostgreSQL local. FAIL-CLOSED
 * em falha de banco. Serializacao XML pura via `@screena/seo`
 * (`renderUrlset`/`renderSitemapIndex`). `planSitemapShards` NAO e o mecanismo de
 * runtime — permanece no pacote SEO apenas para colecoes pequenas/testes puros.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  renderSitemapIndex,
  renderUrlset,
  SITEMAP_CONTENT_TYPE,
  SITEMAP_URL_LIMIT,
  type SitemapIndexXmlEntry,
  type SitemapXmlUrl,
} from "@screena/seo";

import {
  canonicalPublicUrl,
  episodePath,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  imagesGalleryPath,
  seasonPath,
  videosGalleryPath,
  SERIES_INDEX_PATH,
  SITE_URL,
} from "../../lib/site";
import { evaluateEntityIndexIndexability } from "../../lib/entity-index-presenter";
import { evaluateNewsIndexIndexability, MIN_ARTICLE_BODY_CHARS } from "../../lib/news-presenter";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
} from "../../lib/portal-presenter";
import {
  IMAGES_INDEX_FLOOR,
  VIDEOS_INDEX_FLOOR,
} from "../../lib/gallery-presenter";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Unico idioma com dados publicados no sitemap hoje (dados sob language_code). */
export const SITEMAP_LANGUAGE = "pt-BR";

/** Tipos cuja URL e INDEX + slug canonico proprio. */
export type SimpleSitemapType = "movies" | "series" | "people" | "news";
/** Tipos de entidade paginados (com rota publica real). `static` e a parte fixa. */
export type EntitySitemapType =
  | SimpleSitemapType
  | "seasons"
  | "episodes"
  /**
   * As GALERIAS de imagem e de video, de filme E de serie no mesmo shard.
   *
   * O nome do tipo e o SEGMENTO da rota (`imagens`/`videos`) de proposito: um
   * terceiro vocabulario ("galleries", "media") criaria mais um lugar em que a
   * mesma coisa tem outro nome.
   *
   * O PISO ENTRA NO `WHERE`, e nao em codigo depois da consulta. Uma galeria
   * abaixo do piso recebe `noindex` na propria pagina, e a regra de SEO e clara:
   * pagina `noindex` NUNCA entra no sitemap. Filtrar fora do SQL faria a
   * CONTAGEM do index divergir das URLs do shard — o index prometeria N e o
   * shard entregaria menos, que e a forma mais cara de sitemap errado.
   */
  | "imagens"
  | "videos";
/**
 * Todos os tipos que o codigo SABE montar. Nao e o que o sitemap PUBLICA — ver
 * {@link SUSPENDED_SITEMAP_TYPES} e {@link ENTITY_TYPES}.
 */
const SUPPORTED_ENTITY_TYPES: readonly EntitySitemapType[] = [
  "movies",
  "series",
  "people",
  "news",
  "seasons",
  "episodes",
  "imagens",
  "videos",
];

/**
 * VALVULA DE EMERGENCIA — 2026-08-27, por decisao do dono.
 *
 * O QUE FOI MEDIDO (sitemap de producao, shard a shard, 2026-08-27):
 *
 *   episodes  3.793.672 URLs  (78 shards)  93,22%
 *   seasons     127.870 URLs  ( 3 shards)   3,14%
 *   people       43.975 URLs                1,08%
 *   imagens      41.230 URLs                1,01%
 *   series       31.596 URLs                0,78%
 *   movies       30.948 URLs                0,76%
 *   videos          140 · news 7 · static 6
 *   ------------------------------------------------
 *   TOTAL     4.069.444 URLs   contra 53.054 em 2026-08-22 (77x em cinco dias)
 *
 * Temporada e episodio somam 96,36% do volume. A pagina de episodio rende ~108
 * palavras dentro de `<main>` — numero, data e a sinopse quando existe. Nao ha
 * elenco, direcao nem imagem propria. Declarar 3,9 milhoes dessas como validas
 * gasta orcamento de rastreio do dominio inteiro para publicar casca.
 *
 * POR QUE UMA LISTA, E NAO UM GATE POR DADO: o gate por dado e a Fase 3
 * (`page_indexability_decisions`, com "sem linha = nao indexa"), e ele depende
 * de um produtor rodar contra o banco de producao. Esta valvula nao depende de
 * nada alem do deploy — e por isso ela existe: para parar a sangria HOJE.
 *
 * COMO ELA MORRE: quando a Fase 3 estiver aplicada, o gate volta a perguntar
 * pelo DADO (episodio COM sinopse indexa; sem sinopse nao) e esta lista volta a
 * ser vazia. `sitemap-emergency-valve.test.ts` documenta a saida.
 *
 * O par obrigatorio: sair do sitemap NAO desindexa o que o Google ja pegou.
 * Estes mesmos tipos passam a emitir `noindex, follow` na propria pagina — ver
 * `apps/web/src/server/seo/suspended-pages.ts`. As duas coisas, ou nenhuma
 * resolve.
 */
export const SUSPENDED_SITEMAP_TYPES: readonly EntitySitemapType[] = [
  "seasons",
  "episodes",
];

/** O que o sitemap PUBLICA hoje: o suportado menos o suspenso. */
const ENTITY_TYPES: readonly EntitySitemapType[] = SUPPORTED_ENTITY_TYPES.filter(
  (type) => !SUSPENDED_SITEMAP_TYPES.includes(type),
);

/**
 * Tipos aceitos por `parseShardId`. Tipo suspenso NAO entra: o shard antigo
 * (`sitemap-pt-BR-episodes-42.xml`) precisa responder 404, e nao continuar
 * servindo 50.000 URLs para quem guardou o endereco.
 */
const ALL_TYPES: readonly string[] = [...ENTITY_TYPES, "static"];

/**
 * TETO DECLARADO DE URLs DO SITEMAP INTEIRO.
 *
 * POR QUE ISTO EXISTE. Em 2026-08-22 o sitemap tinha 53.054 URLs. Em 2026-08-27
 * tinha 4.069.444 — 77x em cinco dias — e NENHUM alarme disparou. Nao disparou
 * porque nada nunca comparou o total a coisa nenhuma: `SITEMAP_URL_LIMIT`
 * pagina o shard (50.000 por arquivo) e nao conhece o total, e as duas rotas do
 * sitemap sao `force-dynamic` — elas nao sao geradas no build, sao montadas a
 * cada requisicao direto do PostgreSQL. Nao houve deploy, nao houve mudanca de
 * codigo e nao houve linha de log: o catalogo cresceu e o sitemap cresceu junto,
 * calado. Sem um teto, a proxima vez tambem passaria em silencio.
 *
 * O teto e sobre o TOTAL PUBLICADO (a soma das contagens de `ENTITY_TYPES`),
 * nao sobre o shard. Ele nao substitui a politica por dado da Fase 3 — e o
 * detector de fumaca que avisa quando a politica falhou.
 *
 * ESTOURAR O TETO E FAIL-CLOSED: o index sai VAZIO e o erro vai para o log, do
 * mesmo jeito que uma falha de banco. Publicar milhoes de URLs por engano e
 * mais caro do que publicar nenhuma por um ciclo. Subir este numero e uma
 * mudanca de codigo revisada — que e exatamente o controle que faltava.
 *
 * Calibragem (2026-08-27, depois da valvula): ~105.000 URLs publicadas. O teto
 * a 300.000 tolera quase 3x e ainda pega um evento de ordem de grandeza.
 *
 * ESTE TETO E UM PRAZO, NAO UMA FOLGA. Medido no mesmo dia, em quatro leituras
 * do shard de filmes ao longo de 84 minutos: 30.948 -> 32.050 -> 33.720 ->
 * 34.735. Sao ~2.700 filmes por hora, ~65.000 por dia — a ingestao cria slug
 * para todo titulo descoberto, e o sitemap publica todo slug. Nesse ritmo o
 * teto e cruzado em cerca de tres dias, e ai o index sai vazio.
 *
 * Isso e o teto FUNCIONANDO: o problema nao e o numero aqui, e um catalogo que
 * cresce 65.000 fichas por dia sem que nenhuma delas precise ter sinopse ou
 * poster para entrar. Quem segura essa linha e a Fase 3 (gate por DADO), nao um
 * numero maior escrito aqui. Subir este valor sem ligar o gate por dado so
 * troca a data do estouro.
 */
export const SITEMAP_TOTAL_URL_CEILING = 300_000;

/** Erro do teto — separado para o teste apontar para a causa, nao para a forma. */
export class SitemapCeilingExceededError extends Error {
  constructor(
    readonly total: number,
    readonly ceiling: number,
    readonly byType: Readonly<Record<string, number>>,
  ) {
    super(
      `sitemap: ${total} URLs excedem o teto declarado de ${ceiling}. ` +
        `Por tipo: ${Object.entries(byType)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}. ` +
        "Ou a politica de indexabilidade parou de filtrar, ou o catalogo mudou de " +
        "ordem de grandeza. Ate alguem olhar, o sitemap sai vazio.",
    );
    this.name = "SitemapCeilingExceededError";
  }
}

const INDEX_PATH: Readonly<Record<SimpleSitemapType, string>> = {
  movies: MOVIES_INDEX_PATH,
  series: SERIES_INDEX_PATH,
  people: PEOPLE_INDEX_PATH,
  news: NEWS_INDEX_PATH,
};

const ENTITY_CHANGEFREQ: Readonly<Record<EntitySitemapType, string>> = {
  movies: "monthly",
  series: "monthly",
  people: "monthly",
  news: "weekly",
  seasons: "monthly",
  episodes: "monthly",
  // A galeria muda quando a midia do titulo muda, que e o ritmo do `sync_media`
  // (7 dias). "monthly" seria otimista; "weekly" e o que o dado faz.
  imagens: "weekly",
  videos: "weekly",
};
const ENTITY_PRIORITY: Readonly<Record<EntitySitemapType, number>> = {
  movies: 0.5,
  series: 0.5,
  people: 0.5,
  news: 0.6,
  seasons: 0.4,
  episodes: 0.3,
  // Abaixo de temporada: sao sub-paginas de midia, nao a obra.
  imagens: 0.3,
  videos: 0.3,
};

export interface SitemapXmlResponse {
  xml: string;
  contentType: string;
}

export interface SitemapPageOptions {
  /**
   * URLs por shard. Default = `SITEMAP_URL_LIMIT` (producao). Existe para TESTES
   * (limite reduzido) — nunca muda o limite de producao.
   */
  limit?: number;
}

interface Aggregate {
  count: number;
  maxLastmod: Date | null;
}

interface PageRow {
  slug: string;
  lastmod: Date | null;
}

function resolveLimit(opts?: SitemapPageOptions): number {
  const limit = opts?.limit;
  return limit !== undefined && Number.isInteger(limit) && limit > 0
    ? limit
    : SITEMAP_URL_LIMIT;
}

function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Consultas por tipo: CONTAGEM (+ max lastmod) e PAGINA (LIMIT/OFFSET no banco).
// Exclusoes 100% no WHERE. Idioma/limite/offset sao PARAMETROS ($queryRaw).
// ---------------------------------------------------------------------------

async function aggregateEntity(
  prisma: PrismaClient,
  type: EntitySitemapType,
  language: string,
): Promise<Aggregate> {
  let rows: { n: number; maxmod: Date | null }[];
  if (type === "movies") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(m.updated_at) AS maxmod
      FROM slugs s JOIN movies m ON m.id = s.entity_id
      WHERE s.entity_type = 'movie' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(m.title_original) <> ''
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'movie' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')`;
  } else if (type === "series") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(t.updated_at) AS maxmod
      FROM slugs s JOIN tv_shows t ON t.id = s.entity_id
      WHERE s.entity_type = 'tv' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(t.name_original) <> ''
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'tv' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')`;
  } else if (type === "people") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(p.updated_at) AS maxmod
      FROM slugs s JOIN people p ON p.id = s.entity_id
      WHERE s.entity_type = 'person' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(p.name) <> ''
        -- VALVULA 2026-08-27 (ver SUSPENDED_SITEMAP_TYPES): pessoa sem
        -- biografia EXIBIVEL ou sem foto rende uma ficha de ~52 palavras dentro
        -- de <main> — nome, papel e uma lista de links. Medido em 2026-08-27:
        -- 0 de 300 pessoas do sitemap exibiam biografia. Sao os MESMOS
        -- predicados que o produtor da Fase 3 usa para decidir no_biography /
        -- no_image (services/ingestion/src/persistence/indexability-writer.ts),
        -- escritos aqui para nao dependerem de o produtor ja ter rodado.
        -- Texto E licenca: a coluna de governanca nasce unknown, e bio ingerida
        -- sem liberacao nao aparece na tela (invariante 6).
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND BTRIM(COALESCE(p.biography, '')) <> ''
        AND p.biography_source_status::text IN ('official','licensed','third_party')
        AND BTRIM(COALESCE(p.profile_path, '')) <> ''
        AND EXISTS (
          SELECT 1 FROM cast_members cm
          JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
            AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions wd
              WHERE wd.entity_type = cm.entity_type AND wd.entity_id = cm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true AND wd.decision <> 'index')
          UNION ALL
          SELECT 1 FROM crew_members rm
          JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')
            AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions wd
              WHERE wd.entity_type = rm.entity_type AND wd.entity_id = rm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true AND wd.decision <> 'index')
        )
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')`;
  } else if (type === "news") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(at.updated_at) AS maxmod
      FROM article_translations at JOIN articles a ON a.id = at.article_id
      WHERE at.language_code = ${language}
        AND at.review_status IN ('human_reviewed','published')
        AND a.license_status IN ('official','licensed','third_party')
        AND a.display_allowed = true
        AND BTRIM(at.slug) <> '' AND BTRIM(at.title) <> ''
        AND COALESCE(at.published_at, a.published_at) <= (NOW() AT TIME ZONE 'UTC')
        AND at.index_status = 'index'
        AND LENGTH(BTRIM(COALESCE(at.body, ''))) >= ${MIN_ARTICLE_BODY_CHARS}
        AND (a.requires_attribution = false OR BTRIM(COALESCE(a.source_name, '')) <> '')
        AND (a.requires_linkback = false OR BTRIM(COALESCE(a.source_url, '')) <> '')`;
  } else if (type === "imagens" || type === "videos") {
    rows = await aggregateGallery(prisma, type, language);
  } else if (type === "seasons") {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(se.updated_at) AS maxmod
      FROM seasons se
      JOIN tv_shows t ON t.id = se.tv_show_id
      JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
        AND s.language_code = ${language} AND s.is_canonical = true
      WHERE BTRIM(t.name_original) <> ''
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'season' AND d.entity_id = se.id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')`;
  } else {
    rows = await prisma.$queryRaw<{ n: number; maxmod: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MAX(e.updated_at) AS maxmod
      FROM episodes e
      JOIN seasons se ON se.id = e.season_id
      JOIN tv_shows t ON t.id = e.tv_show_id
      JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
        AND s.language_code = ${language} AND s.is_canonical = true
      WHERE BTRIM(t.name_original) <> ''
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'episode' AND d.entity_id = e.id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')`;
  }
  return { count: rows[0]?.n ?? 0, maxLastmod: rows[0]?.maxmod ?? null };
}

// ---------------------------------------------------------------------------
// GALERIAS (/{filmes,series}/{slug}/{imagens,videos}/)
//
// O PISO ENTRA NO `WHERE` (`HAVING COUNT(*) >= piso`), e nao em codigo depois
// da consulta. A pagina abaixo do piso recebe `noindex`, e pagina `noindex`
// nunca entra no sitemap; filtrar fora do SQL faria a CONTAGEM do index
// divergir das URLs do shard.
//
// Os dois pisos vem de `gallery-presenter.ts` — os MESMOS que a pagina usa para
// decidir `robots`. Dois numeros para a mesma decisao divergiriam no primeiro
// ajuste.
// ---------------------------------------------------------------------------

/** Uma galeria elegivel: a vertical, o slug do titulo e o carimbo mais novo. */
interface GalleryRow {
  vertical: string;
  slug: string;
  lastmod: Date | null;
}

/**
 * As galerias elegiveis, de filme E de serie, no MESMO conjunto.
 *
 * `UNION ALL` em vez de duas consultas: a paginacao do shard e sobre o conjunto
 * inteiro, e paginar duas listas separadas exigiria um segundo esquema de
 * offset que divergiria da contagem.
 *
 * A ORDEM e TOTAL (`vertical, slug`): sem ela, `LIMIT/OFFSET` sobre um `UNION`
 * pode devolver a mesma URL em duas paginas e omitir outra — um sitemap com
 * duplicata e buraco, sem nenhum erro visivel.
 */
function gallerySql(type: "imagens" | "videos", language: string, floor: number) {
  const tabela = type === "imagens" ? "tmdb_images" : "tmdb_videos";
  // Video tem gate POR LINHA; imagem e gated pela FONTE (ver `entity-gallery.ts`).
  const gateVideo =
    type === "videos"
      ? "AND mi.display_allowed = true AND mi.license_status NOT IN ('unknown','blocked')"
      : "AND mi.image_type IN ('poster','backdrop','logo','still')";
  return { tabela, gateVideo, language, floor };
}

async function aggregateGallery(
  prisma: PrismaClient,
  type: "imagens" | "videos",
  language: string,
): Promise<{ n: number; maxmod: Date | null }[]> {
  const { tabela, gateVideo, floor } = gallerySql(type, language, galleryFloor(type));
  return prisma.$queryRawUnsafe<{ n: number; maxmod: Date | null }[]>(
    `SELECT COUNT(*)::int AS n, MAX(lastmod) AS maxmod FROM (
       SELECT MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN movies m ON m.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'movie' AND s.entity_id = m.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'movie' ${gateVideo}
        GROUP BY s.slug HAVING COUNT(*) >= $2
       UNION ALL
       SELECT MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN tv_shows t ON t.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'tv' ${gateVideo}
        GROUP BY s.slug HAVING COUNT(*) >= $2
     ) AS galerias`,
    language,
    floor,
  );
}

async function pageGallery(
  prisma: PrismaClient,
  type: "imagens" | "videos",
  language: string,
  limit: number,
  offset: number,
): Promise<SitemapXmlUrl[]> {
  const { tabela, gateVideo, floor } = gallerySql(type, language, galleryFloor(type));
  const rows = await prisma.$queryRawUnsafe<GalleryRow[]>(
    `SELECT vertical, slug, lastmod FROM (
       SELECT 'filmes' AS vertical, s.slug AS slug, MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN movies m ON m.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'movie' AND s.entity_id = m.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'movie' ${gateVideo}
        GROUP BY s.slug HAVING COUNT(*) >= $2
       UNION ALL
       SELECT 'series' AS vertical, s.slug AS slug, MAX(mi.updated_at) AS lastmod
         FROM ${tabela} mi
         JOIN tv_shows t ON t.tmdb_id = mi.tmdb_id
         JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
           AND s.language_code = $1 AND s.is_canonical = true
        WHERE mi.entity_type = 'tv' ${gateVideo}
        GROUP BY s.slug HAVING COUNT(*) >= $2
     ) AS galerias
     ORDER BY vertical ASC, slug ASC LIMIT $3 OFFSET $4`,
    language,
    floor,
    limit,
    offset,
  );

  return rows
    .map((row) => galleryUrl(type, row))
    .filter((url): url is SitemapXmlUrl => url !== null);
}

/** A URL de UMA galeria, ou `null` quando o slug nao produz caminho valido. */
function galleryUrl(type: "imagens" | "videos", row: GalleryRow): SitemapXmlUrl | null {
  const vertical = row.vertical === "filmes" ? ("filmes" as const) : ("series" as const);
  const caminho =
    type === "imagens"
      ? imagesGalleryPath(vertical, row.slug)
      : videosGalleryPath(vertical, row.slug);
  if (caminho === null) return null;
  const loc = canonicalPublicUrl(caminho);
  if (loc === null) return null;
  return {
    loc,
    lastmod: isoOrNull(row.lastmod),
    changefreq: ENTITY_CHANGEFREQ[type],
    priority: ENTITY_PRIORITY[type],
  };
}

/** O piso do tipo. Vem de `gallery-presenter.ts`; nunca reescrito aqui. */
function galleryFloor(type: "imagens" | "videos"): number {
  return type === "imagens" ? IMAGES_INDEX_FLOOR : VIDEOS_INDEX_FLOOR;
}

async function pageEntity(
  prisma: PrismaClient,
  type: SimpleSitemapType,
  language: string,
  limit: number,
  offset: number,
): Promise<PageRow[]> {
  if (type === "movies") {
    return prisma.$queryRaw<PageRow[]>`
      SELECT s.slug AS slug, m.updated_at AS lastmod
      FROM slugs s JOIN movies m ON m.id = s.entity_id
      WHERE s.entity_type = 'movie' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(m.title_original) <> ''
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'movie' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')
      ORDER BY s.entity_id ASC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (type === "series") {
    return prisma.$queryRaw<PageRow[]>`
      SELECT s.slug AS slug, t.updated_at AS lastmod
      FROM slugs s JOIN tv_shows t ON t.id = s.entity_id
      WHERE s.entity_type = 'tv' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(t.name_original) <> ''
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'tv' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')
      ORDER BY s.entity_id ASC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (type === "people") {
    return prisma.$queryRaw<PageRow[]>`
      SELECT s.slug AS slug, p.updated_at AS lastmod
      FROM slugs s JOIN people p ON p.id = s.entity_id
      WHERE s.entity_type = 'person' AND s.language_code = ${language} AND s.is_canonical = true
        AND BTRIM(p.name) <> ''
        -- VALVULA 2026-08-27 (ver SUSPENDED_SITEMAP_TYPES): pessoa sem
        -- biografia EXIBIVEL ou sem foto rende uma ficha de ~52 palavras dentro
        -- de <main> — nome, papel e uma lista de links. Medido em 2026-08-27:
        -- 0 de 300 pessoas do sitemap exibiam biografia. Sao os MESMOS
        -- predicados que o produtor da Fase 3 usa para decidir no_biography /
        -- no_image (services/ingestion/src/persistence/indexability-writer.ts),
        -- escritos aqui para nao dependerem de o produtor ja ter rodado.
        -- Texto E licenca: a coluna de governanca nasce unknown, e bio ingerida
        -- sem liberacao nao aparece na tela (invariante 6).
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND BTRIM(COALESCE(p.biography, '')) <> ''
        AND p.biography_source_status::text IN ('official','licensed','third_party')
        AND BTRIM(COALESCE(p.profile_path, '')) <> ''
        AND EXISTS (
          SELECT 1 FROM cast_members cm
          JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
            AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions wd
              WHERE wd.entity_type = cm.entity_type AND wd.entity_id = cm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true AND wd.decision <> 'index')
          UNION ALL
          SELECT 1 FROM crew_members rm
          JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
            AND ws.language_code = ${language} AND ws.is_canonical = true
          WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')
            AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions wd
              WHERE wd.entity_type = rm.entity_type AND wd.entity_id = rm.entity_id
                AND wd.language_code = ${language} AND wd.is_current = true AND wd.decision <> 'index')
        )
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')
      ORDER BY s.entity_id ASC LIMIT ${limit} OFFSET ${offset}`;
  }
  return prisma.$queryRaw<PageRow[]>`
    SELECT at.slug AS slug, at.updated_at AS lastmod
    FROM article_translations at JOIN articles a ON a.id = at.article_id
    WHERE at.language_code = ${language}
      AND at.review_status IN ('human_reviewed','published')
      AND a.license_status IN ('official','licensed','third_party')
      AND a.display_allowed = true
      AND BTRIM(at.slug) <> '' AND BTRIM(at.title) <> ''
      AND COALESCE(at.published_at, a.published_at) <= (NOW() AT TIME ZONE 'UTC')
      AND at.index_status = 'index'
      AND LENGTH(BTRIM(COALESCE(at.body, ''))) >= ${MIN_ARTICLE_BODY_CHARS}
      AND (a.requires_attribution = false OR BTRIM(COALESCE(a.source_name, '')) <> '')
      AND (a.requires_linkback = false OR BTRIM(COALESCE(a.source_url, '')) <> '')
    ORDER BY at.id ASC LIMIT ${limit} OFFSET ${offset}`;
}

function pageRowsToUrls(type: SimpleSitemapType, rows: PageRow[]): SitemapXmlUrl[] {
  const urls: SitemapXmlUrl[] = [];
  for (const row of rows) {
    const slug = row.slug.trim();
    if (slug === "") continue;
    const loc = canonicalPublicUrl(`${INDEX_PATH[type]}${slug}/`);
    if (loc === null) continue;
    urls.push({
      loc,
      lastmod: isoOrNull(row.lastmod),
      changefreq: ENTITY_CHANGEFREQ[type],
      priority: ENTITY_PRIORITY[type],
    });
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Temporadas/episodios: URL composta (slug canonico da SERIE + numeros reais). A
// paginacao continua NO BANCO (LIMIT/OFFSET) e a exclusao no WHERE (idioma,
// serie com slug canonico/nome, decisao vigente != index da temporada/episodio).
// ---------------------------------------------------------------------------

function seasonEpisodeUrl(
  path: string | null,
  lastmod: Date | null,
  type: "seasons" | "episodes",
): SitemapXmlUrl | null {
  if (path === null) return null;
  const loc = canonicalPublicUrl(path);
  if (loc === null) return null;
  return {
    loc,
    lastmod: isoOrNull(lastmod),
    changefreq: ENTITY_CHANGEFREQ[type],
    priority: ENTITY_PRIORITY[type],
  };
}

async function pageSeasonEpisode(
  prisma: PrismaClient,
  type: "seasons" | "episodes",
  language: string,
  limit: number,
  offset: number,
): Promise<SitemapXmlUrl[]> {
  if (type === "seasons") {
    const rows = await prisma.$queryRaw<
      { series_slug: string; season_number: number; lastmod: Date | null }[]
    >`
      SELECT s.slug AS series_slug, se.season_number AS season_number, se.updated_at AS lastmod
      FROM seasons se
      JOIN tv_shows t ON t.id = se.tv_show_id
      JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
        AND s.language_code = ${language} AND s.is_canonical = true
      WHERE BTRIM(t.name_original) <> ''
        AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
          WHERE d.entity_type = 'season' AND d.entity_id = se.id
            AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')
      ORDER BY se.id ASC LIMIT ${limit} OFFSET ${offset}`;
    return rows
      .map((row) =>
        seasonEpisodeUrl(seasonPath(row.series_slug, row.season_number), row.lastmod, "seasons"),
      )
      .filter((url): url is SitemapXmlUrl => url !== null);
  }
  const rows = await prisma.$queryRaw<
    {
      series_slug: string;
      season_number: number;
      episode_number: number;
      lastmod: Date | null;
    }[]
  >`
    SELECT s.slug AS series_slug, se.season_number AS season_number,
           e.episode_number AS episode_number, e.updated_at AS lastmod
    FROM episodes e
    JOIN seasons se ON se.id = e.season_id
    JOIN tv_shows t ON t.id = e.tv_show_id
    JOIN slugs s ON s.entity_type = 'tv' AND s.entity_id = t.id
      AND s.language_code = ${language} AND s.is_canonical = true
    WHERE BTRIM(t.name_original) <> ''
      AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
        WHERE d.entity_type = 'episode' AND d.entity_id = e.id
          AND d.language_code = ${language} AND d.is_current = true AND d.decision <> 'index')
    ORDER BY e.id ASC LIMIT ${limit} OFFSET ${offset}`;
  return rows
    .map((row) =>
      seasonEpisodeUrl(
        episodePath(row.series_slug, row.season_number, row.episode_number),
        row.lastmod,
        "episodes",
      ),
    )
    .filter((url): url is SitemapXmlUrl => url !== null);
}

// ---------------------------------------------------------------------------
// Rotas estaticas: pequena lista fixa (shard proprio, em memoria). O gate usa os
// MESMOS evaluators das paginas, alimentado pelas CONTAGENS ja calculadas.
// ---------------------------------------------------------------------------

interface StaticSpec {
  path: string;
  changefreq: string;
  priority: number;
  eligible: boolean;
}

function eligibleStaticRoutes(counts: Record<EntitySitemapType, number>): SitemapXmlUrl[] {
  const moviesIdx = evaluateEntityIndexIndexability({ itemCount: counts.movies }).decision === "index";
  const seriesIdx = evaluateEntityIndexIndexability({ itemCount: counts.series }).decision === "index";
  const peopleIdx = evaluateEntityIndexIndexability({ itemCount: counts.people }).decision === "index";
  const newsIdx = evaluateNewsIndexIndexability({ itemCount: counts.news }).decision === "index";
  const homeIdx =
    evaluatePortalIndexability({
      populatedSectionCount: countPopulatedSections([counts.movies, counts.series, counts.news]),
    }).decision === "index";
  const exploreIdx =
    evaluatePortalIndexability({
      populatedSectionCount: countPopulatedSections([counts.movies, counts.series, counts.people, counts.news]),
    }).decision === "index";

  const specs: StaticSpec[] = [
    { path: HOME_PATH, changefreq: "weekly", priority: 0.8, eligible: homeIdx },
    { path: MOVIES_INDEX_PATH, changefreq: "weekly", priority: 0.7, eligible: moviesIdx },
    { path: SERIES_INDEX_PATH, changefreq: "weekly", priority: 0.7, eligible: seriesIdx },
    { path: PEOPLE_INDEX_PATH, changefreq: "weekly", priority: 0.7, eligible: peopleIdx },
    { path: NEWS_INDEX_PATH, changefreq: "daily", priority: 0.7, eligible: newsIdx },
    { path: EXPLORE_PATH, changefreq: "weekly", priority: 0.6, eligible: exploreIdx },
  ];

  const urls: SitemapXmlUrl[] = [];
  for (const spec of specs) {
    if (!spec.eligible) continue;
    const loc = canonicalPublicUrl(spec.path);
    if (loc === null) continue;
    urls.push({ loc, lastmod: null, changefreq: spec.changefreq, priority: spec.priority });
  }
  return urls;
}

async function allEntityCounts(
  prisma: PrismaClient,
  language: string,
): Promise<{ counts: Record<EntitySitemapType, number>; maxLastmod: Record<EntitySitemapType, Date | null> }> {
  const counts = {} as Record<EntitySitemapType, number>;
  const maxLastmod = {} as Record<EntitySitemapType, Date | null>;
  // Tipo suspenso fica em ZERO, e nao `undefined`: `eligibleStaticRoutes` le
  // este mapa por chave, e um `undefined` tipado como `number` atravessaria o
  // typecheck para explodir so no render.
  for (const type of SUPPORTED_ENTITY_TYPES) {
    counts[type] = 0;
    maxLastmod[type] = null;
  }
  // Uma consulta de CONTAGEM (+max) por tipo PUBLICADO — nunca busca URLs, e
  // nunca conta o que nao vai ao sitemap.
  for (const type of ENTITY_TYPES) {
    const agg = await aggregateEntity(prisma, type, language);
    counts[type] = agg.count;
    maxLastmod[type] = agg.maxLastmod;
  }
  return { counts, maxLastmod };
}

function shardId(language: string, type: string, page: number): string {
  return `sitemap-${language}-${type}-${page}`;
}

function shardCountFor(total: number, limit: number): number {
  return total <= 0 ? 0 : Math.ceil(total / limit);
}

// ---------------------------------------------------------------------------
// /sitemap.xml — INDEX (so contagens; gera enderecos de shard, nao busca URLs).
// ---------------------------------------------------------------------------

export async function getSitemapIndexXml(
  opts?: SitemapPageOptions,
  client?: PrismaClient,
): Promise<SitemapXmlResponse> {
  const limit = resolveLimit(opts);
  const language = SITEMAP_LANGUAGE;
  try {
    const prisma = client ?? getPrismaClient();
    const { counts, maxLastmod } = await allEntityCounts(prisma, language);

    // TETO: antes de anunciar um shard sequer. Ver SITEMAP_TOTAL_URL_CEILING.
    const total = ENTITY_TYPES.reduce((sum, type) => sum + counts[type], 0);
    if (total > SITEMAP_TOTAL_URL_CEILING) {
      throw new SitemapCeilingExceededError(total, SITEMAP_TOTAL_URL_CEILING, counts);
    }

    const entries: SitemapIndexXmlEntry[] = [];
    for (const type of ENTITY_TYPES) {
      const shards = shardCountFor(counts[type], limit);
      const lastmod = isoOrNull(maxLastmod[type]);
      for (let page = 1; page <= shards; page += 1) {
        entries.push({
          loc: `${SITE_URL}/sitemaps/${shardId(language, type, page)}.xml`,
          lastmod,
        });
      }
    }
    // Shard estatico (lista fixa pequena) — um unico shard quando ha rota elegivel.
    if (eligibleStaticRoutes(counts).length > 0) {
      entries.push({
        loc: `${SITE_URL}/sitemaps/${shardId(language, "static", 1)}.xml`,
        lastmod: null,
      });
    }

    return { xml: renderSitemapIndex(entries), contentType: SITEMAP_CONTENT_TYPE };
  } catch (error) {
    // FAIL-CLOSED: sem conseguir contar, publica um index vazio (nunca URLs incertas).
    console.error("[sitemap] falha ao montar o sitemap index; fail-closed (index vazio):", error);
    return { xml: renderSitemapIndex([]), contentType: SITEMAP_CONTENT_TYPE };
  }
}

// ---------------------------------------------------------------------------
// /sitemaps/{id}.xml — SHARD (uma pagina, um tipo, LIMIT/OFFSET no banco).
// ---------------------------------------------------------------------------

/** Validacao ESTRITA do id do shard. Retorna null (=> 404) para qualquer desvio. */
export function parseShardId(
  raw: string,
): { language: string; type: string; page: number } | null {
  if (!raw.endsWith(".xml")) return null;
  const id = raw.slice(0, -".xml".length);
  const match =
    /^sitemap-(pt-BR)-(movies|series|people|news|seasons|episodes|imagens|videos|static)-(\d+)$/.exec(
      id,
    );
  if (match === null) return null;
  const language = match[1];
  const type = match[2];
  const pageStr = match[3];
  if (language === undefined || type === undefined || pageStr === undefined) return null;
  // Sem zeros a esquerda / texto extra: a forma canonica do numero deve casar.
  if (String(Number(pageStr)) !== pageStr) return null;
  const page = Number(pageStr);
  if (!Number.isInteger(page) || page < 1) return null;
  if (language !== SITEMAP_LANGUAGE) return null; // idioma nao publicado no sitemap
  if (!ALL_TYPES.includes(type)) return null;
  return { language, type, page };
}

export async function getSitemapShardXml(
  rawShardId: string,
  opts?: SitemapPageOptions,
  client?: PrismaClient,
): Promise<SitemapXmlResponse | null> {
  const parsed = parseShardId(rawShardId);
  if (parsed === null) return null; // shard invalido -> 404
  const limit = resolveLimit(opts);
  const { language, type, page } = parsed;

  try {
    const prisma = client ?? getPrismaClient();

    if (type === "static") {
      if (page !== 1) return null; // so existe 1 shard estatico
      const { counts } = await allEntityCounts(prisma, language);
      const routes = eligibleStaticRoutes(counts);
      if (routes.length === 0) return null;
      return { xml: renderUrlset(routes), contentType: SITEMAP_CONTENT_TYPE };
    }

    const entityType = type as EntitySitemapType;
    // Uma contagem (deste tipo) para saber quantos shards existem.
    const { count } = await aggregateEntity(prisma, entityType, language);
    const shards = shardCountFor(count, limit);
    if (page > shards) return null; // pagina acima do total -> 404

    // SO a pagina pedida, deste tipo: LIMIT/OFFSET no banco.
    const offset = (page - 1) * limit;
    const urls =
      entityType === "seasons" || entityType === "episodes"
        ? await pageSeasonEpisode(prisma, entityType, language, limit, offset)
        : entityType === "imagens" || entityType === "videos"
          ? await pageGallery(prisma, entityType, language, limit, offset)
          : pageRowsToUrls(
              entityType,
              await pageEntity(prisma, entityType, language, limit, offset),
            );
    return { xml: renderUrlset(urls), contentType: SITEMAP_CONTENT_TYPE };
  } catch (error) {
    // FAIL-CLOSED: erro de banco -> nao publica URLs incertas (404).
    console.error(`[sitemap] falha ao montar shard ${rawShardId}; fail-closed (404):`, error);
    return null;
  }
}
