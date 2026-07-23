/**
 * Recuperacao de senha — regras puras (Backend C).
 *
 * PURO: sem rede, sem DB, sem SMTP. `now` por parametro; segredo por PORTA.
 * Token CRU so na EMISSAO (para entrega por email), NUNCA persistido; o
 * registro guarda so `tokenHash`. TTL curto e deliberado (PASSWORD_RESET_TTL_HOURS).
 *
 * ANTI-ENUMERACAO: a resposta publica do PEDIDO de recuperacao e IDENTICA
 * exista ou nao a conta. A emissao interna do token so acontece quando a conta
 * existe e e elegivel; o motivo real fica so no interno.
 *
 * Evento sensivel: um reset aplicado TROCA a senha, REVOGA todas as sessoes e
 * INVALIDA os tokens de reset pendentes (o token usado e os demais). Politicas
 * de token distintas por proposito -> nao ha "token generico".
 */

import { type DomainResult, ok } from "../core/result.js";
import { buildPasswordChange, type PasswordChangePlan } from "./credentials.js";
import { PASSWORD_RESET_TTL_HOURS } from "./policy.js";
import {
  accountCanHoldSession,
  type AuthDecision,
  authDecision,
  GENERIC_RECOVERY_MESSAGE,
  type PasswordHasherPort,
  type SecretGeneratorPort,
  type SecretHasherPort,
  type VerificationTokenRecord,
} from "./types.js";
import type { UserStatus } from "../core/types.js";
import { resolveTtlMinutes } from "./ttl.js";

const MINUTE_MS = 60_000;

/** Motivo interno do pedido de recuperacao (audit); nunca vira texto publico. */
export type RecoveryRequestReason = "issue_token" | "user_not_found" | "account_ineligible";

/**
 * Decide o PEDIDO de recuperacao. `publicResult` e SEMPRE o mesmo ok generico
 * (indistinguivel entre conta existente/inexistente/inelegivel). Internamente
 * so `issue_token` autoriza emitir o token; contas inexistentes ou nao-active
 * nao emitem nada — mas a resposta publica nao muda.
 */
export function evaluatePasswordResetRequest(input: {
  readonly userExists: boolean;
  readonly userStatus: UserStatus | null;
}): AuthDecision<{ notice: "sent_if_applicable" }> {
  let reason: RecoveryRequestReason;
  if (!input.userExists) {
    reason = "user_not_found";
  } else if (!accountCanHoldSession(input.userStatus)) {
    reason = "account_ineligible";
  } else {
    reason = "issue_token";
  }
  return authDecision(ok({ notice: "sent_if_applicable" }), reason);
}

export interface PasswordResetTokenIssue {
  readonly record: VerificationTokenRecord;
  /** Token CRU para entrega por email. NUNCA persistir; NUNCA logar. */
  readonly rawToken: string;
}

/**
 * Emite um token de reset: gera segredo (porta), persiste so o hash, expira em
 * `ttlMinutes` a partir de `now`. Chamar apenas quando o pedido foi avaliado
 * como `issue_token`.
 *
 * `ttlMinutes` e OPCIONAL e o default e PASSWORD_RESET_TTL_HOURS. Ele existe
 * porque o runtime (C7C) recebe o prazo por configuracao de ambiente
 * (`PASSWORD_RESET_EXPIRATION_MINUTES`); a alternativa seria o runtime calcular
 * `expiresAt` por conta propria, criando uma SEGUNDA formula de validade livre
 * para divergir desta. Valor invalido cai no default (ver `./ttl.js`).
 */
export function buildPasswordResetIssue(input: {
  readonly userId: bigint;
  readonly now: Date;
  readonly generateSecret: SecretGeneratorPort;
  readonly hashSecret: SecretHasherPort;
  readonly ttlMinutes?: number;
}): PasswordResetTokenIssue {
  const rawToken = input.generateSecret();
  const ttlMinutes = resolveTtlMinutes(input.ttlMinutes, PASSWORD_RESET_TTL_HOURS);
  return {
    record: {
      userId: input.userId,
      purpose: "password_reset",
      tokenHash: input.hashSecret(rawToken),
      expiresAt: new Date(input.now.getTime() + ttlMinutes * MINUTE_MS),
    },
    rawToken,
  };
}

export interface PasswordResetApplication {
  readonly credentialChange: PasswordChangePlan;
  /** Reset SEMPRE revoga todas as sessoes (via credentialChange.revokeSessionIds). */
  readonly revokeSessionIds: readonly bigint[];
  /**
   * Invalida TODOS os tokens de reset pendentes do usuario (o consumido e os
   * demais) — evita reuso de um segundo link de reset apos a troca.
   */
  readonly invalidateAllPendingResetTokens: true;
}

/**
 * Aplica o reset APOS o consumo do token
 * (tokens.evaluateTokenConsumption com expectedPurpose = "password_reset").
 * Produz: nova credencial (hash via porta) + revogacao de TODAS as sessoes +
 * invalidacao dos tokens de reset pendentes. A nova senha ja deve ter passado
 * pela politica (policy.validatePasswordCandidate) antes desta chamada.
 */
export function applyPasswordReset(input: {
  readonly userId: bigint;
  readonly newPassword: string;
  readonly hashPassword: PasswordHasherPort;
  readonly activeSessionIds: readonly bigint[];
}): DomainResult<PasswordResetApplication> {
  const change = buildPasswordChange({
    userId: input.userId,
    newPassword: input.newPassword,
    hashPassword: input.hashPassword,
    activeSessionIds: input.activeSessionIds,
  });
  if (!change.ok) {
    return change;
  }
  return ok({
    credentialChange: change.value,
    revokeSessionIds: change.value.revokeSessionIds,
    invalidateAllPendingResetTokens: true,
  });
}

// Reexporta a mensagem generica para consumidores do fluxo de recuperacao.
export { GENERIC_RECOVERY_MESSAGE };
