/**
 * ports.ts — Contratos entre o nucleo puro e a persistencia. PURO (so tipos).
 *
 * O nucleo nunca fala Prisma: recebe portas. Isso mantem a decisao editorial
 * testavel sem banco e impede que uma consulta escape para o caminho puro.
 */

import type { DedupVerdict } from './dedup.js'

/** Ator de uma mutacao editorial. NUNCA vem do corpo da requisicao. */
export interface EditorialActor {
  /** Identidade derivada da sessao/autorizacao, ja resolvida. */
  readonly id: string
  /** Papel efetivo verificado (nunca declarado pelo cliente). */
  readonly role: 'moderator' | 'admin' | 'system'
}

export interface UpsertSourceItemInput {
  readonly sourceId: string
  readonly externalId: string
  readonly canonicalUrl: string | null
  readonly normalizedUrl: string | null
  readonly title: string
  readonly author: string | null
  readonly language: string | null
  readonly excerpt: string | null
  readonly contentFingerprint: string | null
  readonly payloadFingerprint: string | null
  readonly publishedAtIso: string | null
  readonly sourceUpdatedAtIso: string | null
}

/** Resultado de uma ingestao idempotente de item. */
export interface IngestSourceItemResult {
  readonly itemId: string
  /** `created` na primeira vez; `updated` quando o conteudo mudou; */
  /** `unchanged` quando o fingerprint e o mesmo (nao reescreve a toa). */
  readonly outcome: 'created' | 'updated' | 'unchanged' | 'duplicate'
  readonly verdict: DedupVerdict
}

export interface SourceItemStorePort {
  /** Candidatos para deduplicar, ja restritos por fonte/URL/fingerprint. */
  findDedupCandidates(input: {
    readonly sourceId: string
    readonly externalId: string
    readonly normalizedUrl: string | null
    readonly contentFingerprint: string | null
  }): Promise<
    readonly {
      readonly id: string
      readonly sourceId: string
      readonly externalId: string
      readonly normalizedUrl: string | null
      readonly contentFingerprint: string | null
      readonly publishedAtIso: string | null
    }[]
  >

  upsertSourceItem(
    input: UpsertSourceItemInput,
    verdict: DedupVerdict,
    duplicateOfId: string | null,
  ): Promise<IngestSourceItemResult>
}

/** Porta de projecao publica do artigo (busca + indexabilidade). */
export interface ArticleProjectionStorePort {
  upsertArticleSearchDocument(doc: {
    readonly articleId: string
    readonly locale: string
    readonly primaryText: string
    readonly alternativeText: string
    readonly normalizedText: string
    readonly normalizedAliases: string
    readonly subtitle: string | null
    readonly canonicalUrl: string
    readonly imagePath: string | null
  }): Promise<void>

  /** Remove o documento de busca do artigo (deixou de ser publicavel). */
  deleteArticleSearchDocument(articleId: string, locale: string): Promise<void>

  /**
   * Grava a decisao vigente de indexabilidade do artigo, superseding a
   * anterior (historico append-only, como no catalogo).
   */
  writeArticleIndexabilityDecision(input: {
    readonly articleId: string
    readonly languageCode: string
    readonly url: string
    readonly decision: string
    readonly reason: string
    readonly hasNews: boolean
    readonly hasUniqueIntro: boolean
    readonly decidedAtIso: string
    readonly decisionOrigin: string
  }): Promise<void>
}
