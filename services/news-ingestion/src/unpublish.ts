/**
 * unpublish.ts — Nucleo PURO da despublicacao de emergencia.
 *
 * A decisao (o que rebaixar, quando o comando e no-op, quando o resultado e
 * inconsistente) vive aqui, sem Prisma nem rede, para ter teste proprio. O IO
 * fica em `persistence/unpublish-store.ts` e no bin.
 *
 * Regra espelhada da projecao de remocao (`editorial-projection.ts`):
 * despublicar = `review_status` blocked|archived + `index_status` noindex.
 * `blocked` e o vocabulario da RETRATACAO; `archived`, o da despublicacao
 * comum. Nunca ha exclusao fisica: auditoria preservada, reversao possivel.
 */

/** Modo da despublicacao — mesmo vocabulario da projecao de remocao. */
export type UnpublishMode = 'archived' | 'blocked'

export const UNPUBLISH_MODES: readonly UnpublishMode[] = ['archived', 'blocked']

export function isUnpublishMode(value: string): value is UnpublishMode {
  return (UNPUBLISH_MODES as readonly string[]).includes(value)
}

/** O que o planejador precisa saber de cada traducao. */
export interface UnpublishTranslationState {
  readonly id: bigint
  readonly languageCode: string
  readonly reviewStatus: string
  readonly indexStatus: string
}

export interface UnpublishPlan {
  /** Traducoes que ainda precisam ser rebaixadas. */
  readonly pending: readonly UnpublishTranslationState[]
  /** Traducoes ja no estado-alvo (fazem o comando ser idempotente). */
  readonly alreadyDone: readonly UnpublishTranslationState[]
}

/**
 * Monta o plano de rebaixamento. Uma traducao entra em `pending` se QUALQUER
 * uma das duas colunas divergir do alvo — index_status sozinho fora do lugar
 * tambem e pendencia (sitemap/robots leem dele).
 */
export function planUnpublishTranslations(
  translations: readonly UnpublishTranslationState[],
  mode: UnpublishMode,
): UnpublishPlan {
  const pending: UnpublishTranslationState[] = []
  const alreadyDone: UnpublishTranslationState[] = []
  for (const translation of translations) {
    if (translation.reviewStatus === mode && translation.indexStatus === 'noindex') {
      alreadyDone.push(translation)
    } else {
      pending.push(translation)
    }
  }
  return { pending, alreadyDone }
}

/**
 * O update reportou o que o plano previa?
 *
 * `updated: 0` (ou parcial) com pendencia planejada e o padrao de falha
 * silenciosa que ja mordeu este projeto seis vezes — aqui ele vira erro
 * explicito, nunca "sucesso".
 */
export function verifyDemotionCount(plannedCount: number, updatedCount: number): string | null {
  if (updatedCount === plannedCount) return null
  return (
    `esperava rebaixar ${plannedCount} traducao/oes, o banco reportou ${updatedCount}. ` +
    'Nada de silencio: investigue antes de repetir.'
  )
}
