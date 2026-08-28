/**
 * person-photos-page.ts — Os dados de `/pt/pessoas/{slug}/fotos/`.
 *
 * ============================================================================
 * POR QUE UM MODULO PROPRIO, E NAO UM QUINTO CASO EM `gallery-page.ts`
 * ============================================================================
 * `gallery-page.ts` e parametrizado por `GalleryVertical` (`filmes` | `series`)
 * porque as quatro paginas de titulo diferem em TRES coisas e nada mais:
 * `entity_type`, segmento de URL e rotulo. Pessoa nao cabe nessa parametrizacao
 * — muda a tabela-raiz (`people`), muda o `image_type` (`profile`, que
 * `TITLE_IMAGE_TYPES` exclui de proposito), muda o gate (a foto e promovida por
 * LINHA; a imagem de titulo nao tem o que promover) e some a distincao
 * filme/serie que da sentido ao parametro.
 *
 * Alargar `GalleryVertical` para `'pessoas'` obrigaria todo consumidor daquele
 * tipo a tratar um caso em que `verticalLabel`, `backdropPath` e o schema
 * `Movie|TVSeries` nao significam nada. O casco visual CONTINUA compartilhado
 * (`GalleryShell`) — o que nao se compartilha e a consulta.
 *
 * Invariantes 3 e 4: le SOMENTE PostgreSQL local via @screena/db. Read-only.
 */

import { cache } from "react";

import { getPrismaClient } from "@screena/db/server";

import {
  buildPersonPhotosGallery,
  type PersonPhotosGalleryView,
} from "../lib/gallery-presenter";
import { personPhotosPath } from "../lib/routes";
import { SITE_URL } from "../lib/site";
import { getPhotosForPerson } from "./entity-gallery";
import { getImageDisplayAuthorization } from "./image-license";

const LANGUAGE_CODE = "pt-BR";
const ENTITY_TYPE = "person";

/** Dados da pagina de fotos de uma pessoa. */
export interface PersonPhotosPageData {
  readonly personName: string;
  /** Slug canonico (pode diferir do slug pedido — o chamador redireciona 301). */
  readonly canonicalSlug: string;
  /** Caminho da ficha da pessoa — o "voltar para". */
  readonly personPath: string;
  readonly canonicalUrl: string;
  readonly gallery: PersonPhotosGalleryView;
}

/**
 * `null` = 404.
 *
 * Devolve `null` tambem para pessoa sem `tmdb_id`: `tmdb_images` e chaveada por
 * ele, entao sem `tmdb_id` nao ha o que mostrar — e mostrar a galeria de OUTRA
 * pessoa seria pior que 404. Mesma decisao (e mesmo motivo) de `resolve()` em
 * `gallery-page.ts`.
 */
export const getPersonPhotosPageData = cache(
  async (slug: string): Promise<PersonPhotosPageData | null> => {
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;
    const entityId = slugRow.entityId;

    const [person, canonicalSlugRow, translation, authorization] = await Promise.all([
      prisma.person.findUnique({
        where: { id: entityId },
        select: { name: true, tmdbId: true },
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
        where: { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE_CODE },
        select: { title: true },
      }),
      getImageDisplayAuthorization(prisma),
    ]);

    if (person === null) return null;

    const canonicalSlug = canonicalSlugRow?.slug ?? slug;
    // A traducao pt-BR do nome vence o nome cru, igual a ficha: as duas telas
    // precisam chamar a pessoa pelo mesmo nome.
    const personName = translation?.title?.trim() ?? person.name;
    const rows = await getPhotosForPerson(prisma, person.tmdbId);
    const path = personPhotosPath(canonicalSlug);

    return {
      personName,
      canonicalSlug,
      personPath: `/pt/pessoas/${canonicalSlug}/`,
      canonicalUrl: path === null ? "" : `${SITE_URL}${path}`,
      gallery: buildPersonPhotosGallery(rows, personName, authorization),
    };
  },
);
