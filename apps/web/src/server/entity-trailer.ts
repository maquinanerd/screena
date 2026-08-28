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
 * O QUE ESTA SEÇÃO DIZIA, E POR QUE ERA FALSO (corrigido em 2026-08-28)
 * ============================================================================
 * Até aqui ela afirmava, em caixa alta, que esta função "HOJE DEVOLVE `null`
 * PARA TODO MUNDO" porque "NADA no repositório" promove as linhas de
 * `tmdb_videos`. As duas metades ficaram falsas: `promote:media`
 * (`services/ingestion/src/media-promotion/`) existe desde 25/08/2026, e havia
 * 2.395 linhas acesas enquanto este comentário ainda dizia que não havia
 * nenhuma. Comentário mentiroso é pior que comentário ausente: ele encerra a
 * investigação na porta errada, e este repositório já pagou por isso.
 *
 * ESTADO REAL: a linha de `tmdb_videos` criada a partir de 28/08/2026 NASCE no
 * estado que a licença autoriza
 * (`services/ingestion/src/media-promotion/birth.ts`); as anteriores dependem de
 * uma passagem de `promote:media --target=all`. Esta função devolve `null` para
 * o título cujas linhas ainda não foram acesas — e para o que não tem vídeo.
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
/**
 * As entidades que podem ter trailer próprio.
 *
 * `season` entrou em 2026-08-27. Uma temporada TEM trailer próprio no TMDB — a
 * 2ª de Ted Lasso tem dois — e a página de temporada não mostrava nenhum porque
 * `sync_media` recusava `kind='season'`, então `tmdb_videos` nunca teve uma
 * linha com esse `entity_type`. Não era licença nem desenho: era coleta.
 *
 * `episode` fica de fora deste helper de propósito: vídeo de episódio é raro e,
 * quando existe, é bastidor ou cena — abrir um "Assistir ao trailer" que toca
 * um clipe de trinta segundos mentiria para o leitor, que é exatamente o que
 * `TRAILER_TYPE_RANK` já impede por tipo. Os vídeos de episódio, quando houver,
 * entram pela galeria, que lista o que existe sem prometer o que é.
 */
export type TrailerOwnerType = "movie" | "tv" | "season";

export async function getTrailerForEntity(
  prisma: PrismaClient,
  entityType: TrailerOwnerType,
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
