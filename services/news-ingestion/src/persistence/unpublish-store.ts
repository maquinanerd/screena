/**
 * unpublish-store.ts — Adapter Prisma da despublicacao de emergencia.
 *
 * Executa o plano do nucleo puro (`../unpublish.js`) contra o banco publico:
 * rebaixa `article_translations`, reprojeta as superficies derivadas (busca +
 * indexabilidade) e devolve o estado final com o veredicto do MESMO gate de
 * render que a pagina usa (`evaluateArticlePublication` de @screena/seo).
 *
 * NUNCA publica, NUNCA apaga. Todo desfecho volta ao chamador — quem loga e o
 * bin/teste; quem decide abortar por inconsistencia e este adapter (fail-loud).
 */

import type { PrismaClient } from '@prisma/client'
import { evaluateArticlePublication } from '@screena/seo'

import {
  planUnpublishTranslations,
  verifyDemotionCount,
  type UnpublishMode,
  type UnpublishTranslationState,
} from '../unpublish.js'
import { reprojectArticle } from './editorial-store.js'

export interface UnpublishTranslationSnapshot extends UnpublishTranslationState {
  readonly slug: string
  readonly title: string
  readonly publishedAtIso: string | null
  /** A pagina publica AINDA serviria esta traducao? (gate real do render) */
  readonly renderable: boolean
}

export type UnpublishResult =
  | { readonly outcome: 'article_not_found' }
  | { readonly outcome: 'no_translations' }
  | {
      readonly outcome: 'noop' | 'planned' | 'demoted'
      readonly before: readonly UnpublishTranslationSnapshot[]
      readonly plannedCount: number
      readonly updatedCount: number
      readonly after: readonly UnpublishTranslationSnapshot[]
      /** Traducoes que AINDA passariam no gate de render depois do apply (deve ser 0). */
      readonly stillRenderable: number
      readonly reprojected: boolean
    }

interface ArticleFacts {
  readonly licenseStatus: string
  readonly displayAllowed: boolean
}

async function snapshotTranslations(
  prisma: PrismaClient,
  articleId: bigint,
  article: ArticleFacts,
  nowIso: string,
): Promise<UnpublishTranslationSnapshot[]> {
  const rows = await prisma.articleTranslation.findMany({
    where: { articleId },
    select: {
      id: true,
      languageCode: true,
      slug: true,
      title: true,
      reviewStatus: true,
      indexStatus: true,
      publishedAt: true,
    },
    orderBy: { languageCode: 'asc' },
  })
  return rows.map((row) => {
    const publishedAtIso = row.publishedAt === null ? null : row.publishedAt.toISOString()
    const verdict = evaluateArticlePublication(
      {
        reviewStatus: String(row.reviewStatus),
        licenseStatus: article.licenseStatus,
        displayAllowed: article.displayAllowed,
        slug: row.slug,
        title: row.title,
        publishedAtIso,
      },
      nowIso,
    )
    return {
      id: row.id,
      languageCode: row.languageCode,
      slug: row.slug,
      title: row.title,
      reviewStatus: String(row.reviewStatus),
      indexStatus: String(row.indexStatus),
      publishedAtIso,
      renderable: verdict.publishable,
    }
  })
}

/**
 * Despublica UM artigo por id: rebaixa toda traducao fora do estado-alvo e
 * reprojeta busca/indexabilidade. `apply=false` devolve so o plano (dry-run).
 *
 * Fail-loud: contagem de update divergente do plano vira excecao, nunca
 * retorno "de sucesso".
 */
export async function unpublishArticle(
  prisma: PrismaClient,
  input: {
    readonly articleId: bigint
    readonly mode: UnpublishMode
    readonly apply: boolean
    readonly nowIso: string
  },
): Promise<UnpublishResult> {
  const article = await prisma.article.findUnique({
    where: { id: input.articleId },
    select: { licenseStatus: true, displayAllowed: true },
  })
  if (article === null) return { outcome: 'article_not_found' }

  const facts: ArticleFacts = {
    licenseStatus: String(article.licenseStatus),
    displayAllowed: article.displayAllowed === true,
  }

  const before = await snapshotTranslations(prisma, input.articleId, facts, input.nowIso)
  if (before.length === 0) return { outcome: 'no_translations' }

  const plan = planUnpublishTranslations(before, input.mode)
  if (plan.pending.length === 0) {
    return {
      outcome: 'noop',
      before,
      plannedCount: 0,
      updatedCount: 0,
      after: before,
      stillRenderable: before.filter((t) => t.renderable).length,
      reprojected: false,
    }
  }

  if (!input.apply) {
    return {
      outcome: 'planned',
      before,
      plannedCount: plan.pending.length,
      updatedCount: 0,
      after: before,
      stillRenderable: before.filter((t) => t.renderable).length,
      reprojected: false,
    }
  }

  const updated = await prisma.articleTranslation.updateMany({
    where: { id: { in: plan.pending.map((t) => t.id) } },
    data: { reviewStatus: input.mode, indexStatus: 'noindex' },
  })
  const mismatch = verifyDemotionCount(plan.pending.length, updated.count)
  if (mismatch !== null) throw new Error(`[unpublish] ${mismatch}`)

  // Superficies derivadas (search_documents / page_indexability_decisions).
  // A pagina e a listagem ja caem pelo review_status; isto tira o resto.
  const reprojected = await reprojectArticle(prisma, String(input.articleId), input.nowIso)

  const after = await snapshotTranslations(prisma, input.articleId, facts, input.nowIso)
  const stillRenderable = after.filter((t) => t.renderable).length
  if (stillRenderable > 0) {
    throw new Error(
      `[unpublish] ${stillRenderable} traducao/oes AINDA passariam no gate de render apos o rebaixamento. Investigue.`,
    )
  }

  return {
    outcome: 'demoted',
    before,
    plannedCount: plan.pending.length,
    updatedCount: updated.count,
    after,
    stillRenderable,
    reprojected: reprojected !== null,
  }
}
