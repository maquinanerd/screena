/**
 * entity-trailer.ts — O trailer de UM título, para o bloco de mídia do detalhe.
 *
 * Invariantes 3 e 4: lê SOMENTE PostgreSQL local via @screena/db (Prisma). Zero
 * TMDB, zero rede, zero IA no caminho de render. Read-only.
 *
 * ============================================================================
 * POR QUE ISTO NÃO EXISTIA
 * ============================================================================
 * `pickTrailer` existe desde a PR #174 e era usado por UM lugar só: o trilho
 * "Em breve" da home. O bloco de mídia do detalhe (telas 06 e 07 do canônico) —
 * pôster · trailer · 3 atalhos — mostrava o **backdrop** no lugar do trailer,
 * porque nada consultava `tmdb_videos` para a entidade da página.
 *
 * Não era permissão faltando: a licença de vídeo do TMDB existe desde
 * 13/08/2026 (`authorization-spec.ts`, entrada "TMDB (trailers)"). Era fiação.
 *
 * ============================================================================
 * O GATE APARECE DUAS VEZES, DE PROPÓSITO
 * ============================================================================
 * Na CONSULTA (a linha bloqueada nem sai do banco) e de novo em `pickTrailer`
 * (que também confere site, tipo e formato do id). A redundância é barata, e o
 * primeiro filtro é o que garante que dado sem licença não trafega para o
 * processo de render nem por engano.
 *
 * ============================================================================
 * HOJE DEVOLVE `null` PARA TODO MUNDO, E A CAUSA É A SEGUNDA
 * ============================================================================
 * As linhas de `tmdb_videos` nascem `display_allowed = false` por linha, e
 * NADA no repositório as promove. `source_licenses` diz o que a fonte permite;
 * a coluna da linha diz se aquele vídeo específico pode ir ao ar. São dois
 * passos — o mesmo desenho de ratings e streaming — e o segundo é operação
 * governada, não deploy.
 */

import { getPrismaClient } from "@screena/db/server";

import { pickTrailer, type TrailerRow, type TrailerView } from "../lib/trailer-presenter";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/**
 * O trailer exibível deste título, ou `null`.
 *
 * `null` cobre três estados que a página não precisa distinguir (não há vídeo,
 * há vídeo sem licença, há vídeo não promovido) — todos significam "não
 * exibir". Quem chama transforma em ausência REGISTRADA, nunca em bloco vazio.
 */
export async function getTrailerForEntity(
  prisma: PrismaClient,
  entityType: "movie" | "tv",
  tmdbId: number,
): Promise<TrailerView | null> {
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
      publishedAt: true,
      displayAllowed: true,
      licenseStatus: true,
    },
  });
  if (rows.length === 0) return null;

  const candidatos: TrailerRow[] = rows.map((row) => ({
    site: row.site,
    videoKey: row.videoKey,
    name: row.name,
    videoType: row.videoType,
    official: row.official,
    languageCode: row.languageCode,
    publishedAt: row.publishedAt,
    displayAllowed: row.displayAllowed,
    licenseStatus: row.licenseStatus,
  }));

  return pickTrailer(candidatos);
}
