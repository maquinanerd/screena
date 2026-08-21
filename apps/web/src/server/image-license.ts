/**
 * image-license.ts — A licença de IMAGEM, lida do banco. O SEXTO gate.
 *
 * Até 21/08/2026 o render tinha CINCO módulos que consultavam `source_licenses`
 * antes de exibir dado de terceiro — premiação, trailer, notas, onde-assistir e
 * o hero. Imagem não era um deles: o pôster ia ao ar sem que nada perguntasse se
 * podia. Este arquivo é o sexto.
 *
 * Invariantes 3 e 4: lê SOMENTE PostgreSQL local via @screena/db (Prisma). Zero
 * TMDB, zero rede, zero IA no caminho de render. Read-only.
 *
 * ============================================================================
 * POR QUE A LICENÇA E NÃO A LINHA
 * ============================================================================
 * Trailer e nota são gated pela LINHA (`tmdb_videos.display_allowed`,
 * `external_ratings.display_allowed`), porque cada vídeo/nota é promovido
 * individualmente. O pôster não tem linha: ele é a coluna `movies.poster_path`,
 * escrita pelo sync do detalhe. Não há o que promover por unidade.
 *
 * Então o gate correto é o da FONTE: `source_licenses` para `tmdb`/`image`. É a
 * mesma pergunta que o rodapé já faz para decidir creditar — só que agora
 * alguém a faz antes de exibir a arte.
 *
 * ============================================================================
 * FAIL-CLOSED, INCLUSIVE QUANDO O BANCO CAI
 * ============================================================================
 * Erro de consulta devolve NEGADO, não "deixa passar por enquanto". Um gate que
 * abre quando o banco tosse não é gate.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  authorizeImageDisplay,
  IMAGE_DISPLAY_DENIED,
  type ImageDisplayAuthorization,
  type ImageLicenseRow,
} from "@screena/public-contracts";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/**
 * A autorização de exibir imagem do TMDB, lida de `source_licenses`.
 *
 * Uma consulta por request. Não há cache de processo aqui de propósito: uma
 * revogação de licença tem de valer no próximo request, não no próximo deploy —
 * e o custo é uma leitura indexada de uma linha.
 */
export async function getImageDisplayAuthorization(
  prisma: PrismaClient,
): Promise<ImageDisplayAuthorization> {
  try {
    const rows = await prisma.sourceLicense.findMany({
      where: { sourceKey: "tmdb", contentType: "image", isCurrent: true },
      select: {
        sourceKey: true,
        contentType: true,
        licenseStatus: true,
        displayAllowed: true,
        isCurrent: true,
      },
    });

    const normalized: ImageLicenseRow[] = rows.map((row) => ({
      sourceKey: row.sourceKey,
      contentType: String(row.contentType),
      licenseStatus: String(row.licenseStatus),
      displayAllowed: row.displayAllowed,
      isCurrent: row.isCurrent,
    }));

    return authorizeImageDisplay(normalized);
  } catch {
    // Fail-closed. Ver o cabeçalho: um gate que abre quando o banco cai não é
    // gate. O motivo específico não sobe para o render (poderia carregar
    // fragmento de connection string); `IMAGE_DISPLAY_DENIED` diz o bastante.
    return IMAGE_DISPLAY_DENIED;
  }
}
