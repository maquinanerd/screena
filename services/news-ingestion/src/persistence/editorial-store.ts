/**
 * editorial-store.ts — Adapters Prisma da plataforma editorial.
 * Coberto por `tsconfig.runtime.json` (fora do typecheck puro).
 *
 * Worker-only: nada aqui e importavel pelo render (invariantes 3 e 4).
 *
 * O nucleo puro (`../index.js`) decide; este arquivo so persiste. A divisao
 * importa porque as decisoes caras — o que e duplicata, o que pode publicar, o
 * que sai da busca — precisam ser testaveis sem banco.
 */

import type { PrismaClient } from '@screena/db/server'

import { classifyIncomingItem } from '../dedup.js'
import { contentFingerprint, normalizeArticleUrl, payloadFingerprint } from '../identity.js'
import { decideArticleIndexability, projectArticleSearchDocument } from '../projection.js'
import type { ArticleProjectionInput } from '../projection.js'
import { clampExcerpt, type RawEditorialItem } from '../ingest.js'
import type { IngestSourceItemResult } from '../ports.js'

/** Idioma unico publicado hoje (invariante 7). */
const LANGUAGE_CODE = 'pt-BR'

function isoOrNull(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString()
}

/* ------------------------------------------------------------------ */
/* Ingestao de item                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ingere um item de forma IDEMPOTENTE, com a deduplicacao aplicada.
 *
 * Os candidatos sao buscados por um OR ESTREITO — so os tres eixos que podem
 * gerar veredito forte. Varrer a tabela inteira para deduplicar seria O(n) por
 * item e, pior, aumentaria a chance de um falso positivo por acidente.
 */
export async function ingestSourceItem(
  prisma: PrismaClient,
  raw: RawEditorialItem,
): Promise<IngestSourceItemResult> {
  const externalId = raw.externalId.trim()
  const title = raw.title.trim()
  const excerpt = clampExcerpt(raw.excerpt)
  const normalizedUrl = normalizeArticleUrl(raw.url)
  const fingerprint = contentFingerprint(title, excerpt)
  const sourceId = BigInt(raw.sourceId)

  const candidateRows = await prisma.sourceItem.findMany({
    where: {
      OR: [
        { sourceId, externalId },
        ...(normalizedUrl === null ? [] : [{ normalizedUrl }]),
        ...(fingerprint === null ? [] : [{ sourceId, contentFingerprint: fingerprint }]),
      ],
    },
    select: {
      id: true,
      sourceId: true,
      externalId: true,
      normalizedUrl: true,
      contentFingerprint: true,
      publishedAt: true,
    },
  })

  const decision = classifyIncomingItem(
    {
      sourceId: raw.sourceId,
      externalId,
      normalizedUrl,
      contentFingerprint: fingerprint,
      publishedAtIso: raw.publishedAtIso ?? null,
    },
    candidateRows.map((row) => ({
      id: row.id.toString(),
      sourceId: row.sourceId.toString(),
      externalId: row.externalId,
      normalizedUrl: row.normalizedUrl,
      contentFingerprint: row.contentFingerprint,
      publishedAtIso: isoOrNull(row.publishedAt),
    })),
  )

  // Reingestao do MESMO item e upsert, nao duplicata: marca-lo como duplicata
  // de si mesmo violaria `source_items_not_self_duplicate`.
  const isSameItem = decision.signal === 'source_external_id'
  const verdict = isSameItem ? 'unique' : decision.verdict
  const duplicateOfId =
    isSameItem || decision.duplicateOfId === null ? null : BigInt(decision.duplicateOfId)

  const existing = candidateRows.find(
    (row) => row.sourceId === sourceId && row.externalId === externalId,
  )

  const data = {
    canonicalUrl: raw.url ?? null,
    normalizedUrl,
    title,
    author: raw.author?.trim() ?? null,
    language: raw.language?.trim() ?? null,
    excerpt,
    contentFingerprint: fingerprint,
    payloadFingerprint: payloadFingerprint(raw.rawPayload),
    publishedAt: raw.publishedAtIso === undefined || raw.publishedAtIso === null ? null : new Date(raw.publishedAtIso),
    sourceUpdatedAt:
      raw.updatedAtIso === undefined || raw.updatedAtIso === null ? null : new Date(raw.updatedAtIso),
    dedupVerdict: verdict,
    duplicateOfId,
    status: (verdict === 'duplicate' || verdict === 'superseded' ? 'deduplicated' : 'received') as
      | 'deduplicated'
      | 'received',
  }

  if (existing === undefined) {
    // O MESMO recurso ja existe NESTA fonte com outro `external_id` — o caso
    // rotineiro de feed que regenera GUIDs, ou de duas categorias do mesmo
    // site carregando a mesma materia.
    //
    // Nao ha linha nova a criar: o unique parcial
    // `source_items_source_normalized_url_unique` (source_id, normalized_url)
    // existe exatamente para impedir que a mesma fonte guarde o mesmo recurso
    // duas vezes. Tentar criar aqui abortaria a ingestao com violacao de
    // unique — uma duplicata ESPERADA nunca pode virar erro (a mesma regra do
    // C7B1.1: conflito previsto nao envenena a operacao).
    //
    // O primario e retido e devolvido; e por isso que `IngestSourceItemResult`
    // preve o desfecho `duplicate`.
    const sameSourceUrlOwner =
      normalizedUrl === null
        ? undefined
        : candidateRows.find(
            (row) => row.sourceId === sourceId && row.normalizedUrl === normalizedUrl,
          )

    if (sameSourceUrlOwner !== undefined) {
      // Carimba a verificacao no primario (foi reconfirmado agora) sem
      // reescrever conteudo: nada mudou nele.
      await prisma.sourceItem.update({
        where: { id: sameSourceUrlOwner.id },
        data: { fetchedAt: new Date() },
      })
      return {
        itemId: sameSourceUrlOwner.id.toString(),
        outcome: 'duplicate',
        verdict: 'duplicate',
      }
    }

    const created = await prisma.sourceItem.create({
      data: { sourceId, externalId, ...data },
      select: { id: true },
    })
    return { itemId: created.id.toString(), outcome: 'created', verdict }
  }

  // Sem mudanca no fingerprint: NAO reescreve (mesma disciplina do
  // `payload_hash` da ingestao de catalogo). Reescrever a toa transformaria
  // `updated_at` num log de execucao.
  const unchanged =
    existing.contentFingerprint !== null &&
    fingerprint !== null &&
    existing.contentFingerprint === fingerprint

  if (unchanged) {
    await prisma.sourceItem.update({
      where: { id: existing.id },
      data: { fetchedAt: new Date() },
    })
    return { itemId: existing.id.toString(), outcome: 'unchanged', verdict }
  }

  await prisma.sourceItem.update({ where: { id: existing.id }, data })
  return { itemId: existing.id.toString(), outcome: 'updated', verdict }
}

/* ------------------------------------------------------------------ */
/* Proveniencia                                                        */
/* ------------------------------------------------------------------ */

/**
 * Liga um artigo a uma fonte (proveniencia). Idempotente: repetir a mesma
 * ligacao nao cria uma segunda linha.
 *
 * `ON CONFLICT DO NOTHING` em vez de `catch`: um conflito ESPERADO nunca pode
 * envenenar uma transacao interativa em curso (regra ja aprendida no
 * C7B1.1 desta base).
 */
export async function linkArticleSource(
  prisma: PrismaClient,
  input: {
    articleId: string
    sourceId: string
    sourceItemId?: string | null
    role?: 'primary' | 'secondary' | 'press_release' | 'catalog'
  },
): Promise<void> {
  const role = input.role ?? 'secondary'
  const sourceItemId = input.sourceItemId == null ? null : BigInt(input.sourceItemId)
  await prisma.$executeRaw`
    INSERT INTO article_source_links (article_id, source_id, source_item_id, role)
    VALUES (${BigInt(input.articleId)}, ${BigInt(input.sourceId)}, ${sourceItemId}, ${role}::"ArticleSourceRole")
    ON CONFLICT DO NOTHING`
}

/** Quantas fontes sustentam o artigo (entrada do gate de publicacao). */
export async function countArticleProvenance(
  prisma: PrismaClient,
  articleId: string,
): Promise<number> {
  return prisma.articleSourceLink.count({ where: { articleId: BigInt(articleId) } })
}

/* ------------------------------------------------------------------ */
/* Projecao publica                                                    */
/* ------------------------------------------------------------------ */

/** Le os fatos de um artigo+traducao pt-BR, prontos para projetar. */
export async function readArticleProjectionInput(
  prisma: PrismaClient,
  articleId: string,
): Promise<ArticleProjectionInput | null> {
  const translation = await prisma.articleTranslation.findFirst({
    where: { articleId: BigInt(articleId), languageCode: LANGUAGE_CODE },
    select: {
      slug: true,
      title: true,
      deck: true,
      body: true,
      reviewStatus: true,
      indexStatus: true,
      publishedAt: true,
      article: {
        select: {
          category: true,
          authorName: true,
          heroImagePath: true,
          publishedAt: true,
          licenseStatus: true,
          displayAllowed: true,
          requiresAttribution: true,
          requiresLinkback: true,
          sourceName: true,
          sourceUrl: true,
        },
      },
    },
  })
  if (translation === null) return null

  return {
    articleId,
    locale: LANGUAGE_CODE,
    slug: translation.slug,
    title: translation.title,
    deck: translation.deck,
    body: translation.body,
    category: translation.article.category,
    authorName: translation.article.authorName,
    heroImagePath: translation.article.heroImagePath,
    reviewStatus: String(translation.reviewStatus),
    indexStatus: String(translation.indexStatus),
    licenseStatus: String(translation.article.licenseStatus),
    displayAllowed: translation.article.displayAllowed,
    requiresAttribution: translation.article.requiresAttribution,
    requiresLinkback: translation.article.requiresLinkback,
    sourceName: translation.article.sourceName,
    sourceUrl: translation.article.sourceUrl,
    translationPublishedAtIso: isoOrNull(translation.publishedAt),
    articlePublishedAtIso: isoOrNull(translation.article.publishedAt),
  }
}

export interface ArticleProjectionOutcome {
  readonly searchDocument: 'upserted' | 'removed'
  readonly decision: string
}

/**
 * Reprojeta UM artigo: documento de busca + decisao de indexabilidade.
 *
 * Idempotente e reversivel nos dois sentidos. O caminho de REMOCAO e o que
 * importa: quando o artigo deixa de ser publicavel (rascunho, retratado,
 * agendado, licenca revogada) o documento sai da busca. Sem ele, uma materia
 * retirada do ar continuaria pesquisavel.
 */
export async function reprojectArticle(
  prisma: PrismaClient,
  articleId: string,
  nowIso: string,
): Promise<ArticleProjectionOutcome | null> {
  const input = await readArticleProjectionInput(prisma, articleId)
  if (input === null) return null

  const doc = projectArticleSearchDocument(input, nowIso)
  const id = BigInt(articleId)

  if (doc === null) {
    await prisma.searchDocument.deleteMany({
      where: { docKind: 'article', articleId: id, locale: input.locale },
    })
  } else {
    // Upsert por (article_id, locale). O unique parcial
    // `search_documents_article_unique` garante no maximo uma linha.
    const existing = await prisma.searchDocument.findFirst({
      where: { docKind: 'article', articleId: id, locale: doc.locale },
      select: { id: true },
    })
    const payload = {
      primaryText: doc.primaryText,
      alternativeText: doc.alternativeText,
      normalizedText: doc.normalizedText,
      normalizedAliases: doc.normalizedAliases,
      subtitle: doc.subtitle,
      imagePath: doc.imagePath,
      canonicalUrl: doc.canonicalUrl,
    }
    if (existing === null) {
      await prisma.searchDocument.create({
        data: { docKind: 'article', articleId: id, locale: doc.locale, ...payload },
      })
    } else {
      await prisma.searchDocument.update({ where: { id: existing.id }, data: payload })
    }
  }

  const decision = decideArticleIndexability(input, nowIso)
  await writeArticleIndexabilityDecision(prisma, {
    articleId,
    languageCode: input.locale,
    url: decision.url ?? '',
    decision: decision.decision,
    reason: decision.reason,
    hasUniqueIntro: decision.hasUniqueIntro,
    decidedAtIso: nowIso,
  })

  return { searchDocument: doc === null ? 'removed' : 'upserted', decision: decision.decision }
}

/**
 * Grava a decisao VIGENTE de indexabilidade do artigo com supersede em
 * transacao — mesma disciplina do produtor de catalogo.
 *
 * SEM CHURN: decisao identica a vigente nao grava nada. Uma execucao diaria
 * sobre um acervo estavel deve produzir zero escritas; se produzir uma linha
 * por artigo por execucao, a tabela vira log de execucao e nao registro de
 * decisao.
 */
export async function writeArticleIndexabilityDecision(
  prisma: PrismaClient,
  input: {
    articleId: string
    languageCode: string
    url: string
    decision: string
    reason: string
    hasUniqueIntro: boolean
    decidedAtIso: string
  },
): Promise<'written' | 'unchanged'> {
  const id = BigInt(input.articleId)
  const current = await prisma.pageIndexabilityDecision.findFirst({
    where: {
      docKind: 'article',
      articleId: id,
      languageCode: input.languageCode,
      isCurrent: true,
    },
    select: { id: true, decision: true, reason: true },
  })

  if (current !== null && String(current.decision) === input.decision && current.reason === input.reason) {
    return 'unchanged'
  }

  await prisma.$transaction(async (tx) => {
    if (current !== null) {
      await tx.pageIndexabilityDecision.update({
        where: { id: current.id },
        data: { isCurrent: false },
      })
    }
    await tx.pageIndexabilityDecision.create({
      data: {
        docKind: 'article',
        articleId: id,
        languageCode: input.languageCode,
        url: input.url,
        decision: input.decision as 'index' | 'noindex' | 'draft' | 'stale' | 'blocked',
        reason: input.reason,
        isCurrent: true,
        supersedesId: current?.id ?? null,
        decisionOrigin: 'editorial_policy_engine',
        hasNews: true,
        hasUniqueIntro: input.hasUniqueIntro,
        decidedAt: new Date(input.decidedAtIso),
      },
    })
  })
  return 'written'
}

/* ------------------------------------------------------------------ */
/* Redirect de slug                                                    */
/* ------------------------------------------------------------------ */

/**
 * Grava o redirect de slug de artigo na tabela `redirects` que ja existe —
 * o runtime (`apps/web/src/server/seo/redirect-lookup.ts`) resolve a cadeia
 * sozinho. Nao ha segundo sistema de redirect.
 *
 * Colapsa cadeia e evita loop, como `catalog-finalize` faz para entidades:
 * apaga um eventual redirect que SAIA do destino e repoint a quem apontava
 * para a origem.
 */
export async function writeArticleSlugRedirect(
  prisma: PrismaClient,
  input: { fromPath: string; toPath: string },
): Promise<void> {
  if (input.fromPath === input.toPath) return // A -> A seria um loop
  await prisma.$transaction(async (tx) => {
    await tx.redirect.deleteMany({ where: { fromPath: input.toPath } })
    await tx.redirect.updateMany({
      where: { toPath: input.fromPath },
      data: { toPath: input.toPath },
    })
    await tx.redirect.upsert({
      where: { fromPath: input.fromPath },
      create: {
        fromPath: input.fromPath,
        toPath: input.toPath,
        statusCode: 301,
        languageCode: LANGUAGE_CODE,
        reason: 'article_slug_change',
      },
      update: { toPath: input.toPath, statusCode: 301, reason: 'article_slug_change' },
    })
  })
}

/* ------------------------------------------------------------------ */
/* Censo para a sentinela                                              */
/* ------------------------------------------------------------------ */

/** Le o censo editorial que a sentinela pura avalia. */
export async function readEditorialCensus(
  prisma: PrismaClient,
  nowIso: string,
): Promise<{
  activeSources: number
  sourceItemsTotal: number
  sourceItemsLast24h: number
  publishedArticles: number
  publishedArticleSearchDocs: number
  publishedArticleIndexDecisions: number
  publishedArticlesWithoutProvenance: number
  scheduledOverdue: number
  ingestFailures: number
}> {
  const now = new Date(nowIso)
  const dayAgo = new Date(now.getTime() - 86_400_000)

  const [
    activeSources,
    sourceItemsTotal,
    sourceItemsLast24h,
    publishedArticles,
    publishedArticleSearchDocs,
    publishedArticleIndexDecisions,
    ingestFailures,
  ] = await Promise.all([
    prisma.editorialSource.count({ where: { status: 'active' } }),
    prisma.sourceItem.count(),
    prisma.sourceItem.count({ where: { fetchedAt: { gte: dayAgo } } }),
    // "Publicado" aqui precisa significar o MESMO que a projecao considera
    // publicavel, senao a sentinela grita sozinha. Duas correcoes sobre a
    // contagem ingenua por review_status:
    //  - o gate de licenca/display entra (um artigo `published` porem
    //    bloqueado por licenca corretamente NAO tem documento de busca; sem
    //    este filtro ele acusaria `search_projection_stale` para sempre);
    //  - a data cai para `articles.published_at` quando a traducao nao tem uma
    //    propria, exatamente como `resolveArticlePublishedIso` faz.
    prisma.articleTranslation.count({
      where: {
        languageCode: LANGUAGE_CODE,
        reviewStatus: { in: ['human_reviewed', 'published'] },
        article: {
          displayAllowed: true,
          licenseStatus: { in: ['official', 'licensed', 'third_party'] },
        },
        OR: [
          { publishedAt: { lte: now } },
          { publishedAt: null, article: { publishedAt: { lte: now } } },
        ],
      },
    }),
    prisma.searchDocument.count({ where: { docKind: 'article', locale: LANGUAGE_CODE } }),
    prisma.pageIndexabilityDecision.count({
      where: { docKind: 'article', languageCode: LANGUAGE_CODE, isCurrent: true },
    }),
    prisma.sourceItem.count({ where: { status: 'failed' } }),
  ])

  const withoutProvenance = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM article_translations at
    JOIN articles a ON a.id = at.article_id
    WHERE at.language_code = ${LANGUAGE_CODE}
      AND at.review_status IN ('human_reviewed','published')
      AND COALESCE(at.published_at, a.published_at) <= ${now}
      AND NOT EXISTS (SELECT 1 FROM article_source_links l WHERE l.article_id = a.id)`

  // Agendada que passou da hora mas ainda nao tem documento de busca: sinal de
  // que a projecao nao rodou depois do embargo expirar.
  const overdue = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM article_translations at
    JOIN articles a ON a.id = at.article_id
    WHERE at.language_code = ${LANGUAGE_CODE}
      AND at.review_status = 'published'
      AND COALESCE(at.published_at, a.published_at) <= ${now}
      AND NOT EXISTS (
        SELECT 1 FROM search_documents sd
        WHERE sd.doc_kind = 'article' AND sd.article_id = a.id AND sd.locale = ${LANGUAGE_CODE}
      )`

  return {
    activeSources,
    sourceItemsTotal,
    sourceItemsLast24h,
    publishedArticles,
    publishedArticleSearchDocs,
    publishedArticleIndexDecisions,
    publishedArticlesWithoutProvenance: Number(withoutProvenance[0]?.n ?? 0n),
    scheduledOverdue: Number(overdue[0]?.n ?? 0n),
    ingestFailures,
  }
}
