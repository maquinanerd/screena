/**
 * outbox-api.ts — NUCLEO PURO do claim/ack/fail da outbox.
 *
 * Toda a decisao vive aqui; os endpoints sao adaptadores finos. E o mesmo padrao
 * do resto do CMS, e e o que torna a politica de lease, retry e dead-letter
 * testavel sem subir servidor.
 *
 * O que este modulo NAO faz: nao fala com banco, nao gera aleatoriedade e nao le
 * o relogio. `now`, `leaseToken` e `workerId` sao sempre INJETADOS — senao a
 * politica de backoff seria impossivel de testar no tempo.
 */

import type { OutboxStatus } from './outbox.js'

/* ------------------------------------------------------------------ */
/* Escopos de service account                                          */
/* ------------------------------------------------------------------ */

/**
 * Escopos explicitos. Um booleano generico de "automacao" daria ao MNScr o
 * poder de consumir a outbox e ao worker de projecao o poder de criar drafts —
 * dois sistemas diferentes herdando os poderes um do outro por descuido.
 *
 *   draft_ingest            cria/atualiza rascunho; NAO publica
 *   editorial_auto_publish  pede publicacao automatica; NAO consome a outbox
 *   publication_projection  consome a outbox; NAO publica no Payload
 *   editorial_media_ingest  sobe FOTO para uma materia; NAO cria materia
 *
 * `draft_ingest`, `editorial_auto_publish` e `editorial_media_ingest` podem
 * coexistir numa conta (o MNScr usa os tres modos). `publication_projection`
 * fica SOZINHO na conta do worker: quem drena a fila nao tem por que criar
 * conteudo, e quem cria conteudo nao tem por que drenar a fila.
 *
 * `editorial_media_ingest` e separado de `draft_ingest` de proposito, e nao por
 * simetria: a foto e o unico dado que atravessa a fronteira como BYTES, e o
 * unico que, uma vez no acervo, e servido publicamente. Dar essa capacidade a
 * quem so precisa escrever texto seria alargar o raio de estrago de uma chave
 * vazada sem nenhum ganho.
 */
export const SERVICE_ACCOUNT_SCOPES = [
  'draft_ingest',
  'publication_projection',
  'editorial_auto_publish',
  'editorial_media_ingest',
] as const
export type ServiceAccountScope = (typeof SERVICE_ACCOUNT_SCOPES)[number]

export function hasScope(scopes: unknown, required: ServiceAccountScope): boolean {
  if (!Array.isArray(scopes)) return false
  return scopes.some((scope) => scope === required)
}

/* ------------------------------------------------------------------ */
/* Limites                                                             */
/* ------------------------------------------------------------------ */

export const MAX_BATCH_SIZE = 25
export const DEFAULT_BATCH_SIZE = 10
export const DEFAULT_LEASE_MS = 60_000
export const DEFAULT_MAX_ATTEMPTS = 5
export const DEFAULT_BACKOFF_BASE_MS = 2_000
export const DEFAULT_BACKOFF_MAX_MS = 300_000

export function clampBatchSize(value: unknown): number {
  const parsed = typeof value === 'number' ? Math.trunc(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE
  return Math.min(parsed, MAX_BATCH_SIZE)
}

/* ------------------------------------------------------------------ */
/* Elegibilidade de claim                                              */
/* ------------------------------------------------------------------ */

/** Estado minimo de uma linha da outbox para decidir se pode ser reclamada. */
export interface OutboxRowState {
  readonly status: string
  readonly availableAtIso: string | null
  readonly leaseExpiresAtIso: string | null
  readonly attempts: number
}

export type ClaimSkipReason =
  | 'already_processed'
  | 'dead_letter'
  | 'lease_still_valid'
  | 'not_yet_available'
  | 'unknown_status'

export type ClaimEligibility =
  | { readonly claimable: true; readonly kind: 'fresh' | 'expired_lease' }
  | { readonly claimable: false; readonly reason: ClaimSkipReason }

function epochMs(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * A linha pode ser reclamada NESTE instante?
 *
 * `processing` com lease VALIDA e intocavel — e a unica coisa que impede dois
 * workers de projetarem o mesmo evento. `processing` com lease EXPIRADA e
 * recuperavel: significa que um worker morreu no meio, e sem recuperacao o
 * evento ficaria preso para sempre.
 */
export function evaluateClaimEligibility(
  row: OutboxRowState,
  nowIso: string,
): ClaimEligibility {
  const now = epochMs(nowIso)
  if (now === null) return { claimable: false, reason: 'unknown_status' }

  if (row.status === 'processed') return { claimable: false, reason: 'already_processed' }
  if (row.status === 'dead_letter') return { claimable: false, reason: 'dead_letter' }

  if (row.status === 'processing') {
    const leaseEnd = epochMs(row.leaseExpiresAtIso)
    // Sem `leaseExpiresAt` legivel tratamos como EXPIRADA: um evento preso por
    // um campo corrompido e pior do que um reprocessamento idempotente.
    if (leaseEnd !== null && leaseEnd > now) {
      return { claimable: false, reason: 'lease_still_valid' }
    }
    return { claimable: true, kind: 'expired_lease' }
  }

  if (row.status !== 'pending' && row.status !== 'failed') {
    return { claimable: false, reason: 'unknown_status' }
  }

  const availableAt = epochMs(row.availableAtIso)
  if (availableAt !== null && availableAt > now) {
    return { claimable: false, reason: 'not_yet_available' }
  }
  return { claimable: true, kind: 'fresh' }
}

/** Mutacao a aplicar quando o claim vence a corrida. */
export interface ClaimMutation {
  readonly status: OutboxStatus
  readonly leaseToken: string
  readonly lockedBy: string
  readonly lockedAtIso: string
  readonly leaseExpiresAtIso: string
  readonly attempts: number
}

export function buildClaimMutation(input: {
  readonly row: OutboxRowState
  readonly nowIso: string
  readonly leaseMs: number
  readonly leaseToken: string
  readonly workerId: string
}): ClaimMutation {
  const now = epochMs(input.nowIso) ?? 0
  return {
    status: 'processing',
    leaseToken: input.leaseToken,
    lockedBy: input.workerId,
    lockedAtIso: input.nowIso,
    leaseExpiresAtIso: new Date(now + Math.max(1_000, input.leaseMs)).toISOString(),
    // A tentativa e contada no CLAIM, nao no fail: um worker que morre sem
    // reportar nada nunca incrementaria o contador e tentaria para sempre.
    attempts: (Number.isFinite(input.row.attempts) ? input.row.attempts : 0) + 1,
  }
}

/* ------------------------------------------------------------------ */
/* Validacao de lease (ack e fail)                                     */
/* ------------------------------------------------------------------ */

export interface LeaseHolder {
  readonly status: string
  readonly leaseToken: string | null
  readonly lockedBy: string | null
  readonly eventPayloadHash: string | null
}

export type LeaseRejection =
  | 'not_processing'
  | 'lease_token_mismatch'
  | 'worker_mismatch'
  | 'payload_hash_mismatch'

export type LeaseVerdict =
  | { readonly ok: true }
  /** Ja processado: repetir o ack e idempotente, nao erro. */
  | { readonly ok: false; readonly idempotent: true }
  | { readonly ok: false; readonly idempotent: false; readonly reason: LeaseRejection }

/**
 * O portador da lease pode confirmar/reprovar este evento?
 *
 * Um ack com lease ANTIGA precisa ser recusado: significa que o worker demorou,
 * a lease expirou, outro worker reclamou o evento — e confirmar agora marcaria
 * como processado um trabalho que outro processo ainda esta fazendo.
 */
export function validateLease(
  holder: LeaseHolder,
  claim: { readonly leaseToken: string; readonly workerId: string; readonly eventPayloadHash?: string },
): LeaseVerdict {
  if (holder.status === 'processed') return { ok: false, idempotent: true }
  if (holder.status !== 'processing') {
    return { ok: false, idempotent: false, reason: 'not_processing' }
  }
  if (holder.leaseToken === null || holder.leaseToken !== claim.leaseToken) {
    return { ok: false, idempotent: false, reason: 'lease_token_mismatch' }
  }
  if (holder.lockedBy === null || holder.lockedBy !== claim.workerId) {
    return { ok: false, idempotent: false, reason: 'worker_mismatch' }
  }
  if (
    claim.eventPayloadHash !== undefined &&
    holder.eventPayloadHash !== null &&
    holder.eventPayloadHash !== claim.eventPayloadHash
  ) {
    return { ok: false, idempotent: false, reason: 'payload_hash_mismatch' }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Politica de retry                                                   */
/* ------------------------------------------------------------------ */

export interface RetryPolicy {
  readonly maxAttempts: number
  readonly backoffBaseMs: number
  readonly backoffMaxMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
  backoffMaxMs: DEFAULT_BACKOFF_MAX_MS,
}

/**
 * Backoff exponencial com teto. DETERMINISTICO: o jitter, quando desejado, e
 * injetado pelo chamador — um `Math.random()` aqui tornaria a politica
 * impossivel de testar.
 */
export function backoffDelayMs(
  attempts: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  jitterRatio = 0,
): number {
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : 1
  const raw = policy.backoffBaseMs * 2 ** (safeAttempts - 1)
  const capped = Math.min(raw, policy.backoffMaxMs)
  const jitter = Math.max(0, Math.min(1, jitterRatio)) * capped
  return Math.round(capped + jitter)
}

export interface FailOutcome {
  readonly status: OutboxStatus
  readonly availableAtIso: string | null
  readonly releaseLease: boolean
}

/**
 * Decide o destino de um evento que falhou.
 *
 * `retryable: false` vai direto para `dead_letter`: insistir num erro que o
 * produtor declarou permanente so gasta tentativa e atrasa o resto da fila.
 */
export function decideFailOutcome(input: {
  readonly attempts: number
  readonly retryable: boolean
  readonly nowIso: string
  readonly policy?: RetryPolicy
  readonly jitterRatio?: number
}): FailOutcome {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY
  if (!input.retryable || input.attempts >= policy.maxAttempts) {
    return { status: 'dead_letter', availableAtIso: null, releaseLease: true }
  }
  const now = epochMs(input.nowIso) ?? 0
  const delay = backoffDelayMs(input.attempts, policy, input.jitterRatio ?? 0)
  return {
    status: 'failed',
    availableAtIso: new Date(now + delay).toISOString(),
    releaseLease: true,
  }
}

/* ------------------------------------------------------------------ */
/* Sanitizacao de erro                                                 */
/* ------------------------------------------------------------------ */

const SECRET_SHAPES: readonly RegExp[] = [
  /postgres(?:ql)?:\/\/[^\s]*/gi,
  /\b[A-Za-z-]+ API-Key [^\s]+/g,
  /\bBearer\s+[^\s]+/gi,
  /\bJWT\s+[^\s]+/gi,
  /password=[^\s&]+/gi,
]

/**
 * Deixa uma mensagem de erro apresentavel para log e para o Payload.
 *
 * Erro de banco costuma carregar a connection string; erro de HTTP costuma
 * carregar o header de autorizacao. Nenhum dos dois pode atravessar para a
 * outbox, que e lida por humanos no painel.
 */
export function sanitizeErrorMessage(message: unknown, maxLength = 500): string {
  const raw = typeof message === 'string' ? message : 'erro desconhecido'
  let safe = raw
  for (const shape of SECRET_SHAPES) safe = safe.replace(shape, '[redigido]')
  safe = safe.replace(/\s+/g, ' ').trim()
  return safe.length > maxLength ? `${safe.slice(0, maxLength)}...` : safe
}

/* ------------------------------------------------------------------ */
/* Lote vazio x lote que FALHOU                                        */
/* ------------------------------------------------------------------ */

export type ClaimAttemptSummary =
  | { readonly ok: true; readonly status: 200 }
  | { readonly ok: false; readonly status: 503; readonly code: string; readonly detail: string }

export interface ClaimAttemptFacts {
  /** A consulta de candidatos chegou a concluir? `false` = banco/schema fora. */
  readonly candidatesRead: boolean
  /** Quantos eventos o compare-and-swap conseguiu tomar. */
  readonly claimed: number
  /**
   * Quantas tentativas de tomada ERRARAM.
   *
   * Perder a corrida para outro worker NAO conta aqui: aquilo devolve zero
   * linhas sem excecao, e e o funcionamento normal. Aqui so entra erro de
   * verdade — conexao caida, coluna que nao existe, permissao negada.
   */
  readonly failures: number
}

/**
 * O `claim` respondeu "nao ha nada" ou "eu nao consegui olhar"?
 *
 * O endpoint respondia `200 { claimed: 0, events: [] }` nos dois casos. O
 * `catch` do laco de tomada engolia qualquer erro — inclusive adapter sem pool,
 * coluna ausente depois de uma migration pela metade e permissao negada — e
 * seguia para o proximo candidato. Esgotados os candidatos, a resposta era
 * indistinguivel de uma fila vazia.
 *
 * O efeito e uma projecao PARADA com os dois lados verdes: o CMS respondendo
 * 200 e o worker dormindo satisfeito. Separar os dois desfechos e o que
 * transforma isso num 503 que o `/readyz` do worker enxerga.
 *
 * Falha PARCIAL (tomou alguns, errou outros) continua 200: houve progresso, e
 * derrubar o lote inteiro por um erro numa linha entregaria menos. A contagem
 * de falhas vai no corpo para nao sumir.
 */
export function summarizeClaimAttempt(facts: ClaimAttemptFacts): ClaimAttemptSummary {
  if (!facts.candidatesRead) {
    return {
      ok: false,
      status: 503,
      code: 'claim_query_failed',
      detail: 'nao foi possivel consultar a fila de eventos',
    }
  }
  if (facts.claimed === 0 && facts.failures > 0) {
    return {
      ok: false,
      status: 503,
      code: 'claim_all_attempts_failed',
      detail: `${String(facts.failures)} tentativa(s) de tomada falharam e nenhum evento foi reclamado`,
    }
  }
  return { ok: true, status: 200 }
}
