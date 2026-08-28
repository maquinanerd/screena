/**
 * media-birth-reader.ts — Le `source_licenses` e monta a `MediaBirthPolicy`.
 * COBERTO por `tsconfig.runtime.json` (`pnpm typecheck` encadeia os dois).
 *
 * ============================================================================
 * UMA LEITURA POR CICLO DE MIDIA, E ELA E FRESCA
 * ============================================================================
 * Duas linhas de `source_licenses` (tmdb/image e tmdb/video) por execucao de
 * `sync_media`. E ruido perto das duas requisicoes HTTP que o mesmo job faz — e
 * comprar frescor com esse ruido e barato: uma licenca revogada as 14h passa a
 * valer no job seguinte, sem reiniciar processo nenhum.
 *
 * ============================================================================
 * FAIL-CLOSED NA LEITURA, TAMBEM
 * ============================================================================
 * Se a consulta falhar, a politica devolvida e `DARK_MEDIA_BIRTH_POLICY` — a
 * linha nasce apagada e o comando de acervo a promove depois. O caminho oposto
 * (assumir permissao quando nao se conseguiu ler a licenca) e exatamente o que a
 * invariante 6 proibe.
 */

import type { PrismaClient } from '@screena/db/server'

import {
  createMediaBirthPolicy,
  DARK_MEDIA_BIRTH_POLICY,
  type MediaBirthPolicy,
} from '../media-promotion/birth.js'
import type { MediaLicenseRow } from '../media-promotion/license.js'
import { GOVERNED_SOURCE_KEY } from '../media-promotion/types.js'

/** Resolve a politica de nascimento a partir do banco. NUNCA lanca. */
export type MediaBirthPolicyReader = () => Promise<MediaBirthPolicy>

/** Cria o leitor. */
export function createPrismaMediaBirthPolicyReader(
  prisma: PrismaClient,
  onError?: (error: unknown) => void,
): MediaBirthPolicyReader {
  return async (): Promise<MediaBirthPolicy> => {
    try {
      const rows = await prisma.sourceLicense.findMany({
        where: { sourceKey: GOVERNED_SOURCE_KEY },
        select: {
          sourceKey: true,
          contentType: true,
          licenseStatus: true,
          displayAllowed: true,
          isCurrent: true,
          policyVersion: true,
        },
      })
      const projetadas: MediaLicenseRow[] = rows.map((row) => ({
        sourceKey: row.sourceKey,
        contentType: String(row.contentType),
        licenseStatus: String(row.licenseStatus),
        displayAllowed: row.displayAllowed,
        isCurrent: row.isCurrent,
        policyVersion: row.policyVersion,
      }))
      return createMediaBirthPolicy({
        image: projetadas.filter((row) => row.contentType === 'image'),
        video: projetadas.filter((row) => row.contentType === 'video'),
      })
    } catch (error) {
      // Nao engole: quem chama loga. O DESFECHO e apagado, e ele e o seguro.
      onError?.(error)
      return DARK_MEDIA_BIRTH_POLICY
    }
  }
}
