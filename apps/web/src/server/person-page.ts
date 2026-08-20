/**
 * person-page.ts - Camada de dados SERVER-ONLY da pagina publica de pessoa.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, ratings, streaming ou qualquer API externa.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 *
 * A filmografia e resolvida a partir de cast_members/crew_members: cada credito
 * (polimorfico -> movie|tv) so vira link quando o alvo tem titulo publico e slug
 * canonico pt-BR. Creditos sem alvo resolvivel sao omitidos (nunca inventados).
 */

import { cache } from "react";
import { getPrismaClient, type Prisma } from "@screena/db/server";

import { SITE_URL } from "../lib/site";
import { buildTmdbImageUrl } from "../lib/tmdb-image-url";
import {
  buildPersonPageView,
  evaluatePersonIndexability,
  PERSON_RENDERABLE_REVIEW_STATUSES,
  type PersonContentBlockInput,
  type PersonCreditEntityType,
  type PersonCreditInput,
  type PersonPageView,
} from "../lib/person-presenter";
import { resolveEntityPageSeo } from "./seo/indexability-decision";
import { getRelatedNewsForEntity } from "./related-news";
import type { NewsCardView } from "../lib/news-presenter";
import type { IndexabilityResult, PageSeoResolution } from "@screena/seo";

const LANGUAGE_CODE = "pt-BR";
const ENTITY_TYPE = "person";
const PERSON_INDEX_PATH = "/pt/pessoas/";

export interface PersonPageData {
  view: PersonPageView;
  /** Id INTERNO do catalogo, serializado — e o que acha a pessoa no log. */
  entityId: string;
  indexability: IndexabilityResult;
  /** Resolucao FINAL de SEO (Fase 3): fatos vivos + decisao vigente persistida. */
  seo: PageSeoResolution;
  canonicalSlug: string;
  canonicalUrl: string;
  /** Noticias relacionadas publicaveis (EntityNewsLink); [] quando nao houver. */
  relatedNews: NewsCardView[];
  /** IDs externos reais (imdb/tmdb/...) para montar `sameAs` no JSON-LD. */
  externalIds: { source: string; externalId: string }[];
  /**
   * Galeria de fotos LICENCIADA (tela 09): so tmdb_images de pessoa com
   * display_allowed=true e licenca clara (invariante 6). [] enquanto nenhuma
   * imagem for promovida por decisao humana.
   */
  gallery: { urls: string[]; total: number };
}

function personCanonicalUrl(slug: string): string {
  return `${SITE_URL}${PERSON_INDEX_PATH}${slug}/`;
}

function isoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

/** Alvo de credito ja resolvido: titulo publico + slug canonico + ano. */
interface ResolvedTarget {
  title: string;
  slug: string | null;
  year: number | null;
  posterPath: string | null;
}

function targetKey(entityType: string, entityId: bigint): string {
  return `${entityType}:${entityId.toString()}`;
}

export const getPersonPageData = cache(
  async (slug: string): Promise<PersonPageData | null> => {
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;

    const entityId = slugRow.entityId;

    const [person, canonicalSlugRow, translation, contentBlocks, castRows, crewRows, relatedNews, externalIds] =
      await Promise.all([
        prisma.person.findUnique({
          where: { id: entityId },
          select: {
            name: true,
            knownForDepartment: true,
            birthday: true,
            deathday: true,
            placeOfBirth: true,
            profilePath: true,
            // A bio crua do TMDB e a coluna que a governa. As DUAS, sempre
            // juntas: ler o texto sem o status faria a pagina exibir dado sem
            // licenca (invariante 6).
            biography: true,
            biographySourceStatus: true,
            tmdbId: true,
          },
        }),
        prisma.slug.findFirst({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
            isCanonical: true,
          },
          select: { slug: true },
        }),
        prisma.entityTranslation.findFirst({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
          },
          select: { title: true, metaTitle: true, metaDescription: true },
        }),
        prisma.contentBlock.findMany({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
            reviewStatus: { in: [...PERSON_RENDERABLE_REVIEW_STATUSES] },
          },
          select: { blockType: true, content: true, reviewStatus: true },
        }),
        prisma.castMember.findMany({
          where: { personId: entityId },
          select: {
            entityType: true,
            entityId: true,
            character: true,
            billingOrder: true,
          },
        }),
        prisma.crewMember.findMany({
          where: { personId: entityId },
          select: {
            entityType: true,
            entityId: true,
            department: true,
            job: true,
          },
        }),
        getRelatedNewsForEntity(prisma, ENTITY_TYPE, entityId),
        prisma.entityExternalId.findMany({
          where: { entityType: ENTITY_TYPE, entityId },
          select: { source: true, externalId: true },
        }),
      ]);

    if (person === null) return null;

    const blocks: PersonContentBlockInput[] = contentBlocks.map((block) => ({
      blockType: String(block.blockType),
      content: block.content,
      reviewStatus: String(block.reviewStatus),
    }));

    const credits = await resolveCredits(prisma, castRows, crewRows);
    const gallery = await resolveLicensedGallery(prisma, person.tmdbId);

    const view = buildPersonPageView({
      record: {
        name: person.name,
        knownForDepartment: person.knownForDepartment,
        birthDateIso: isoDate(person.birthday),
        deathDateIso: isoDate(person.deathday),
        placeOfBirth: person.placeOfBirth,
        profilePath: person.profilePath,
        biography: person.biography,
        biographySourceStatus: person.biographySourceStatus,
      },
      translation,
      blocks,
      credits,
    });

    const indexability = evaluatePersonIndexability({
      renderableBlockCount: view.renderableBlockCount,
    });
    const canonicalSlug = canonicalSlugRow?.slug ?? slug;
    const canonicalUrl = personCanonicalUrl(canonicalSlug);

    // Fonte unica da Fase 3: fatos vivos + decisao vigente persistida (fail-closed).
    const seo = await resolveEntityPageSeo(
      { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE_CODE },
      {
        language: LANGUAGE_CODE,
        hasReliableStructuredData: true,
        displayedRatings: [],
        canonicalUrl,
        valueBlocksCount: view.renderableBlockCount,
      },
      prisma,
    );

    return {
      view,
      // Id INTERNO, serializado: e o que o log de ausencia usa para achar a
      // pessoa. Nunca o slug, que muda com recanonizacao.
      entityId: String(entityId),
      indexability,
      seo,
      canonicalSlug,
      canonicalUrl,
      relatedNews,
      externalIds,
      gallery,
    };
  },
);

type PrismaClient = ReturnType<typeof getPrismaClient>;

interface CreditRowBase {
  entityType: string;
  entityId: bigint;
}
interface CastRow extends CreditRowBase {
  character: string | null;
  billingOrder: number | null;
}
interface CrewRow extends CreditRowBase {
  department: string | null;
  job: string | null;
}

/**
 * Resolve os creditos de elenco/equipe em `PersonCreditInput`, buscando titulo
 * publico (traducao pt-BR ou original) e slug canonico dos alvos movie|tv. So
 * alvos `movie`/`tv` sao considerados; outros tipos sao ignorados.
 */
async function resolveCredits(
  prisma: PrismaClient,
  castRows: CastRow[],
  crewRows: CrewRow[],
): Promise<PersonCreditInput[]> {
  const movieIds = new Set<bigint>();
  const tvIds = new Set<bigint>();
  for (const row of [...castRows, ...crewRows]) {
    if (row.entityType === "movie") movieIds.add(row.entityId);
    else if (row.entityType === "tv") tvIds.add(row.entityId);
  }

  const targets = new Map<string, ResolvedTarget>();
  await Promise.all([
    resolveTargets(prisma, "movie", [...movieIds], targets),
    resolveTargets(prisma, "tv", [...tvIds], targets),
  ]);

  const credits: PersonCreditInput[] = [];
  for (const row of castRows) {
    const credit = toCredit(row.entityType, row.entityId, row.character, targets);
    if (credit !== null) credits.push(credit);
  }
  for (const row of crewRows) {
    const role = row.job ?? row.department;
    const credit = toCredit(row.entityType, row.entityId, role, targets);
    if (credit !== null) credits.push(credit);
  }
  return credits;
}

function toCredit(
  entityType: string,
  entityId: bigint,
  roleLabel: string | null,
  targets: Map<string, ResolvedTarget>,
): PersonCreditInput | null {
  if (entityType !== "movie" && entityType !== "tv") return null;
  const target = targets.get(targetKey(entityType, entityId));
  if (target === undefined) return null;
  return {
    entityType: entityType as PersonCreditEntityType,
    title: target.title,
    slug: target.slug,
    year: target.year,
    roleLabel,
    posterPath: target.posterPath,
  };
}

/**
 * Busca titulo original, ano, traducao pt-BR e slug canonico dos alvos de um
 * tipo (`movie` ou `tv`) e preenche `out`. So entra no mapa o alvo que existe
 * na tabela base (movies/tv_shows).
 */
async function resolveTargets(
  prisma: PrismaClient,
  entityType: PersonCreditEntityType,
  ids: bigint[],
  out: Map<string, ResolvedTarget>,
): Promise<void> {
  if (ids.length === 0) return;

  const [translations, slugs] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: {
        entityType,
        entityId: { in: ids },
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
      },
      select: { entityId: true, slug: true },
    }),
  ]);

  const translatedTitle = new Map<string, string>();
  for (const row of translations) {
    const title = row.title?.trim();
    if (title) translatedTitle.set(row.entityId.toString(), title);
  }
  const canonicalSlug = new Map<string, string>();
  for (const row of slugs) {
    canonicalSlug.set(row.entityId.toString(), row.slug);
  }

  if (entityType === "movie") {
    const movies = await prisma.movie.findMany({
      where: { id: { in: ids } },
      select: { id: true, titleOriginal: true, releaseDate: true, posterPath: true },
    });
    for (const movie of movies) {
      const key = movie.id.toString();
      out.set(targetKey("movie", movie.id), {
        title: translatedTitle.get(key) ?? movie.titleOriginal,
        slug: canonicalSlug.get(key) ?? null,
        year: yearFromDate(movie.releaseDate),
        posterPath: movie.posterPath,
      });
    }
  } else {
    const shows = await prisma.tvShow.findMany({
      where: { id: { in: ids } },
      select: { id: true, nameOriginal: true, firstAirDate: true, posterPath: true },
    });
    for (const show of shows) {
      const key = show.id.toString();
      out.set(targetKey("tv", show.id), {
        title: translatedTitle.get(key) ?? show.nameOriginal,
        slug: canonicalSlug.get(key) ?? null,
        year: yearFromDate(show.firstAirDate),
        posterPath: show.posterPath,
      });
    }
  }
}

/**
 * Fotos licenciadas da pessoa (invariante 6: display_allowed + licenca clara;
 * tudo nasce bloqueado ate decisao humana — sem promocao, a galeria fica vazia
 * e a secao e omitida no render).
 */
async function resolveLicensedGallery(
  prisma: PrismaClient,
  tmdbId: number,
): Promise<{ urls: string[]; total: number }> {
  const where = {
    entityType: "person",
    tmdbId,
    imageType: "profile",
    displayAllowed: true,
    licenseStatus: { in: ["official", "licensed"] },
  } satisfies Prisma.TmdbImageWhereInput;
  const [rows, total] = await Promise.all([
    prisma.tmdbImage.findMany({
      where,
      orderBy: { voteAverage: "desc" },
      take: 4,
      select: { filePath: true },
    }),
    prisma.tmdbImage.count({ where }),
  ]);
  const urls = rows
    .map((row) => buildTmdbImageUrl(row.filePath, "w500"))
    .filter((url): url is string => url !== null);
  return { urls, total };
}
