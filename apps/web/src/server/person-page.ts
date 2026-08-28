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
 *
 * Omitidos, mas CONTADOS (desde 25/08/2026). Antes disso a lista parcial tinha
 * exatamente a mesma cara da lista inteira. O denominador (`rawCreditCount`) sai
 * daqui, da linha crua, e a subtracao vive no presenter, que e quem ve quantos
 * sobreviveram — entao um descarte novo no meio do caminho entra na conta
 * sozinho, sem ninguem lembrar de soma-lo.
 *
 * QUAL DESCARTE E REAL, MEDIDO EM 25/08/2026:
 *  - `buildPersonCredits` (presenter) descartando alvo SEM slug canonico pt-BR:
 *    REAL. O titulo esta no catalogo e mesmo assim nao vira linha, porque nao ha
 *    pagina para onde linkar. E o unico que hoje faz a filmografia truncar.
 *  - `toCredit` devolvendo `null` por alvo ausente de `movies`/`tv_shows`:
 *    NAO alcancavel. `cast_members`/`crew_members` tem FK
 *    `(entity_type, entity_id) -> entities`, e `entities` e mantida 1:1 com as
 *    tabelas-raiz por trigger de INSERT/DELETE (ON DELETE RESTRICT). O banco
 *    recusa a linha orfa — provado no check 29 de
 *    `scripts/validate-person-page-real-postgres.ts`. O ramo fica como defesa:
 *    se a FK cair, o descarte passa a ser real e ja esta contado.
 *  - Alvo `season`/`episode` (guest star de episodio): fora do denominador de
 *    proposito — ver `countLinkableCreditRows`.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  buildPersonPhotosGallery,
  type PersonPhotosGalleryView,
} from "../lib/gallery-presenter";
import type { SectionAbsenceReason } from "../lib/section-absence";
import { SITE_URL } from "../lib/site";
import { getPhotosForPerson, personPhotoAbsenceReason } from "./entity-gallery";
import { getImageDisplayAuthorization } from "./image-license";
import {
  buildPersonPageView,
  countLinkableCreditRows,
  evaluatePersonIndexability,
  isPersonCreditEntityType,
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
   * display_allowed=true e licenca clara (invariante 6), e ainda gateada pela
   * licenca da FONTE. Vazia enquanto nada for promovido por decisao humana.
   *
   * A MESMA view que `/pt/pessoas/{slug}/fotos/` renderiza: a tira e o PREFIXO
   * da galeria (`strip`), nao uma segunda consulta com outra ordem.
   */
  gallery: PersonPhotosGalleryView;
  /**
   * POR QUE a tira nao renderizou, quando ela nao renderiza. `null` quando ha
   * foto — ausencia so precisa de motivo quando existe ausencia.
   */
  photosAbsenceReason: SectionAbsenceReason | null;
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
      // O denominador sai da ORIGEM (as linhas cruas), nao do fim de alguma
      // camada. Os dois numeros ja estao neste escopo — nao ha query nova.
      rawCreditCount:
        countLinkableCreditRows(castRows) + countLinkableCreditRows(crewRows),
    });

    // DEPOIS do `view` porque o `alt` de cada foto cita o nome ja resolvido
    // (traducao pt-BR quando existe), e nao o nome cru de `people`.
    const [photoRows, imageAuthorization] = await Promise.all([
      getPhotosForPerson(prisma, person.tmdbId),
      getImageDisplayAuthorization(prisma),
    ]);
    const gallery = buildPersonPhotosGallery(photoRows, view.name, imageAuthorization);
    // A sonda de catalogo so roda quando a tira esta vazia. Quem tem foto nao
    // paga por ela.
    const photosAbsenceReason =
      gallery.total === 0 ? await personPhotoAbsenceReason(prisma) : null;

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
      photosAbsenceReason,
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
  // MESMA porta que `countLinkableCreditRows` usa para montar o denominador de
  // `hiddenCreditCount`. Duplicar o criterio aqui faria a linha "N nao listados"
  // divergir do que a lista realmente descartou.
  if (!isPersonCreditEntityType(entityType)) return null;
  const target = targets.get(targetKey(entityType, entityId));
  if (target === undefined) return null;
  return {
    entityType,
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

/*
 * A CONSULTA DE FOTOS SAIU DAQUI — 27/08/2026.
 *
 * Ela vivia neste arquivo como `resolveLicensedGallery`, montava a URL com
 * `buildTmdbImageUrl` (o helper CRU) e ordenava no banco (`orderBy voteAverage`,
 * `take: 4`). Tres consequencias, todas medidas:
 *
 * 1. FALTAVA O GATE DA FONTE. A tira checava o gate por LINHA e nao a licenca
 *    de `source_licenses` para `tmdb`/`image` — o "sexto gate" que
 *    `image-license.ts` aplica ao poster desde 21/08/2026. Revogada a fonte, o
 *    poster da ficha apagaria e a tira de pessoa continuaria acesa.
 * 2. A ORDEM ERA OUTRA. O banco ordenava so por voto; a galeria ordena por
 *    idioma (pt-BR primeiro), depois voto, depois `file_path`. As "4 primeiras"
 *    da tira nao seriam as 4 primeiras da galeria, e o `+N` levaria a uma pagina
 *    que comeca com outras fotos.
 * 3. O `total` VINHA DE UM `count()` SEPARADO — outra origem que a lista
 *    exibida, e portanto livre para prometer um numero que a galeria nao
 *    entrega.
 *
 * Agora ha UMA porta (`getPhotosForPerson`) e UM presenter
 * (`buildPersonPhotosGallery`), compartilhados com `/pt/pessoas/{slug}/fotos/`.
 */
