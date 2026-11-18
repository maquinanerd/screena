/**
 * editorial-context.ts — As LEITURAS do Cinerie Context Service. A decisao
 * (o que entra, com que permissao) vive em `../lib/editorial-context-presenter.ts`;
 * a identidade (que obra e esta) reaproveita o tradutor de `entity-resolve`.
 *
 * Invariantes 3 e 4: le SOMENTE PostgreSQL local via @screena/db. Zero TMDB,
 * zero rede, zero IA. Read-only. Esta leitura nao esta no caminho de render de
 * pagina nenhuma: so a rota interna `/api/internal/editorial-context` a chama.
 *
 * OS PORTOES SAO OS DA PAGINA PUBLICA, e nao uma copia deles. Imagem passa por
 * `getImageDisplayAuthorization` + `tmdbImageUrlIfAllowed`; trailer, por
 * `getTrailerForEntity` (linha `display_allowed`); oferta, por
 * `getWatchAvailabilityForEntity` (cadeia de licenca inteira). Se a Cinerie nao
 * pode mostrar, o contexto nao entrega — e quando a licenca muda, muda aqui no
 * mesmo request.
 */

import { getPrismaClient } from "@screena/db/server";
import { tmdbImageUrlIfAllowed, type ImageDisplayAuthorization } from "@screena/public-contracts";

import type { ContextItem, ContextKind } from "../lib/editorial-context-request";
import type { ContextImageInput, ContextPersonInput, ContextTitleInput } from "../lib/editorial-context-presenter";
import { CONTEXT_CAST_LIMIT } from "../lib/editorial-context-presenter";
import { resolveAll, type MatchedBy, type ResolveFailureReason, type ResolveQuery } from "../lib/entity-resolve";
import { SITE_URL } from "../lib/site";
import { isPublishedLocale, publishedLocaleRank, selectSynopsis } from "../lib/synopsis-language";
import { getMediaBandScenePaths } from "./entity-gallery";
import { getGenresForEntity } from "./entity-hero";
import { loadResolveCandidates } from "./entity-resolve";
import { getTrailerForEntity } from "./entity-trailer";
import { getWatchAvailabilityForEntity } from "./entity-watch";
import { getImageDisplayAuthorization } from "./image-license";

type PrismaClient = ReturnType<typeof getPrismaClient>;

const LANGUAGE_CODE = "pt-BR";

const PATH_SEGMENT: Readonly<Record<ContextKind, string>> = { movie: "filmes", tv: "series" };

/** Mesmos cargos da ficha tecnica (`entity-facts.ts`). */
const DIRECTOR_JOBS = ["Director"] as const;
const WRITER_JOBS = ["Writer", "Screenplay", "Teleplay", "Story"] as const;

/** Tamanhos do CDN: o pôster da ficha e capa >= 1200 px (exigencia do Discover). */
const POSTER = { size: "w780", width: 780, height: 1170 } as const;
const WIDE = { size: "w1280", width: 1280, height: 720 } as const;

/* ------------------------------------------------------------------ */
/* Identidade                                                          */
/* ------------------------------------------------------------------ */

/** Como cada item do pedido chegou (ou nao) a uma obra. */
export interface ContextResolution {
  readonly index: number;
  readonly kind: ContextKind;
  readonly entityId: string | null;
  readonly matchedBy: MatchedBy | "entity_id" | "slug" | null;
  readonly confidence: number;
  readonly reason: ResolveFailureReason | "entity_not_found" | null;
}

async function canonicalSlugsFor(
  prisma: PrismaClient,
  kind: ContextKind,
  entityIds: readonly bigint[],
): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map();
  const rows = await prisma.slug.findMany({
    where: { entityType: kind, entityId: { in: [...entityIds] }, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true, slug: true },
  });
  return new Map(rows.map((row) => [row.entityId.toString(), row.slug]));
}

/**
 * Traduz cada item em uma obra do catalogo.
 *
 * `entityId` e `slug` sao conferidos contra o banco (um id que nao existe volta
 * `entity_not_found`, nunca uma ficha vazia). `tmdbId` e `title` passam pelo
 * tradutor da rota de resolucao, com as mesmas recusas — e a mesma exigencia de
 * slug canonico pt-BR, sem o qual a obra nao tem pagina para onde apontar.
 */
export async function resolveContextItems(items: readonly ContextItem[]): Promise<ContextResolution[]> {
  const prisma = getPrismaClient();
  const out = new Map<number, ContextResolution>();

  const resolveQueries: ResolveQuery[] = [];
  for (const item of items) {
    if (item.by === "tmdb_id") {
      resolveQueries.push({ index: item.index, kind: item.kind, tmdbId: item.tmdbId, folded: null, year: null });
    } else if (item.by === "title") {
      resolveQueries.push({ index: item.index, kind: item.kind, tmdbId: null, folded: item.folded, year: item.year });
    }
  }

  const byIdItems = items.filter((item): item is Extract<ContextItem, { by: "entity_id" }> => item.by === "entity_id");
  const bySlugItems = items.filter((item): item is Extract<ContextItem, { by: "slug" }> => item.by === "slug");

  const [resolved, slugRows, idSlugs] = await Promise.all([
    resolveQueries.length > 0
      ? loadResolveCandidates(resolveQueries).then((candidates) => resolveAll(resolveQueries, candidates))
      : Promise.resolve([]),
    bySlugItems.length > 0
      ? prisma.slug.findMany({
          where: {
            languageCode: LANGUAGE_CODE,
            OR: bySlugItems.map((item) => ({ entityType: item.kind, slug: item.slug })),
          },
          select: { entityType: true, entityId: true, slug: true },
        })
      : Promise.resolve([]),
    Promise.all(
      (["movie", "tv"] as const).map(async (kind) => {
        const ids = byIdItems.filter((item) => item.kind === kind).map((item) => BigInt(item.entityId));
        return [kind, await canonicalSlugsFor(prisma, kind, ids)] as const;
      }),
    ),
  ]);

  for (const result of resolved) {
    const kind = resolveQueries.find((query) => query.index === result.index)?.kind ?? "movie";
    out.set(result.index, {
      index: result.index,
      kind: kind === "tv" ? "tv" : "movie",
      entityId: result.entityId,
      matchedBy: result.matchedBy,
      confidence: result.confidence,
      reason: result.reason,
    });
  }

  const slugsByKind = new Map(idSlugs);
  for (const item of byIdItems) {
    const found = slugsByKind.get(item.kind)?.has(item.entityId) ?? false;
    out.set(item.index, {
      index: item.index,
      kind: item.kind,
      entityId: found ? item.entityId : null,
      matchedBy: found ? "entity_id" : null,
      confidence: found ? 1 : 0,
      reason: found ? null : "entity_not_found",
    });
  }

  for (const item of bySlugItems) {
    const row = slugRows.find((candidate) => String(candidate.entityType) === item.kind && candidate.slug === item.slug);
    out.set(item.index, {
      index: item.index,
      kind: item.kind,
      entityId: row === undefined ? null : row.entityId.toString(),
      matchedBy: row === undefined ? null : "slug",
      confidence: row === undefined ? 0 : 1,
      reason: row === undefined ? "entity_not_found" : null,
    });
  }

  return items.map(
    (item) =>
      out.get(item.index) ?? {
        index: item.index,
        kind: item.kind,
        entityId: null,
        matchedBy: null,
        confidence: 0,
        reason: "not_found",
      },
  );
}

/**
 * A licenca de imagem, UMA vez por chamada (o mesmo sexto portao da pagina
 * publica, fail-closed quando o banco cai).
 */
export async function loadContextImageAuthorization(): Promise<ImageDisplayAuthorization> {
  return getImageDisplayAuthorization(getPrismaClient());
}

/* ------------------------------------------------------------------ */
/* A ficha                                                             */
/* ------------------------------------------------------------------ */

function isoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

function wide(path: string | null, authorization: ImageDisplayAuthorization): ContextImageInput | null {
  const url = tmdbImageUrlIfAllowed(path, WIDE.size, authorization);
  return url === null ? null : { url, width: WIDE.width, height: WIDE.height };
}

function poster(path: string | null, authorization: ImageDisplayAuthorization): ContextImageInput | null {
  const url = tmdbImageUrlIfAllowed(path, POSTER.size, authorization);
  return url === null ? null : { url, width: POSTER.width, height: POSTER.height };
}

async function peopleFor(
  prisma: PrismaClient,
  kind: ContextKind,
  entityId: bigint,
): Promise<{ cast: ContextPersonInput[]; directors: ContextPersonInput[]; writers: ContextPersonInput[] }> {
  const [castRows, crewRows] = await Promise.all([
    prisma.castMember.findMany({
      where: { entityType: kind, entityId },
      orderBy: [{ billingOrder: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: CONTEXT_CAST_LIMIT,
      select: { character: true, personId: true, person: { select: { name: true } } },
    }),
    prisma.crewMember.findMany({
      where: { entityType: kind, entityId, job: { in: [...DIRECTOR_JOBS, ...WRITER_JOBS] } },
      orderBy: { id: "asc" },
      take: 40,
      select: { job: true, personId: true, person: { select: { name: true } } },
    }),
  ]);

  const personIds = [...new Set([...castRows, ...crewRows].map((row) => row.personId.toString()))].map((id) =>
    BigInt(id),
  );
  const slugs = personIds.length === 0 ? new Map<string, string>() : await canonicalPersonSlugs(prisma, personIds);

  const toPerson = (row: { personId: bigint; person: { name: string } }, character: string | null) => ({
    personId: row.personId.toString(),
    name: row.person.name,
    slug: slugs.get(row.personId.toString()) ?? null,
    character,
  });

  const dedupe = (list: ContextPersonInput[]): ContextPersonInput[] => {
    const seen = new Set<string>();
    return list.filter((person) => {
      if (seen.has(person.personId)) return false;
      seen.add(person.personId);
      return true;
    });
  };

  return {
    cast: dedupe(castRows.map((row) => toPerson(row, row.character))),
    directors: dedupe(
      crewRows
        .filter((row) => row.job !== null && (DIRECTOR_JOBS as readonly string[]).includes(row.job))
        .map((row) => toPerson(row, null)),
    ),
    writers: dedupe(
      crewRows
        .filter((row) => row.job !== null && (WRITER_JOBS as readonly string[]).includes(row.job))
        .map((row) => toPerson(row, null)),
    ),
  };
}

async function canonicalPersonSlugs(prisma: PrismaClient, personIds: readonly bigint[]): Promise<Map<string, string>> {
  const rows = await prisma.slug.findMany({
    where: { entityType: "person", entityId: { in: [...personIds] }, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true, slug: true },
  });
  return new Map(rows.map((row) => [row.entityId.toString(), row.slug]));
}

interface TitleRecord {
  tmdbId: number;
  originalTitle: string;
  releaseDate: Date | null;
  runtimeMinutes: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  originalLanguage: string | null;
  series: ContextTitleInput["series"];
}

async function titleRecord(prisma: PrismaClient, kind: ContextKind, entityId: bigint): Promise<TitleRecord | null> {
  if (kind === "movie") {
    const movie = await prisma.movie.findUnique({
      where: { id: entityId },
      select: {
        tmdbId: true,
        titleOriginal: true,
        releaseDate: true,
        runtimeMinutes: true,
        posterPath: true,
        backdropPath: true,
        originalLanguage: true,
      },
    });
    if (movie === null) return null;
    return {
      tmdbId: movie.tmdbId,
      originalTitle: movie.titleOriginal,
      releaseDate: movie.releaseDate,
      runtimeMinutes: movie.runtimeMinutes,
      posterPath: movie.posterPath,
      backdropPath: movie.backdropPath,
      originalLanguage: movie.originalLanguage,
      series: null,
    };
  }
  const show = await prisma.tvShow.findUnique({
    where: { id: entityId },
    select: {
      tmdbId: true,
      nameOriginal: true,
      firstAirDate: true,
      lastAirDate: true,
      numberOfSeasons: true,
      numberOfEpisodes: true,
      posterPath: true,
      backdropPath: true,
      status: true,
      originalLanguage: true,
    },
  });
  if (show === null) return null;
  return {
    tmdbId: show.tmdbId,
    originalTitle: show.nameOriginal,
    releaseDate: show.firstAirDate,
    runtimeMinutes: null,
    posterPath: show.posterPath,
    backdropPath: show.backdropPath,
    originalLanguage: show.originalLanguage,
    series: {
      seasons: show.numberOfSeasons,
      episodes: show.numberOfEpisodes,
      lastAirDateIso: isoDate(show.lastAirDate),
      ended: show.status === "Ended" || show.status === "Canceled",
    },
  };
}

/**
 * A ficha de UMA obra, ou `null` quando ela sumiu entre a resolucao e a
 * leitura (ou nao tem slug pt-BR — sem pagina, nao ha para onde apontar).
 */
export async function loadTitleContext(
  kind: ContextKind,
  entityIdText: string,
  imageAuthorization: ImageDisplayAuthorization,
): Promise<ContextTitleInput | null> {
  const prisma = getPrismaClient();
  const entityId = BigInt(entityIdText);

  const [record, slugs, translations, genres, people, externalIds, watch] = await Promise.all([
    titleRecord(prisma, kind, entityId),
    canonicalSlugsFor(prisma, kind, [entityId]),
    prisma.entityTranslation.findMany({
      where: { entityType: kind, entityId },
      select: { languageCode: true, title: true, metaDescription: true, summary: true },
    }),
    getGenresForEntity(prisma, kind, entityId),
    peopleFor(prisma, kind, entityId),
    prisma.entityExternalId.findMany({
      where: { entityType: kind, entityId },
      select: { source: true, externalId: true },
    }),
    getWatchAvailabilityForEntity(prisma, kind, entityId),
  ]);
  const slug = slugs.get(entityIdText);
  if (record === null || slug === undefined) return null;

  const [trailer, scenePaths] = await Promise.all([
    getTrailerForEntity(prisma, kind, record.tmdbId),
    imageAuthorization.authorized
      ? getMediaBandScenePaths(prisma, kind, record.tmdbId, record.backdropPath)
      : Promise.resolve([] as readonly string[]),
  ]);

  // Titulo: o do locale publicado, com a mesma prioridade da ficha publica.
  const published = translations
    .filter((row) => isPublishedLocale(row.languageCode) && (row.title ?? "").trim() !== "")
    .sort((a, b) => publishedLocaleRank(a.languageCode) - publishedLocaleRank(b.languageCode))[0];
  const title = (published?.title ?? "").trim() || record.originalTitle;

  const synopsis = selectSynopsis(translations, record.originalLanguage);

  return {
    kind,
    entityId: entityIdText,
    title,
    originalTitle: record.originalTitle,
    slug,
    canonicalUrl: `${SITE_URL}/pt/${PATH_SEGMENT[kind]}/${slug}/`,
    synopsis: synopsis === null ? null : { text: synopsis.text, languageCode: synopsis.languageCode },
    releaseDateIso: isoDate(record.releaseDate),
    runtimeMinutes: record.runtimeMinutes,
    genres,
    externalIds,
    tmdbId: record.tmdbId,
    cast: people.cast,
    directors: people.directors,
    writers: people.writers,
    poster: poster(record.posterPath, imageAuthorization),
    backdrop: wide(record.backdropPath, imageAuthorization),
    scenes: scenePaths
      .map((path) => wide(path, imageAuthorization))
      .filter((image): image is ContextImageInput => image !== null),
    imageDeniedReason: imageAuthorization.authorized ? null : imageAuthorization.reason,
    trailer: trailer === null ? null : { embedUrl: trailer.embedUrl, watchUrl: trailer.watchUrl, name: trailer.name },
    watch,
    series: record.series,
  };
}
