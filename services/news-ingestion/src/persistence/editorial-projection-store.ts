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
import type { PlannedEntityLink } from '../editorial-entity-links.js'
import { reprojectArticle } from './editorial-store.js'
import type { ProjectedMediaAsset } from '../media/media-pipeline.js'
import { ProjectionFailure } from '../projection-failure.js'

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
/* Vinculos entidade <-> materia                                       */
/* ------------------------------------------------------------------ */

/**
 * O recorte do cliente de transacao que a reconciliacao usa.
 *
 * Estrutural em vez do tipo gerado do Prisma porque este arquivo ja vive fora
 * do typecheck puro; declarar o que se usa e mais honesto que um `as never`
 * que esconde a superficie real.
 */
interface EntityLinkTx {
  readonly entity: {
    findMany(args: unknown): Promise<{ entityType: unknown; entityId: bigint }[]>
  }
  readonly entityNewsLink: {
    findMany(args: unknown): Promise<{ id: bigint; entityType: unknown; entityId: bigint }[]>
    deleteMany(args: unknown): Promise<unknown>
    createMany(args: unknown): Promise<unknown>
  }
}

function linkKey(entityType: unknown, entityId: bigint): string {
  return `${String(entityType)}:${entityId.toString()}`
}

/**
 * Reconcilia `entity_news_links` com o conjunto que o CMS declarou.
 *
 * RECONCILIA, nao acrescenta. O evento carrega TODAS as entidades verificadas do
 * documento, entao o que nao esta nele foi desmarcado pelo editor — e um vinculo
 * removido no CMS tem de sair das relacionadas do filme. So inserir deixaria a
 * materia citada para sempre numa ficha da qual ela foi retirada.
 *
 * A verificacao contra `entities` acontece ANTES da escrita, e nao e paranoia:
 * `entity_news_links` tem FK COMPOSTA `(entity_type, entity_id) -> entities`
 * (migration `20260715120000_data_governance_hardening`). Um id que nao existe
 * abortaria a transacao INTEIRA — inclusive o artigo, a traducao e o recibo —
 * transformando "o editor digitou um id errado" em falha permanente da
 * publicacao. Fail-closed com aviso e o desfecho correto: a materia vai ao ar,
 * o vinculo falso nao nasce, e o operador ve o motivo no log.
 */
export async function reconcileEntityLinks(
  tx: EntityLinkTx,
  articleId: bigint,
  planned: readonly PlannedEntityLink[],
): Promise<string[]> {
  const warnings: string[] = []

  // 1. Quais entidades planejadas EXISTEM de fato no catalogo publico.
  //
  //    `entities` e mantida por trigger a partir de movies/tv_shows/people
  //    (mesma migration), entao consultar o registro cobre as tres raizes de
  //    uma vez, sem tres queries e sem assumir qual tabela e a dona.
  const verified: { entityType: string; entityId: bigint }[] = []
  if (planned.length > 0) {
    const rows = await tx.entity.findMany({
      where: {
        OR: planned.map((link) => ({
          entityType: link.entityType,
          entityId: BigInt(link.entityId),
        })),
      },
      select: { entityType: true, entityId: true },
    })
    const present = new Set(rows.map((row) => linkKey(row.entityType, row.entityId)))
    for (const link of planned) {
      const key = `${link.entityType}:${link.entityId}`
      if (!present.has(key)) {
        warnings.push(
          `entidade ${key} nao existe no catalogo publico: vinculo NAO criado (materia publicada sem ele)`,
        )
        continue
      }
      verified.push({ entityType: link.entityType, entityId: BigInt(link.entityId) })
    }
  }

  const current = await tx.entityNewsLink.findMany({
    where: { articleId },
    select: { id: true, entityType: true, entityId: true },
  })

  const desiredKeys = new Set(verified.map((link) => linkKey(link.entityType, link.entityId)))
  const currentKeys = new Set(current.map((row) => linkKey(row.entityType, row.entityId)))

  // 2. Sai o que o editor removeu.
  const staleIds = current
    .filter((row) => !desiredKeys.has(linkKey(row.entityType, row.entityId)))
    .map((row) => row.id)
  if (staleIds.length > 0) {
    await tx.entityNewsLink.deleteMany({ where: { id: { in: staleIds } } })
  }

  // 3. Entra o que falta. `skipDuplicates` mapeia para `ON CONFLICT DO NOTHING`,
  //    que NAO envenena a transacao: um conflito esperado (dois workers na mesma
  //    materia) nao pode derrubar a projecao inteira.
  const missing = verified.filter((link) => !currentKeys.has(linkKey(link.entityType, link.entityId)))
  if (missing.length > 0) {
    await tx.entityNewsLink.createMany({
      data: missing.map((link) => ({
        articleId,
        entityType: link.entityType,
        entityId: link.entityId,
      })),
      skipDuplicates: true,
    })
  }

  return warnings
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
    /**
     * Midias JA baixadas, verificadas e gravadas no storage.
     *
     * Chegam prontas porque download e upload NAO podem acontecer dentro da
     * transacao: segurar uma conexao e travas de linha pelo tempo de uma rede
     * lenta transforma latencia de CDN em contencao no banco publico.
     */
    readonly media?: ReadonlyMap<string, ProjectedMediaAsset>
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
    ...(input.media === undefined ? {} : { media: input.media }),
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

  // Avisos que so a persistencia conhece (ex.: entidade ausente do catalogo).
  // Ficam FORA do array do nucleo, que e `readonly`, e sao concatenados no fim.
  const persistenceWarnings: string[] = []

  const articleId = await prisma.$transaction(async (tx) => {
    let resolvedId: bigint | null =
      existing === null ? null : BigInt(existing.articleId)

    if (decision.article !== null) {
      const write = decision.article

      // Os assets sao gravados ANTES do artigo: o artigo referencia a capa por
      // FK, e uma FK apontando para linha inexistente aborta a transacao
      // inteira (levando junto o recibo, e transformando um evento projetavel
      // em falha permanente sem motivo real).
      let heroAssetId: bigint | null = null
      for (const asset of (input.media ?? new Map<string, ProjectedMediaAsset>()).values()) {
        const assetData = {
          contentHash: asset.contentHash,
          storageKey: asset.storageKey,
          publicPath: asset.publicPath,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          byteSize: asset.byteSize,
          alt: asset.alt,
          caption: asset.caption,
          credit: asset.credit,
          sourceName: asset.sourceName,
          sourceUrl: asset.sourceUrl,
          rightsHolder: asset.rightsHolder,
          licenseStatus: asset.licenseStatus as never,
          licenseReference: asset.licenseReference,
          licenseExpiresAt:
            asset.licenseExpiresAtIso === null ? null : new Date(asset.licenseExpiresAtIso),
          requiresAttribution: asset.requiresAttribution,
          allowedForEditorial: asset.allowedForEditorial,
          allowedForHero: asset.allowedForHero,
          allowedForSocial: asset.allowedForSocial,
        }
        // Upsert pelo documento de ORIGEM: trocar o arquivo no CMS atualiza esta
        // linha em vez de criar uma segunda verdade para a mesma midia.
        const stored = await tx.editorialMediaAsset.upsert({
          where: { payloadMediaId: asset.mediaId },
          create: { payloadMediaId: asset.mediaId, ...assetData },
          update: assetData,
          select: { id: true },
        })
        if (asset.mediaId === write.heroMediaId) heroAssetId = stored.id
      }

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
        // Capa: caminho publico LOCAL (o render recusa URL http(s)) mais o
        // vinculo com o asset, que preserva credito, licenca e dimensoes.
        heroImagePath: write.heroImagePath,
        heroMediaAssetId: heroAssetId,
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
          socialTitle: write.socialTitle,
          socialDescription: write.socialDescription,
          canonicalOverride: write.canonicalOverride,
          focusKeyphrase: write.focusKeyphrase,
          relatedKeyphrases: [...write.relatedKeyphrases],
          editorialKeywords: [...write.editorialKeywords],
          schemaTypeRecommendation: write.schemaTypeRecommendation,
          articleSection: write.articleSection,
          // Lista VAZIA vira NULL de coluna, nao `[]` dentro do JSON: "o CMS
          // nao aprovou nenhum alt" e "o CMS aprovou uma lista vazia" sao o
          // mesmo fato, e gravar os dois criaria duas representacoes do nada.
          approvedImageAlt:
            write.approvedImageAlt.length === 0
              ? Prisma.DbNull
              : (write.approvedImageAlt as never),
          approvedInternalLinks:
            write.approvedInternalLinks.length === 0
              ? Prisma.DbNull
              : (write.approvedInternalLinks as never),
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

    // VINCULOS DE ENTIDADE, na MESMA transacao do artigo e do recibo.
    //
    // `null` = evento sem conteudo (remocao/retratacao): nao reconcilia nada.
    // `[]` = o editor nao deixou nenhuma entidade: reconcilia para vazio.
    if (decision.entityLinks !== null && resolvedId !== null) {
      persistenceWarnings.push(
        ...(await reconcileEntityLinks(tx as unknown as EntityLinkTx, resolvedId, decision.entityLinks)),
      )
    }

    // A SEQUENCIA PROJETADA AVANCA MESMO QUANDO NAO HA ESCRITA DE ARTIGO.
    //
    // No ramo de remocao `decision.article` e `null`, entao o `upsert` acima
    // nao roda e `projected_sequence` ficava parada no valor da ultima
    // PUBLICACAO. Retratar no evento 50 deixava a sequencia em 30; um
    // `article.updated` de 40 reentregue depois passava pelo portao de "fora de
    // ordem" (40 > 30) e REPUBLICAVA a materia retratada — no ar de novo, sem
    // ninguem ter decidido isso.
    //
    // Este `update` e condicionado no proprio SQL (`lt`): duas projecoes
    // concorrentes nao podem fazer a sequencia RETROCEDER, mesmo que a mais
    // antiga commite por ultimo.
    if (decision.article === null && decision.sequenceAdvance !== null && resolvedId !== null) {
      await tx.article.updateMany({
        where: {
          id: resolvedId,
          OR: [{ projectedSequence: null }, { projectedSequence: { lt: decision.sequenceAdvance } }],
        },
        data: { projectedSequence: decision.sequenceAdvance },
      })
    }

    // RETIRADA SEM MATERIA NAO E "APLICADA".
    //
    // Sem artigo resolvido, o bloco de traducao acima nao roda (ele exige
    // `resolvedId`), nada e escrito — e mesmo assim o recibo nascia com
    // `outcome: 'applied'` e `article_id: NULL`. Pior que o registro errado: o
    // recibo e a TRAVA DE REPLAY. Uma retratacao registrada assim ficava
    // aplicada para sempre sem nunca ter sido aplicada, e o evento nao voltava.
    //
    // A causa mais comum e uma corrida legitima: a retratacao chega antes de o
    // `published` daquele artigo ter sido projetado. Falhar de forma
    // RETENTAVEL e a resposta certa — a publicacao aterrissa, o retry aplica a
    // retratacao, e o backoff/dead-letter da outbox cuida do caso que nao
    // converge. Lancar aqui derruba a transacao inteira: nenhum recibo.
    if (decision.outcome === 'applied' && resolvedId === null) {
      throw new ProjectionFailure(
        'projection_target_missing',
        `evento ${event.eventType} sem materia publica correspondente (documento ${event.payloadDocumentId}); nada foi aplicado`,
        true,
      )
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
    warnings: [...decision.warnings, ...persistenceWarnings],
    changed: decision.outcome === 'applied',
  }
}
