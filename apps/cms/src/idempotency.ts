/**
 * idempotency.ts — Identidade e decisao de idempotencia do endpoint de drafts.
 * PURO (o unico IO e `node:crypto`, que e determinista).
 *
 * O MNScr reenvia. Redes falham no meio, workers reiniciam, filas reprocessam.
 * Sem identidade estavel, cada reenvio criaria uma materia nova — e a redacao
 * receberia cinco copias do mesmo acontecimento.
 *
 * A decisao NAO e "ja existe? entao ignore": ela distingue reenvio identico
 * (devolver o mesmo resultado), corpo diferente sob a mesma chave (conflito, e
 * um bug do produtor), revisao mais nova (atualizar) e revisao mais velha
 * chegando atrasada (recusar, senao um retry antigo sobrescreve o estado atual).
 */

import { createHash } from 'node:crypto'

import type { EditorialDraftV1 } from '@screena/editorial-contracts'

/* ------------------------------------------------------------------ */
/* Hash canonico                                                       */
/* ------------------------------------------------------------------ */

/**
 * Serializacao canonica: chaves de objeto ORDENADAS, recursivamente.
 *
 * `JSON.stringify` preserva a ordem de insercao, entao dois payloads
 * semanticamente iguais com campos em ordem diferente produziriam hashes
 * diferentes — e o mesmo draft reenviado viraria "corpo diferente" (conflito).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue
    out[key] = canonicalize(source[key])
  }
  return out
}

/** sha-256 hex da forma canonica. Determinista e estavel entre processos. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

/* ------------------------------------------------------------------ */
/* Identidade                                                          */
/* ------------------------------------------------------------------ */

/** Identidade minima de um draft recebido. */
export interface DraftIdentity {
  readonly idempotencyKey: string
  readonly sourceClusterId: string
  readonly sourceRevision: number
  readonly sourcePayloadHash: string
  readonly pipelineVersion: string
  /** Hash canonico do draft inteiro. */
  readonly draftPayloadHash: string
}

export function buildDraftIdentity(draft: EditorialDraftV1): DraftIdentity {
  return {
    idempotencyKey: draft.idempotencyKey,
    sourceClusterId: draft.sourceClusterId,
    sourceRevision: draft.sourceRevision,
    sourcePayloadHash: draft.sourcePayloadHash,
    pipelineVersion: draft.pipelineVersion,
    draftPayloadHash: canonicalHash(draft),
  }
}

/* ------------------------------------------------------------------ */
/* Decisao                                                             */
/* ------------------------------------------------------------------ */

/** Artigo ja existente que colide com o draft recebido. */
export interface ExistingArticleSnapshot {
  readonly articleId: string
  readonly idempotencyKey: string | null
  readonly sourceClusterId: string | null
  readonly sourceRevision: number | null
  readonly draftPayloadHash: string | null
  readonly workflowStatus: string
  /** `true` quando o artigo tem edicao humana (nao e mais so saida do writer). */
  readonly humanAuthored: boolean
}

export type IdempotencyOutcome =
  /** Reenvio identico: devolver o resultado existente, sem escrever. */
  | 'duplicate_noop'
  /** Nada existe: criar `automation_draft`. */
  | 'create'
  /** Revisao mais nova de um draft de automacao: atualizar preservando historico. */
  | 'update_automation_draft'
  /** Alvo ja publicado: registrar PROPOSTA para revisao, nunca alterar em silencio. */
  | 'propose_update_to_published'
  /** Mesma chave, corpo diferente: bug do produtor. */
  | 'conflict_same_key_different_body'
  /** Revisao mais antiga chegando depois: recusar. */
  | 'stale_revision'
  /** Artigo com autoria humana: nunca sobrescrever. */
  | 'refuse_human_authored'

export interface IdempotencyDecision {
  readonly outcome: IdempotencyOutcome
  readonly articleId: string | null
  readonly detail: string
}

/**
 * Decide o que fazer com um draft recebido, dado o que ja existe.
 *
 * A ordem das checagens importa e e do mais grave para o mais comum:
 * proteger conteudo humano vem antes de qualquer conveniencia de automacao.
 */
export function decideIdempotency(
  identity: DraftIdentity,
  existing: ExistingArticleSnapshot | null,
  proposedAction: EditorialDraftV1['proposedAction'],
): IdempotencyDecision {
  if (existing === null) {
    if (proposedAction !== 'create') {
      return {
        outcome: 'stale_revision',
        articleId: null,
        detail: `proposedAction "${proposedAction}" referencia um artigo que nao existe`,
      }
    }
    return { outcome: 'create', articleId: null, detail: 'nenhum artigo correspondente' }
  }

  // 1. Conteudo humano nunca e sobrescrito por automacao. Nem com a mesma chave.
  if (existing.humanAuthored && existing.workflowStatus !== 'automation_draft') {
    return {
      outcome: 'refuse_human_authored',
      articleId: existing.articleId,
      detail: 'artigo tem autoria humana; automacao nao sobrescreve',
    }
  }

  // 2. Reenvio exato: mesma chave E mesmo corpo.
  if (
    existing.idempotencyKey === identity.idempotencyKey &&
    existing.draftPayloadHash === identity.draftPayloadHash
  ) {
    return {
      outcome: 'duplicate_noop',
      articleId: existing.articleId,
      detail: 'reenvio identico',
    }
  }

  // 3. Mesma chave, corpo diferente. Idempotencia quebrada na origem.
  if (
    existing.idempotencyKey === identity.idempotencyKey &&
    existing.draftPayloadHash !== identity.draftPayloadHash
  ) {
    return {
      outcome: 'conflict_same_key_different_body',
      articleId: existing.articleId,
      detail: 'mesma idempotencyKey com corpo diferente',
    }
  }

  // 4. Revisao. Sem revisao registrada, tratamos como -1 para que qualquer
  //    revisao >= 0 seja considerada mais nova.
  const currentRevision = existing.sourceRevision ?? -1
  if (identity.sourceRevision < currentRevision) {
    return {
      outcome: 'stale_revision',
      articleId: existing.articleId,
      detail: `revisao ${identity.sourceRevision} e anterior a ${currentRevision}`,
    }
  }
  if (identity.sourceRevision === currentRevision) {
    if (existing.draftPayloadHash === identity.draftPayloadHash) {
      return { outcome: 'duplicate_noop', articleId: existing.articleId, detail: 'mesma revisao e mesmo corpo' }
    }
    return {
      outcome: 'conflict_same_key_different_body',
      articleId: existing.articleId,
      detail: `revisao ${identity.sourceRevision} reenviada com corpo diferente`,
    }
  }

  // 5. Revisao mais nova. O destino depende do estado do artigo.
  if (existing.workflowStatus === 'published') {
    return {
      outcome: 'propose_update_to_published',
      articleId: existing.articleId,
      detail: 'artigo publicado: atualizacao vira proposta para revisao humana',
    }
  }
  if (existing.workflowStatus === 'automation_draft') {
    return {
      outcome: 'update_automation_draft',
      articleId: existing.articleId,
      detail: `revisao ${identity.sourceRevision} substitui ${currentRevision}`,
    }
  }

  // Draft ja em fluxo humano (needs_review, in_review, ...): a automacao nao
  // puxa o texto de baixo de quem esta revisando.
  return {
    outcome: 'propose_update_to_published',
    articleId: existing.articleId,
    detail: `artigo em "${existing.workflowStatus}": atualizacao vira proposta`,
  }
}

/** Mapeia o desfecho para o status HTTP correspondente. */
export function httpStatusForOutcome(outcome: IdempotencyOutcome): number {
  switch (outcome) {
    case 'create':
      return 201
    case 'update_automation_draft':
    case 'duplicate_noop':
    case 'propose_update_to_published':
      return 200
    case 'conflict_same_key_different_body':
    case 'refuse_human_authored':
      return 409
    case 'stale_revision':
      return 409
  }
}
