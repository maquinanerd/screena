/**
 * editorial-projection-store.ts — Adapter Prisma da projecao CMS -> publico.
 * Fora do typecheck puro (mesma disciplina de `editorial-store.ts`).
 *
 * Worker-only: nada aqui e importavel pelo render (invariantes 3 e 4).
 *
 * O nucleo (`../editorial-projection.js`) decide; este arquivo persiste. A
 * escrita do artigo, da traducao e do RECIBO acontece numa transacao unica: ou
 * o mundo publico mudou e existe prova de qual evento o mudou, ou nada
 * aconteceu. Nao existe estado intermediario "publicado sem recibo" — seria
 * exatamente o estado que faria um replay publicar duas vezes.
 */

import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@screena/db/server'

import {
  decideProjection,
  type ProjectionDecision,
  type ProjectionEvent,
  type ProjectionOutcome,
  type PublicArticleState,
} from '../editorial-projection.js'
import { reprojectArticle } from './editorial-store.js'

export interface ProjectionApplication {
  readonly outcome: ProjectionOutcome
  readonly reason: string
  readonly articleId: string | null
  readonly warnings: readonly string[]
  /** `true` quando a projecao efetivamente escreveu no banco publico. */
  readonly changed: boolean
}

/* ------------------------------------------------------------------ */
/* Leitura do estado atual                                             */
/* ------------------------------------------------------------------ */

export async function loadPublicArticleState(
  prisma: PrismaClient,
  payloadDocumentId: string,
  languageCode: string,
): Promise<PublicArticleState | null> {
  const article = await prisma.article.findUnique({
    where: { payloadDocumentId },
    select: {
      id: true,
      projectedSequence: true,
      translations: {
        where: { languageCode },
        select: { bodyBlocksVersion: true },
        take: 1,
      },
    },
  })
  if (article === null) return null
  return {
    articleId: String(article.id),
    projectedSequence: article.projectedSequence ?? null,
    translationBodyBlocksVersion: article.translations[0]?.bodyBlocksVersion ?? null,
  }
}

export async function findProjectionReceipt(
  prisma: PrismaClient,
  eventId: string,
): Promise<{ outcome: ProjectionOutcome; articleId: string | null } | null> {
  const receipt = await prisma.editorialProjectionReceipt.findUnique({
    where: { eventId },
    select: { outcome: true, articleId: true },
  })
  if (receipt === null) return null
  return {
    outcome: receipt.outcome as ProjectionOutcome,
    articleId: receipt.articleId === null ? null : String(receipt.articleId),
  }
}

/* ------------------------------------------------------------------ */
/* Aplicacao                                                           */
/* ------------------------------------------------------------------ */

/**
 * Projeta um evento no banco publico.
 *
 * `dryRun` decide tudo e nao escreve nada — e o modo de inspecao operacional,
 * util para ver o que uma fila acumulada faria antes de deixa-la rodar.
 */
export async function applyProjectionEvent(
  prisma: PrismaClient,
  input: {
    readonly event: ProjectionEvent
    readonly contentVersion: string | null
    readonly workerId: string
    readonly dryRun?: boolean
  },
): Promise<ProjectionApplication> {
  const { event } = input

  const existingReceipt = await findProjectionReceipt(prisma, event.eventId)
  const existing = await loadPublicArticleState(prisma, event.payloadDocumentId, event.language)

  const decision: ProjectionDecision = decideProjection({
    event,
    existingReceipt: existingReceipt === null ? null : { outcome: existingReceipt.outcome },
    existing,
    contentVersion: input.contentVersion,
  })

  if (input.dryRun === true) {
    return {
      outcome: decision.outcome,
      reason: `[dry-run] ${decision.reason}`,
      articleId: existing?.articleId ?? null,
      warnings: decision.warnings,
      changed: false,
    }
  }

  // REPLAY. Nada e reescrito — mas o modelo de leitura derivado (search
  // documents + decisao de indexabilidade) e REFRESCADO mesmo assim.
  //
  // O motivo e concreto: a projecao commita numa transacao e o refresh acontece
  // depois, porque `writeArticleIndexabilityDecision` abre transacao propria e
  // nao aninha. Se o worker morrer nessa janela, a unica chance de convergir e
  // o retry — e o retry cai exatamente aqui. Sem este refresh, uma materia
  // publicada ficaria para sempre fora da busca.
  if (decision.outcome === 'skipped_duplicate') {
    const articleId = existingReceipt?.articleId ?? existing?.articleId ?? null
    if (articleId !== null) {
      await reprojectArticle(prisma, articleId, event.occurredAtIso)
    }
    return {
      outcome: decision.outcome,
      reason: decision.reason,
      articleId,
      warnings: decision.warnings,
      changed: false,
    }
  }

  const articleId = await prisma.$transaction(async (tx) => {
    let resolvedId: bigint | null =
      existing === null ? null : BigInt(existing.articleId)

    if (decision.article !== null) {
      const write = decision.article
      const data = {
        category: write.category,
        authorName: write.authorName,
        publishedAt: write.publishedAtIso === null ? null : new Date(write.publishedAtIso),
        aiAssisted: write.aiAssisted,
        sourceName: write.sourceName,
        sourceUrl: write.sourceUrl,
        licenseStatus: write.licenseStatus,
        displayAllowed: write.displayAllowed,
        requiresAttribution: write.requiresAttribution,
        requiresLinkback: write.requiresLinkback,
        projectedSequence: write.projectedSequence,
      }
      // Upsert pela ANCORA do CMS, nao pelo slug: slug muda em edicao, o
      // documento de origem nao. Sem isto, renomear o titulo criaria um
      // segundo artigo publico em vez de atualizar o existente.
      const article = await tx.article.upsert({
        where: { payloadDocumentId: write.payloadDocumentId },
        create: { payloadDocumentId: write.payloadDocumentId, ...data },
        update: data,
        select: { id: true },
      })
      resolvedId = article.id
    }

    if (decision.translation !== null && resolvedId !== null) {
      const write = decision.translation
      const isRemoval = decision.article === null

      if (isRemoval) {
        // Rebaixamento: NAO reescreve titulo, slug nem corpo. Uma materia
        // retratada continua existindo com seu texto — o que muda e o estado.
        await tx.articleTranslation.updateMany({
          where: { articleId: resolvedId, languageCode: write.languageCode },
          data: {
            reviewStatus: write.reviewStatus,
            indexStatus: write.indexStatus,
            ...(write.correctedAtIso === null
              ? {}
              : { correctedAt: new Date(write.correctedAtIso) }),
            ...(write.correctionNote === null ? {} : { correctionNote: write.correctionNote }),
          },
        })
      } else {
        const data = {
          slug: write.slug,
          title: write.title,
          deck: write.deck,
          body: write.body,
          // `Prisma.DbNull` e NULL de coluna; `null` cru seria o JSON `null`
          // gravado dentro da coluna — dois estados diferentes, e o CHECK do
          // banco exige o par blocos/versao ausente por inteiro.
          bodyBlocks:
            write.bodyBlocks === null ? Prisma.DbNull : (write.bodyBlocks as never),
          bodyBlocksVersion: write.bodyBlocksVersion,
          metaTitle: write.metaTitle,
          metaDescription: write.metaDescription,
          reviewStatus: write.reviewStatus,
          indexStatus: write.indexStatus,
          publishedAt: write.publishedAtIso === null ? null : new Date(write.publishedAtIso),
          correctedAt: write.correctedAtIso === null ? null : new Date(write.correctedAtIso),
          correctionNote: write.correctionNote,
        }
        await tx.articleTranslation.upsert({
          where: {
            articleId_languageCode: {
              articleId: resolvedId,
              languageCode: write.languageCode,
            },
          },
          create: { articleId: resolvedId, languageCode: write.languageCode, ...data },
          update: data,
        })
      }
    }

    // O RECIBO na mesma transacao. A unique em `event_id` e a trava de replay:
    // se duas instancias do worker projetarem o mesmo evento em paralelo, a
    // segunda colide aqui e a transacao INTEIRA e desfeita — inclusive as
    // escritas de artigo/traducao acima.
    await tx.editorialProjectionReceipt.create({
      data: {
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        eventType: event.eventType,
        aggregateId: event.payloadDocumentId,
        emissionSequence: event.emissionSequence,
        articleId: resolvedId,
        contentVersion: input.contentVersion,
        outcome: decision.outcome,
        workerId: input.workerId,
        projectedAt: new Date(event.occurredAtIso),
      },
    })

    return resolvedId
  })

  // Modelo de leitura derivado, FORA da transacao (ver comentario do replay).
  if (articleId !== null && decision.outcome === 'applied') {
    await reprojectArticle(prisma, String(articleId), event.occurredAtIso)
  }

  return {
    outcome: decision.outcome,
    reason: decision.reason,
    articleId: articleId === null ? null : String(articleId),
    warnings: decision.warnings,
    changed: decision.outcome === 'applied',
  }
}
