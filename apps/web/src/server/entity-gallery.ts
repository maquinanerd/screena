/**
 * entity-gallery.ts — As duas galerias de um título, lidas do PostgreSQL.
 *
 * Invariantes 3 e 4: lê SOMENTE PostgreSQL local via @screena/db (Prisma). Zero
 * TMDB, zero rede, zero IA no caminho de render. Read-only.
 *
 * ============================================================================
 * DOIS GATES DIFERENTES, PORQUE SÃO DOIS DESENHOS DIFERENTES
 * ============================================================================
 * VÍDEO é gated por LINHA (`tmdb_videos.display_allowed` + `license_status`) —
 * o mesmo desenho de ratings e de onde-assistir, e o mesmo que
 * `entity-trailer.ts` já usa. Cada vídeo é promovido individualmente.
 *
 * IMAGEM é gated pela FONTE (`source_licenses` para `tmdb`/`image`), resolvido
 * em `image-license.ts` e aplicado dentro do presenter, onde a URL nasce. As
 * linhas de `tmdb_images` TÊM as colunas `display_allowed`/`license_status`,
 * mas nada no repositório as promove e o pôster da ficha (que vem de
 * `movies.poster_path`) não tem linha nenhuma — filtrar por elas aqui deixaria
 * a galeria permanentemente vazia enquanto a ficha exibe a mesma arte. Um gate
 * que contradiz o vizinho não é rigor, é incoerência.
 *
 * ============================================================================
 * O QUE ESTE MÓDULO NÃO FAZ
 * ============================================================================
 * Não decide indexabilidade (o presenter calcula `indexable` pelo piso; quem
 * emite `robots` é a página) e não baixa byte nenhum.
 */

import { getPrismaClient } from "@screena/db/server";

import type { GalleryImageRow, GalleryVideoRow } from "../lib/gallery-presenter";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Tipos de imagem que a galeria de TÍTULO exibe. `profile` é de pessoa. */
const TITLE_IMAGE_TYPES = ["poster", "backdrop", "logo", "still"] as const;

/**
 * As entidades que têm galeria própria.
 *
 * `season` e `episode` entraram em 2026-08-27, junto com o `sync_media` que
 * passou a coletá-las. A lista de tipos de imagem NÃO muda com eles: uma
 * temporada só tem `poster` e um episódio só tem `still`, e ambos já estavam
 * em `TITLE_IMAGE_TYPES`. Filtrar por tipo aqui seria uma segunda política de
 * "o que é imagem de quê", divergindo da que o presenter já aplica.
 *
 * O `tmdbId` destas duas é o id PRÓPRIO (`seasons.tmdb_id`/`episodes.tmdb_id`),
 * nunca o da série — é assim que `sync_media` grava.
 */
export type GalleryOwnerType = "movie" | "tv" | "season" | "episode";

/**
 * As imagens de um título, em TODOS os idiomas.
 *
 * Sem filtro de idioma de propósito: a galeria mostra o conjunto, e o
 * presenter só ORDENA por preferência (pt-BR primeiro). Filtrar aqui
 * reproduziria, dentro do produto, o mesmo estreitamento que o
 * `language=pt-BR` do TMDB já causa na coleta — e que `sync_media` evita
 * chamando o endpoint próprio sem `language`.
 */
export async function getImagesForEntity(
  prisma: PrismaClient,
  entityType: GalleryOwnerType,
  tmdbId: number,
): Promise<readonly GalleryImageRow[]> {
  const rows = await prisma.tmdbImage.findMany({
    where: { entityType, tmdbId, imageType: { in: [...TITLE_IMAGE_TYPES] } },
    select: {
      imageType: true,
      filePath: true,
      languageCode: true,
      width: true,
      height: true,
      voteAverage: true,
    },
    // Teto ALTO, não ausente: um título do TMDB pode ter centenas de artes, e
    // uma página com 2.000 imagens não é galeria — é uma negação de serviço
    // contra o próprio leitor. 240 cabe em 60 linhas de 4 colunas.
    take: 240,
  });
  return rows;
}

/**
 * Os vídeos EXIBÍVEIS de um título.
 *
 * O gate por linha aparece na CONSULTA: linha bloqueada não trafega para o
 * processo de render nem por engano. É o mesmo par de condições de
 * `entity-trailer.ts`.
 */
export async function getVideosForEntity(
  prisma: PrismaClient,
  entityType: GalleryOwnerType,
  tmdbId: number,
): Promise<readonly GalleryVideoRow[]> {
  const rows = await prisma.tmdbVideo.findMany({
    where: {
      entityType,
      tmdbId,
      // Invariante 6, na própria consulta.
      displayAllowed: true,
      licenseStatus: { notIn: ["unknown", "blocked"] },
    },
    select: {
      site: true,
      videoKey: true,
      name: true,
      videoType: true,
      official: true,
      languageCode: true,
      size: true,
      publishedAt: true,
    },
    take: 120,
  });
  return rows;
}

/**
 * As CONTAGENS das duas galerias, para a banda de mídia do detalhe.
 *
 * Existe separada dos dois leitores acima porque o detalhe precisa do NÚMERO
 * ("9 vídeos · 184 fotos") e não das linhas. Trazer 240 imagens para contar
 * seria pagar a galeria inteira em toda visita à ficha.
 *
 * As duas contagens usam EXATAMENTE os mesmos filtros dos leitores — se
 * divergissem, o detalhe prometeria um número que a galeria não entrega.
 */
export async function countGalleryMedia(
  prisma: PrismaClient,
  entityType: GalleryOwnerType,
  tmdbId: number,
): Promise<{ images: number; videos: number }> {
  const [images, videos] = await Promise.all([
    prisma.tmdbImage.count({
      where: { entityType, tmdbId, imageType: { in: [...TITLE_IMAGE_TYPES] } },
    }),
    prisma.tmdbVideo.count({
      where: {
        entityType,
        tmdbId,
        displayAllowed: true,
        licenseStatus: { notIn: ["unknown", "blocked"] },
      },
    }),
  ]);
  return { images, videos };
}
