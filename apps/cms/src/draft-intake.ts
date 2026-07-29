/**
 * draft-intake.ts — NUCLEO PURO da entrada de drafts do MNScr.
 *
 * Toda a decisao vive aqui; o endpoint HTTP e um adaptador fino. Assim a regra
 * de aceitacao e testavel sem subir Payload, sem banco e sem rede — que e o
 * mesmo padrao ja usado em `services/news-ingestion`.
 *
 * Duas garantias que o nucleo entrega e o adaptador nao pode desfazer:
 *  1. O artigo resultante NASCE `automation_draft`. Nao ha caminho, para nenhum
 *     payload bem formado, que produza outro estado inicial.
 *  2. Nenhum campo de decisao humana (autoria, publicacao, QA, retencao legal)
 *     e escrito a partir do draft.
 */

import {
  parseEditorialDraftV1,
  type ContractIssue,
  type EditorialDraftV1,
} from '@screena/editorial-contracts'

import { SERVICE_ACCOUNT_FORBIDDEN_FIELDS } from './access.js'
import {
  buildDraftIdentity,
  decideIdempotency,
  httpStatusForOutcome,
  type DraftIdentity,
  type ExistingArticleSnapshot,
  type IdempotencyOutcome,
} from './idempotency.js'

/** Teto do corpo da requisicao, em bytes. Barra exaustao antes do parse. */
export const MAX_REQUEST_BYTES = 1_000_000

export type IntakeRejectionCode =
  | 'unauthenticated'
  | 'not_service_account'
  | 'payload_too_large'
  | 'invalid_json'
  | 'contract_violation'
  | 'idempotency_conflict'

export interface IntakeRejection {
  readonly code: IntakeRejectionCode
  readonly status: number
  /** Detalhe SEGURO: nunca ecoa o payload recebido. */
  readonly issues: readonly ContractIssue[]
}

/** Documento a ser criado/atualizado em `articles`. */
export interface ArticleDraftDocument {
  readonly workflowStatus: 'automation_draft'
  readonly automationDraftId: string
  readonly idempotencyKey: string
  readonly sourceClusterId: string
  readonly sourceRevision: number
  readonly sourcePayloadHash: string
  readonly draftPayloadHash: string
  readonly pipelineVersion: string
  readonly title: string
  readonly subtitle?: string
  readonly slug: string
  readonly summary: string
  readonly contentType: EditorialDraftV1['contentType']
  readonly language: string
  readonly body: readonly unknown[]
  readonly entityReferences: readonly unknown[]
  readonly externalSources: readonly unknown[]
  readonly claims: readonly unknown[]
  readonly provenanceJson: unknown
  readonly aiAssisted: boolean
  readonly blockingErrors: readonly string[]
  readonly warnings: readonly string[]
  readonly qaVersion: string
  readonly metaTitle?: string
  readonly metaDescription?: string
  readonly socialTitle?: string
  readonly socialDescription?: string
}

export interface IntakeAcceptance {
  readonly outcome: IdempotencyOutcome
  readonly status: number
  readonly articleId: string | null
  readonly identity: DraftIdentity
  /** `null` quando o desfecho nao escreve (reenvio identico). */
  readonly document: ArticleDraftDocument | null
  /** Midia CANDIDATA registrada sem aprovacao. */
  readonly mediaCandidates: readonly unknown[]
  readonly detail: string
}

export type IntakeResult =
  | { readonly ok: true; readonly acceptance: IntakeAcceptance }
  | { readonly ok: false; readonly rejection: IntakeRejection }

function reject(
  code: IntakeRejectionCode,
  status: number,
  issues: readonly ContractIssue[],
): IntakeResult {
  return { ok: false, rejection: { code, status, issues } }
}

/**
 * Projeta o draft no documento de artigo.
 *
 * O `workflowStatus` e um LITERAL, nao um campo derivado do payload: nenhuma
 * combinacao de entrada consegue mudar o estado inicial. E a razao de este
 * mapeamento existir em vez de um spread do draft — spread deixaria campo novo
 * do contrato virar campo de artigo sem revisao.
 */
export function toArticleDocument(
  draft: EditorialDraftV1,
  identity: DraftIdentity,
): ArticleDraftDocument {
  const document: ArticleDraftDocument = {
    workflowStatus: 'automation_draft',
    automationDraftId: draft.draftId,
    idempotencyKey: identity.idempotencyKey,
    sourceClusterId: identity.sourceClusterId,
    sourceRevision: identity.sourceRevision,
    sourcePayloadHash: identity.sourcePayloadHash,
    draftPayloadHash: identity.draftPayloadHash,
    pipelineVersion: identity.pipelineVersion,
    title: draft.title,
    ...(draft.subtitle === undefined ? {} : { subtitle: draft.subtitle }),
    slug: draft.slugProposal,
    summary: draft.summary,
    contentType: draft.contentType,
    language: draft.language,
    body: draft.blocks,
    // `verified` e forcado a false: confirmar vinculo e ato humano.
    entityReferences: draft.entitySuggestions.map((suggestion) => ({
      entityKind: suggestion.entityKind,
      entityId: suggestion.entityId,
      relation: suggestion.relation,
      confidence: suggestion.confidence,
      verified: false,
    })),
    externalSources: draft.externalSources.map((source) => ({
      sourceId: source.id,
      name: source.name,
      url: source.url,
      role: source.role,
    })),
    claims: draft.claimsUsed.map((entry) => ({
      claimId: entry.id,
      text: entry.text,
      origin: entry.origin,
      sourceRefs: entry.sourceRefs,
      conflictsWith: entry.conflictsWith ?? [],
    })),
    provenanceJson: draft.provenance,
    aiAssisted: true,
    blockingErrors: draft.qa.blockingErrors,
    warnings: draft.qa.warnings,
    qaVersion: draft.qa.version,
    ...(draft.seoProposal?.metaTitle === undefined
      ? {}
      : { metaTitle: draft.seoProposal.metaTitle }),
    ...(draft.seoProposal?.metaDescription === undefined
      ? {}
      : { metaDescription: draft.seoProposal.metaDescription }),
    ...(draft.seoProposal?.socialTitle === undefined
      ? {}
      : { socialTitle: draft.seoProposal.socialTitle }),
    ...(draft.seoProposal?.socialDescription === undefined
      ? {}
      : { socialDescription: draft.seoProposal.socialDescription }),
  }

  return document
}

/** Nenhum campo de decisao humana pode existir no documento produzido. */
export function assertNoHumanDecisionFields(document: ArticleDraftDocument): readonly string[] {
  const present = Object.keys(document)
  return SERVICE_ACCOUNT_FORBIDDEN_FIELDS.filter(
    (field) => field !== 'workflowStatus' && present.includes(field),
  )
}

/** Contexto de autenticacao ja resolvido pelo adaptador. */
export interface IntakeAuth {
  readonly authenticated: boolean
  /**
   * A credencial carrega o escopo `draft_ingest`?
   *
   * Deliberadamente NAO e "e uma service account": o worker de projecao tambem
   * e uma service account, e ele nao tem nada que criar rascunho editorial.
   */
  readonly hasIngestScope: boolean
  readonly accountId: string | null
}

/**
 * Processa uma entrada de draft.
 *
 * `rawBodyBytes` e o tamanho JA medido pelo adaptador: o nucleo nao le stream.
 */
export function intakeEditorialDraft(input: {
  readonly auth: IntakeAuth
  readonly rawBodyBytes: number
  readonly body: unknown
  readonly existing: ExistingArticleSnapshot | null
}): IntakeResult {
  if (!input.auth.authenticated) {
    return reject('unauthenticated', 401, [{ path: '(auth)', message: 'credencial ausente' }])
  }
  if (!input.auth.hasIngestScope) {
    // Um humano autenticado tambem e recusado: este canal e do pipeline. Humano
    // cria materia pelo painel, onde ha revisao e rastro de autoria.
    return reject('not_service_account', 403, [
      { path: '(auth)', message: 'endpoint restrito a service accounts' },
    ])
  }
  if (input.rawBodyBytes > MAX_REQUEST_BYTES) {
    return reject('payload_too_large', 413, [
      { path: '(body)', message: `corpo acima de ${MAX_REQUEST_BYTES} bytes` },
    ])
  }
  if (input.body === null || typeof input.body !== 'object') {
    return reject('invalid_json', 400, [{ path: '(body)', message: 'JSON de objeto esperado' }])
  }

  const parsed = parseEditorialDraftV1(input.body)
  if (!parsed.ok) return reject('contract_violation', 422, parsed.issues)

  const draft = parsed.value
  const identity = buildDraftIdentity(draft)
  const decision = decideIdempotency(identity, input.existing, draft.proposedAction)
  const status = httpStatusForOutcome(decision.outcome)

  const writes =
    decision.outcome === 'create' ||
    decision.outcome === 'update_automation_draft' ||
    decision.outcome === 'propose_update_to_published'

  if (status >= 400) {
    return reject('idempotency_conflict', status, [
      { path: '(idempotency)', message: `${decision.outcome}: ${decision.detail}` },
    ])
  }

  return {
    ok: true,
    acceptance: {
      outcome: decision.outcome,
      status,
      articleId: decision.articleId,
      identity,
      document: writes ? toArticleDocument(draft, identity) : null,
      // Candidata: registrada para o revisor ver, NUNCA aprovada aqui.
      mediaCandidates: draft.mediaCandidates,
      detail: decision.detail,
    },
  }
}
