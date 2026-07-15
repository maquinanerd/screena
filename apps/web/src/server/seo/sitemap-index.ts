/**
 * sitemap-index.ts — Camada SERVER-ONLY do sitemap index + shards (Fase 3, §11).
 *
 * Serve um sitemap INDEX (`/sitemap.xml`) que aponta para SHARDS por (idioma,
 * tipo, pagina) em `/sitemaps/{id}.xml`. Cada shard tem no maximo
 * `SITEMAP_URL_LIMIT` URLs (paginacao). O planejamento e a serializacao XML sao
 * puros (`@screena/seo`: planSitemapShards / buildSitemapIndex / renderUrlset /
 * renderSitemapIndex); aqui so lemos o PostgreSQL local e montamos a lista.
 *
 * COERENCIA meta robots <-> sitemap (Fase 3): a lista base vem do mesmo
 * `getSitemapEntries` (mesmos gates das paginas), e AINDA aplicamos uma passada
 * de EXCLUSAO pela decisao VIGENTE persistida — uma entidade cuja pagina resolve
 * para noindex/blocked/stale/draft (override humano/motor em
 * page_indexability_decisions) NUNCA aparece no sitemap. Assim nunca ha
 * "pagina no sitemap + HTML noindex".
 *
 * Invariantes 3/4: zero API externa, zero Gemini; so PostgreSQL local.
 * FAIL-CLOSED: sem conseguir ler as decisoes persistidas, NAO publica URLs de
 * entidade (so as rotas estaticas), com log explicito.
 *
 * Escala: hoje o snapshot e planejado em memoria (catalogo pequeno, fundacao).
 * Paginacao a nivel de banco (LIMIT/OFFSET por shard) e otimizacao futura — a
 * arquitetura de shards/limite ja esta pronta para quando o catalogo crescer.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  buildSitemapIndex,
  planSitemapShards,
  renderSitemapIndex,
  renderUrlset,
  SITEMAP_CONTENT_TYPE,
  type SitemapUrl,
} from "@screena/seo";

import {
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
  SITE_URL,
} from "../../lib/site";
import { getSitemapEntries } from "./sitemap-entries";
import type { SitemapEntryView } from "../../lib/sitemap-presenter";

const LANGUAGE = "pt-BR";

type PrismaClient = ReturnType<typeof getPrismaClient>;
type ExcludableEntityType = "movie" | "tv" | "person";

const INDEX_PATH_BY_TYPE: Readonly<Record<ExcludableEntityType, string>> = {
  movie: MOVIES_INDEX_PATH,
  tv: SERIES_INDEX_PATH,
  person: PEOPLE_INDEX_PATH,
};

/** Decisoes persistidas que MANTEM uma URL FORA do sitemap (qualquer != index). */
const NON_INDEX_DECISIONS = ["noindex", "blocked", "stale", "draft"] as const;

export interface SitemapXmlResponse {
  xml: string;
  contentType: string;
}

/** Classifica uma URL de sitemap por tipo a partir do caminho publico. */
export function classifySitemapType(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "static";
  }
  if (pathname.startsWith(MOVIES_INDEX_PATH) && pathname !== MOVIES_INDEX_PATH) {
    return "movies";
  }
  if (pathname.startsWith(SERIES_INDEX_PATH) && pathname !== SERIES_INDEX_PATH) {
    return "series";
  }
  if (pathname.startsWith(PEOPLE_INDEX_PATH) && pathname !== PEOPLE_INDEX_PATH) {
    return "people";
  }
  if (pathname.startsWith(NEWS_INDEX_PATH) && pathname !== NEWS_INDEX_PATH) {
    return "news";
  }
  return "static";
}

/**
 * Reconstroi as URLs de entidade cuja decisao VIGENTE persistida e != index —
 * elas devem sair do sitemap para casar com o `noindex` da propria pagina.
 */
async function excludedEntityUrls(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.pageIndexabilityDecision.findMany({
    where: {
      isCurrent: true,
      languageCode: LANGUAGE,
      entityType: { in: ["movie", "tv", "person"] },
      decision: { in: [...NON_INDEX_DECISIONS] },
    },
    select: { entityType: true, entityId: true },
  });
  if (rows.length === 0) return new Set();

  const idsByType = new Map<ExcludableEntityType, bigint[]>();
  for (const row of rows) {
    const type = row.entityType as ExcludableEntityType;
    const bucket = idsByType.get(type) ?? [];
    bucket.push(row.entityId);
    idsByType.set(type, bucket);
  }

  const excluded = new Set<string>();
  for (const [type, ids] of idsByType) {
    const slugs = await prisma.slug.findMany({
      where: {
        entityType: type,
        entityId: { in: ids },
        languageCode: LANGUAGE,
        isCanonical: true,
      },
      select: { slug: true },
    });
    for (const row of slugs) {
      excluded.add(`${SITE_URL}${INDEX_PATH_BY_TYPE[type]}${row.slug}/`);
    }
  }
  return excluded;
}

function toSitemapUrl(entry: SitemapEntryView): SitemapUrl {
  return {
    loc: entry.url,
    language: LANGUAGE,
    type: classifySitemapType(entry.url),
    lastmod: entry.lastModifiedIso,
  };
}

/**
 * Todas as URLs elegiveis do sitemap, coerentes com o meta robots das paginas:
 * base = `getSitemapEntries` (mesmos gates) menos as entidades com decisao
 * persistida != index. FAIL-CLOSED: erro ao ler decisoes -> so rotas estaticas.
 */
export async function getAllSitemapUrls(): Promise<SitemapUrl[]> {
  const entries = await getSitemapEntries();
  let excluded: Set<string>;
  try {
    excluded = await excludedEntityUrls(getPrismaClient());
  } catch (error) {
    console.error(
      "[sitemap] falha ao ler page_indexability_decisions; fail-closed (apenas rotas estaticas):",
      error,
    );
    return entries
      .filter((entry) => classifySitemapType(entry.url) === "static")
      .map(toSitemapUrl);
  }
  return entries
    .filter((entry) => !excluded.has(entry.url))
    .map(toSitemapUrl);
}

/** Monta o sitemap INDEX (aponta para cada shard em /sitemaps/{id}.xml). */
export async function getSitemapIndexXml(): Promise<SitemapXmlResponse> {
  const urls = await getAllSitemapUrls();
  const shards = planSitemapShards(urls);
  const index = buildSitemapIndex(
    shards,
    (shard) => `${SITE_URL}/sitemaps/${shard.id}.xml`,
  );
  return { xml: renderSitemapIndex(index), contentType: SITEMAP_CONTENT_TYPE };
}

/**
 * Monta um SHARD pelo id (`sitemap-{language}-{type}-{page}`, com ou sem `.xml`).
 * Retorna null quando o shard nao existe (rota responde 404).
 */
export async function getSitemapShardXml(
  shardId: string,
): Promise<SitemapXmlResponse | null> {
  const normalized = shardId.endsWith(".xml")
    ? shardId.slice(0, -".xml".length)
    : shardId;
  const urls = await getAllSitemapUrls();
  const shards = planSitemapShards(urls);
  const shard = shards.find((candidate) => candidate.id === normalized);
  if (shard === undefined) return null;
  return { xml: renderUrlset(shard.urls), contentType: SITEMAP_CONTENT_TYPE };
}
