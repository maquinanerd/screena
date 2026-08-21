/**
 * gallery-page.ts — Os dados das quatro páginas de galeria.
 *
 *   /pt/filmes/{slug}/imagens/   /pt/filmes/{slug}/videos/
 *   /pt/series/{slug}/imagens/   /pt/series/{slug}/videos/
 *
 * ============================================================================
 * UM MÓDULO PARA AS QUATRO, E ISSO NÃO É ECONOMIA DE LINHAS
 * ============================================================================
 * Filme e série diferem no `entity_type`, no segmento de URL e no rótulo — em
 * nada mais. Dois módulos gêmeos divergiriam no primeiro conserto aplicado a um
 * e esquecido no outro; é o defeito que este repositório já pagou em
 * `buildCoverageJob` e em `youtube-embed.ts`.
 *
 * A DIFERENCIAÇÃO filme/série continua obrigatória na TELA (invariante 11):
 * label + badge + breadcrumb + schema + URL. Ela vem do `vertical` que este
 * módulo devolve, não de um segundo arquivo.
 *
 * Invariantes 3 e 4: só PostgreSQL. Read-only.
 */

import { cache } from "react";

import { getPrismaClient } from "@screena/db/server";

import {
  buildImagesGallery,
  buildVideosGallery,
  type ImagesGalleryView,
  type VideosGalleryView,
} from "../lib/gallery-presenter";
import { imagesGalleryPath, videosGalleryPath } from "../lib/routes";
import { SITE_URL } from "../lib/site";
import { getImagesForEntity, getVideosForEntity } from "./entity-gallery";
import { getImageDisplayAuthorization } from "./image-license";

/** A vertical da página. É o segmento de URL E a chave dos rótulos. */
export type GalleryVertical = "filmes" | "series";

/** O que as quatro páginas têm em comum. */
interface GalleryBase {
  readonly vertical: GalleryVertical;
  /** `Filme` | `Série`. O LABEL textual da invariante 11. */
  readonly verticalLabel: string;
  readonly entityTitle: string;
  /** Slug canônico (pode diferir do slug pedido). */
  readonly canonicalSlug: string;
  /** URL da página do título — o "voltar para". */
  readonly entityPath: string;
  readonly canonicalUrl: string;
}

/** Dados da página de imagens. */
export interface ImagesGalleryPageData extends GalleryBase {
  readonly gallery: ImagesGalleryView;
}

/** Dados da página de vídeos. */
export interface VideosGalleryPageData extends GalleryBase {
  readonly gallery: VideosGalleryView;
}

const LANGUAGE_CODE = "pt-BR";

/** `filmes` -> `movie`. A tradução vive em UM lugar. */
function entityTypeOf(vertical: GalleryVertical): "movie" | "tv" {
  return vertical === "filmes" ? "movie" : "tv";
}

function verticalLabelOf(vertical: GalleryVertical): string {
  return vertical === "filmes" ? "Filme" : "Série";
}

/** O título e o backdrop da entidade, por vertical. */
async function loadEntity(
  prisma: ReturnType<typeof getPrismaClient>,
  vertical: GalleryVertical,
  entityId: bigint,
): Promise<{ tmdbId: number | null; title: string; backdropPath: string | null } | null> {
  if (vertical === "filmes") {
    const row = await prisma.movie.findUnique({
      where: { id: entityId },
      select: { tmdbId: true, titleOriginal: true, backdropPath: true },
    });
    if (row === null) return null;
    return { tmdbId: row.tmdbId, title: row.titleOriginal, backdropPath: row.backdropPath };
  }
  const row = await prisma.tvShow.findUnique({
    where: { id: entityId },
    select: { tmdbId: true, nameOriginal: true, backdropPath: true },
  });
  if (row === null) return null;
  return { tmdbId: row.tmdbId, title: row.nameOriginal, backdropPath: row.backdropPath };
}

/**
 * Resolve slug -> entidade, com o título já traduzido quando existe.
 *
 * Devolve `null` para slug inexistente E para entidade sem `tmdb_id`: as duas
 * galerias são chaveadas por `tmdb_id` (é assim que `tmdb_images`/`tmdb_videos`
 * guardam), então sem ele não há o que mostrar — e mostrar a galeria de OUTRO
 * título seria pior que 404.
 */
async function resolve(
  vertical: GalleryVertical,
  slug: string,
): Promise<
  | (GalleryBase & { tmdbId: number; backdropPath: string | null; entityId: bigint })
  | null
> {
  const prisma = getPrismaClient();
  const entityType = entityTypeOf(vertical);

  const slugRow = await prisma.slug.findFirst({
    where: { entityType, languageCode: LANGUAGE_CODE, slug },
    select: { entityId: true },
  });
  if (slugRow === null) return null;
  const entityId = slugRow.entityId;

  const [entity, canonicalSlugRow, translation] = await Promise.all([
    loadEntity(prisma, vertical, entityId),
    prisma.slug.findFirst({
      where: { entityType, entityId, languageCode: LANGUAGE_CODE, isCanonical: true },
      select: { slug: true },
    }),
    prisma.entityTranslation.findFirst({
      where: { entityType, entityId, languageCode: LANGUAGE_CODE },
      select: { title: true },
    }),
  ]);

  if (entity === null || entity.tmdbId === null) return null;

  const canonicalSlug = canonicalSlugRow?.slug ?? slug;
  const title = translation?.title?.trim() ?? entity.title;
  const entityPath = `/pt/${vertical}/${canonicalSlug}/`;

  return {
    vertical,
    verticalLabel: verticalLabelOf(vertical),
    entityTitle: title,
    canonicalSlug,
    entityPath,
    // Preenchido pelo chamador, que sabe se é imagens ou vídeos.
    canonicalUrl: "",
    tmdbId: entity.tmdbId,
    backdropPath: entity.backdropPath,
    entityId,
  };
}

/** Dados da galeria de IMAGENS. `null` = 404. Memoizado por request. */
export const getImagesGalleryPageData = cache(
  async (
    vertical: GalleryVertical,
    slug: string,
  ): Promise<ImagesGalleryPageData | null> => {
    const base = await resolve(vertical, slug);
    if (base === null) return null;

    const prisma = getPrismaClient();
    const [rows, authorization] = await Promise.all([
      getImagesForEntity(prisma, entityTypeOf(vertical), base.tmdbId),
      getImageDisplayAuthorization(prisma),
    ]);

    const path = imagesGalleryPath(vertical, base.canonicalSlug);
    return {
      ...base,
      canonicalUrl: path === null ? "" : `${SITE_URL}${path}`,
      gallery: buildImagesGallery(rows, base.entityTitle, authorization),
    };
  },
);

/** Dados da galeria de VÍDEOS. `null` = 404. Memoizado por request. */
export const getVideosGalleryPageData = cache(
  async (
    vertical: GalleryVertical,
    slug: string,
  ): Promise<VideosGalleryPageData | null> => {
    const base = await resolve(vertical, slug);
    if (base === null) return null;

    const prisma = getPrismaClient();
    const [rows, authorization] = await Promise.all([
      getVideosForEntity(prisma, entityTypeOf(vertical), base.tmdbId),
      getImageDisplayAuthorization(prisma),
    ]);

    const path = videosGalleryPath(vertical, base.canonicalSlug);
    return {
      ...base,
      canonicalUrl: path === null ? "" : `${SITE_URL}${path}`,
      gallery: buildVideosGallery(rows, base.backdropPath, authorization),
    };
  },
);
