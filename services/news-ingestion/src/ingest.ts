/**
 * ingest.ts — Orquestracao da ingestao de UM item recebido. PURO no que decide;
 * toda a IO sai pela porta `SourceItemStorePort`.
 *
 * Isto NAO e um leitor de RSS. A Cinerie nao reconstroi RSSPRIME nem MN26: o
 * transporte (feed, API, webhook) e responsabilidade de quem entrega o item.
 * Aqui comeca o contrato: normalizar identidade, decidir duplicata e persistir
 * de forma idempotente.
 */

import { classifyIncomingItem, type DedupVerdict } from './dedup.js'
import {
  contentFingerprint,
  normalizeArticleUrl,
  payloadFingerprint,
} from './identity.js'
import type { IngestSourceItemResult, SourceItemStorePort } from './ports.js'

/** Teto de retencao do trecho, espelhando o CHECK do banco. */
export const MAX_EXCERPT_CHARS = 1000

/** Item cru entregue por um upstream editorial. */
export interface RawEditorialItem {
  readonly sourceId: string
  readonly externalId: string
  readonly url?: string | null
  readonly title: string
  readonly author?: string | null
  readonly language?: string | null
  /** Trecho. Truncado; o corpo integral de terceiro NUNCA e persistido. */
  readonly excerpt?: string | null
  readonly publishedAtIso?: string | null
  readonly updatedAtIso?: string | null
  /** Payload cru, usado so para fingerprint de "sem mudanca". */
  readonly rawPayload?: unknown
}

export class EditorialIngestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'EditorialIngestError'
  }
}

/**
 * Trunca o trecho no teto de retencao.
 *
 * Nao e cosmetico: e o ponto onde a politica de retencao minima de conteudo de
 * terceiro e aplicada em codigo (o CHECK do banco e a segunda linha). Um
 * upstream que entregue o artigo inteiro em `excerpt` nao consegue transformar
 * `source_items` num espelho de conteudo alheio.
 */
export function clampExcerpt(excerpt: string | null | undefined): string | null {
  if (typeof excerpt !== 'string') return null
  const trimmed = excerpt.trim()
  if (trimmed === '') return null
  return trimmed.length <= MAX_EXCERPT_CHARS ? trimmed : trimmed.slice(0, MAX_EXCERPT_CHARS)
}

/**
 * Ingere um item de forma IDEMPOTENTE.
 *
 * Chamar duas vezes com o mesmo item resulta em zero duplicata: a identidade
 * (fonte, id externo) e unica no banco, e a segunda passagem cai em
 * `unchanged` (fingerprint igual) ou `updated` (o upstream mudou o item).
 */
export async function ingestEditorialItem(
  raw: RawEditorialItem,
  store: SourceItemStorePort,
): Promise<IngestSourceItemResult> {
  const externalId = raw.externalId.trim()
  if (externalId === '') {
    throw new EditorialIngestError('externalId vazio', 'missing_external_id')
  }
  const title = raw.title.trim()
  if (title === '') {
    throw new EditorialIngestError('title vazio', 'missing_title')
  }

  const excerpt = clampExcerpt(raw.excerpt)
  // URL invalida ou de esquema proibido vira `null` — o item ainda e rastreado,
  // mas nunca com uma URL que nao poderiamos exibir com seguranca.
  const normalizedUrl = normalizeArticleUrl(raw.url)
  const fingerprint = contentFingerprint(title, excerpt)

  const candidates = await store.findDedupCandidates({
    sourceId: raw.sourceId,
    externalId,
    normalizedUrl,
    contentFingerprint: fingerprint,
  })

  const decision = classifyIncomingItem(
    {
      sourceId: raw.sourceId,
      externalId,
      normalizedUrl,
      contentFingerprint: fingerprint,
      publishedAtIso: raw.publishedAtIso ?? null,
    },
    candidates,
  )

  // Reingestao do MESMO item (mesma fonte + mesmo external_id) nao e uma
  // duplicata a marcar: e um upsert. Marcar o item como duplicata de si mesmo
  // violaria o CHECK `source_items_not_self_duplicate` e, pior, perderia a
  // linha canonica.
  const isSameItem = decision.signal === 'source_external_id'
  const verdict: DedupVerdict = isSameItem ? 'unique' : decision.verdict
  const duplicateOfId = isSameItem ? null : decision.duplicateOfId

  return store.upsertSourceItem(
    {
      sourceId: raw.sourceId,
      externalId,
      canonicalUrl: raw.url ?? null,
      normalizedUrl,
      title,
      author: raw.author?.trim() ?? null,
      language: raw.language?.trim() ?? null,
      excerpt,
      contentFingerprint: fingerprint,
      payloadFingerprint: payloadFingerprint(raw.rawPayload),
      publishedAtIso: raw.publishedAtIso ?? null,
      sourceUpdatedAtIso: raw.updatedAtIso ?? null,
    },
    verdict,
    duplicateOfId,
  )
}
