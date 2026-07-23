/**
 * Sessoes — regras puras (Backend C).
 *
 * PURO: sem rede, sem DB, sem crypto direto — `now` por parametro; o hash do
 * token entra pela porta SecretHasherPort (ligada a core/crypto.sha256Hex).
 *
 * Invariantes de seguranca desta camada:
 *  - o token CRU nunca entra no registro persistivel: guardamos so o hash;
 *  - IP cru nunca entra: `ipHash` deve ser um sha256 hex (64 chars) OU null —
 *    um IP cru ("192.168.0.1") falha a checagem de forma e e rejeitado
 *    (defesa estrutural contra persistir IP em claro);
 *  - rotacao revoga a sessao anterior E emite uma nova — nunca dois tokens
 *    validos ao mesmo tempo;
 *  - conta inelegivel (nao-active) NUNCA cria/renova sessao (fail-closed);
 *  - sessao expirada/revogada/de conta inelegivel falha FECHADA, com resposta
 *    publica generica (anti-enumeracao) e motivo interno so para audit.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type { UserStatus } from "../core/types.js";
import {
  accountCanHoldSession,
  type AuthDecision,
  authDecision,
  GENERIC_SESSION_FAILURE_MESSAGE,
  type SecretHasherPort,
  type SessionRecord,
} from "./types.js";

const HOUR_MS = 3_600_000;

/** Comprimento maximo de user-agent persistido (minimizacao de metadata). */
export const USER_AGENT_MAX_LENGTH = 256;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Trunca user-agent para minimizar metadata; null permanece null. */
function minimizeUserAgent(userAgent: string | null | undefined): string | null {
  if (userAgent == null) {
    return null;
  }
  const trimmed = userAgent.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, USER_AGENT_MAX_LENGTH);
}

/** Deduplica ids preservando a ordem de primeira ocorrencia. */
function dedupeBigints(ids: readonly bigint[]): bigint[] {
  const seen = new Set<bigint>();
  const out: bigint[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Constroi o registro persistivel de sessao a partir de tokens JA gerados
 * (fora do dominio, pela porta de geracao). Persiste SO hashes; calcula
 * expiracao a partir de `now` + `ttlHours`. Rejeita token vazio e `ipHash`
 * que nao seja sha256 hex (defesa contra IP cru).
 */
export function buildSessionRecord(input: {
  readonly userId: bigint;
  readonly rawToken: string;
  readonly rawCsrfToken: string;
  readonly now: Date;
  readonly ttlHours: number;
  readonly hashSecret: SecretHasherPort;
  readonly ipHash?: string | null;
  readonly userAgent?: string | null;
  readonly rotatedFromSessionId?: bigint | null;
}): DomainResult<SessionRecord> {
  if (input.rawToken.length === 0 || input.rawCsrfToken.length === 0) {
    return err("validation_failed", "token de sessao ausente.");
  }
  if (!Number.isFinite(input.ttlHours) || input.ttlHours <= 0) {
    return err("validation_failed", "TTL de sessao invalido.");
  }
  const ipHash = input.ipHash ?? null;
  if (ipHash !== null && !SHA256_HEX.test(ipHash)) {
    // Defesa estrutural: so aceitamos IP em forma de hash; IP cru e barrado.
    return err("validation_failed", "ipHash deve ser sha256 hex ou nulo (IP cru proibido).");
  }

  return ok({
    userId: input.userId,
    tokenHash: input.hashSecret(input.rawToken),
    csrfTokenHash: input.hashSecret(input.rawCsrfToken),
    expiresAt: new Date(input.now.getTime() + input.ttlHours * HOUR_MS),
    rotatedFromSessionId: input.rotatedFromSessionId ?? null,
    ipHash,
    userAgent: minimizeUserAgent(input.userAgent),
  });
}

/**
 * Cria a PRIMEIRA sessao de um login, ja com o gate de status (fail-closed).
 * Ponto de entrada gated para a CRIACAO — paralelo a `buildSessionRotation`
 * para a rotacao. Conta inelegivel (nao-active) nunca cria sessao. Delega a
 * `buildSessionRecord` (que aplica hash-only e a defesa contra IP cru).
 *
 * A autorizacao de credencial (senha) e responsabilidade de `decideLogin`,
 * chamado ANTES na composicao; aqui reforcamos apenas o gate de estado da
 * conta, para que nenhum caminho de criacao escape do fail-closed.
 */
export function buildSessionCreation(input: {
  readonly userId: bigint;
  readonly userStatus: UserStatus | null;
  readonly rawToken: string;
  readonly rawCsrfToken: string;
  readonly now: Date;
  readonly ttlHours: number;
  readonly hashSecret: SecretHasherPort;
  readonly ipHash?: string | null;
  readonly userAgent?: string | null;
}): DomainResult<SessionRecord> {
  if (!accountCanHoldSession(input.userStatus)) {
    return err("forbidden", GENERIC_SESSION_FAILURE_MESSAGE);
  }
  return buildSessionRecord({
    userId: input.userId,
    rawToken: input.rawToken,
    rawCsrfToken: input.rawCsrfToken,
    now: input.now,
    ttlHours: input.ttlHours,
    hashSecret: input.hashSecret,
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    rotatedFromSessionId: null,
  });
}

export interface SessionRotationPlan {
  /** Sessao anterior a revogar no MESMO commit da emissao (nunca dois tokens vivos). */
  readonly revokeSessionIds: readonly bigint[];
  readonly newSession: SessionRecord;
}

/**
 * Rotaciona uma sessao: emite uma nova (marcada com `rotatedFromSessionId`) e
 * revoga a anterior. Conta inelegivel bloqueia a rotacao (fail-closed). O
 * adapter aplica revogacao + insercao atomicamente.
 */
export function buildSessionRotation(input: {
  readonly userId: bigint;
  readonly previousSessionId: bigint;
  readonly userStatus: UserStatus | null;
  readonly rawToken: string;
  readonly rawCsrfToken: string;
  readonly now: Date;
  readonly ttlHours: number;
  readonly hashSecret: SecretHasherPort;
  readonly ipHash?: string | null;
  readonly userAgent?: string | null;
}): DomainResult<SessionRotationPlan> {
  if (!accountCanHoldSession(input.userStatus)) {
    return err("forbidden", GENERIC_SESSION_FAILURE_MESSAGE);
  }
  const record = buildSessionRecord({
    userId: input.userId,
    rawToken: input.rawToken,
    rawCsrfToken: input.rawCsrfToken,
    now: input.now,
    ttlHours: input.ttlHours,
    hashSecret: input.hashSecret,
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    rotatedFromSessionId: input.previousSessionId,
  });
  if (!record.ok) {
    return record;
  }
  return ok({ revokeSessionIds: [input.previousSessionId], newSession: record.value });
}

/** Motivo interno da avaliacao de sessao (audit); nunca vira texto publico. */
export type SessionAccessReason =
  | "ok"
  | "not_found"
  | "revoked"
  | "expired"
  | "account_ineligible";

/**
 * Avalia se uma sessao apresentada concede acesso AGORA. Fail-closed: sessao
 * inexistente, revogada, expirada, ou de conta inelegivel (nao-active) negam
 * acesso com a MESMA resposta publica generica; a causa fica so no motivo
 * interno. `now >= expiresAt` ja e expirado.
 */
export function evaluateSessionAccess(input: {
  readonly now: Date;
  readonly session: { readonly expiresAt: Date; readonly revokedAt: Date | null } | null;
  readonly userStatus: UserStatus | null;
}): AuthDecision<{ valid: true }> {
  const session = input.session;

  let reason: SessionAccessReason;
  if (session === null) {
    reason = "not_found";
  } else if (session.revokedAt !== null) {
    reason = "revoked";
  } else if (input.now.getTime() >= session.expiresAt.getTime()) {
    reason = "expired";
  } else if (!accountCanHoldSession(input.userStatus)) {
    reason = "account_ineligible";
  } else {
    return authDecision(ok({ valid: true }), "ok");
  }

  return authDecision(err("unauthorized", GENERIC_SESSION_FAILURE_MESSAGE), reason);
}

export interface RevocationPlan {
  readonly revokeSessionIds: readonly bigint[];
}

/**
 * Revoga UMA sessao (logout). Idempotente por natureza — revogar sessao ja
 * revogada nao e erro de dominio.
 */
export function planLogout(input: { readonly currentSessionId: bigint }): RevocationPlan {
  return { revokeSessionIds: [input.currentSessionId] };
}

/**
 * Revoga TODAS as sessoes ativas, exceto `exceptSessionId` quando fornecido
 * ("sair dos outros dispositivos"). Deduplica ids.
 */
export function planRevokeAll(input: {
  readonly activeSessionIds: readonly bigint[];
  readonly exceptSessionId?: bigint | null;
}): RevocationPlan {
  const except = input.exceptSessionId ?? null;
  const filtered = input.activeSessionIds.filter((id) => id !== except);
  return { revokeSessionIds: dedupeBigints(filtered) };
}

/**
 * Revoga TODAS as sessoes apos evento sensivel (troca/reset de senha,
 * verificacao de conta comprometida). SEM excecao — derruba tudo.
 */
export function planRevokeAllAfterSensitiveEvent(input: {
  readonly activeSessionIds: readonly bigint[];
}): RevocationPlan {
  return { revokeSessionIds: dedupeBigints([...input.activeSessionIds]) };
}
